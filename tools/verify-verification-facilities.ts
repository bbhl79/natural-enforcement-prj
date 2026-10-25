// 真实设施验证（#213 验收项「真实设施验证 BullMQ attempts 语义与图层服务不可用判 unavailable」）。
//
// 本脚本不入测试层：它要连真实 Redis 并起真实 HTTP 端点，跑法与普通用例不同。
// 跑法（仓库根目录执行，容器内、node 原生 type-stripping）：
//
//   docker run --rm --network natural-enforcement_default \
//     -e REDIS_URL=redis://redis:6379 \
//     -v "$PWD:/repo:ro" -v natural-enforcement-integration-node-modules:/work/node_modules \
//     -v natural-enforcement-test-store:/pnpm/store \
//     -v natural-enforcement-corepack:/root/.cache/node/corepack \
//     -v natural-enforcement-pnpm-cache:/root/.cache/pnpm \
//     -w /work node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 \
//     sh -c "cp -a /repo/. /work/; corepack enable; \
//       pnpm install --frozen-lockfile --ignore-scripts --config.strict-dep-builds=false \
//         --store-dir /pnpm/store --prefer-offline; \
//       node --experimental-transform-types --experimental-strip-types tools/verify-verification-facilities.ts"
//
// 验三件事：
// 1. BullMQ 的 attempts 含首次执行：投递 attempts=3 的瞬时失败任务，消费端真跑 3 次。
// 2. 不可重试错误不重试：同样投递 attempts=3，但处理器抛不可重试错误，只跑 1 次。
// 3. 图层服务不可用判 unavailable：真实 HTTP 端点回 503，该层判 unavailable 且不冒充查过没有。
import { createServer } from 'node:http';

import { createLayerServiceVerificationPort } from '../backend/case/src/clue/verification/layer-service-port.ts';
import { VERIFICATION_LAYERS } from '../backend/case/src/clue/verification/layers.ts';
import { NonRetryableError } from '../packages/queue/src/non-retryable.ts';
import { createQueuePort } from '../packages/queue/src/queue-port.ts';
import { createQueueWorker } from '../packages/queue/src/worker.ts';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://redis:6379';
const QUEUE_NAME = 'ne.verify.real-check';
/** 重试延迟取 200 毫秒：验的是 attempts 与退避语义，不是生产那三档 30／60／120 秒。 */
const RETRY_DELAY_MS = 200;
const ATTEMPTS = 3;

const port = createQueuePort({ queueName: QUEUE_NAME, redisUrl: REDIS_URL });

let transientRuns = 0;
let unrecoverableRuns = 0;

const worker = createQueueWorker({
  queueName: QUEUE_NAME,
  redisUrl: REDIS_URL,
  processor: async (payload, context) => {
    const job = payload as { kind: string };
    if (job.kind === 'unrecoverable') {
      unrecoverableRuns += 1;
      throw new NonRetryableError('missing-layers', '缺图层');
    }
    transientRuns += 1;
    console.log(`消费第 ${context.attempt} 次`);
    if (context.attempt < ATTEMPTS) throw new Error('瞬时故障');
    return { ok: true };
  },
});

const transientRef = await port.enqueue(
  'clue.verification',
  { kind: 'transient' },
  { attempts: ATTEMPTS, backoff: { type: 'exponential', delay: RETRY_DELAY_MS } },
);
const unrecoverableRef = await port.enqueue(
  'clue.verification',
  { kind: 'unrecoverable' },
  { attempts: ATTEMPTS, backoff: { type: 'exponential', delay: RETRY_DELAY_MS } },
);

try {
  await port.waitForCompletion(transientRef, 30_000);
  console.log(`瞬时任务：消费 ${transientRuns} 次（投递 attempts=${ATTEMPTS}）`);
} catch (error) {
  console.log(`瞬时任务最终失败：${error instanceof Error ? error.message : String(error)}`);
}
try {
  await port.waitForCompletion(unrecoverableRef, 30_000);
  console.log('不可重试任务：竟然成功了');
} catch {
  console.log(`不可重试任务：消费 ${unrecoverableRuns} 次后失败（不重试）`);
}

// 图层服务不可用：真实 HTTP 端点返回 503。
const server = createServer((_req, res) => {
  res.statusCode = 503;
  res.end('service unavailable');
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const listeningPort = typeof address === 'object' && address !== null ? address.port : 0;

const layerKey = VERIFICATION_LAYERS[0]?.key ?? 'permanent-farmland';
const layerPort = createLayerServiceVerificationPort({
  serviceUrls: { [layerKey]: `http://127.0.0.1:${listeningPort}/layer` },
});
const outcome = await layerPort.run({
  clueId: 'clue-real-check',
  domain: 'land',
  spatialVersion: 'v-real-check',
  totalArea: 1,
  parts: [],
});
const layer = outcome.layers.find((item) => item.layerKey === layerKey);
console.log(`图层服务返回 503：该层状态 ${layer?.state}，原因 ${layer?.unavailableReason}`);

server.close();
await worker.close();
await port.close();
