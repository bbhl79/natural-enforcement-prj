#!/usr/bin/env node
// 用途：用产品图层适配器直连假图层服务，自检协议一致与四类场景判定。
// 用法：在工具链容器内直接运行；服务端口由 VERIFY_SELF_CHECK_PORT 指定。
// 退出码：0 全部自检通过；1 任一检查失败。
// 用产品里的图层适配器直连假图层服务。
// 证明假服务说的是同一协议，适配器把它当真实服务使用。
// 本脚本不启动业务栈。空地址「查不成」仍走适配器自己的未配置分支。

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createLayerServiceVerificationPort } from '../../../../backend/case/src/clue/verification/layer-service-port.ts';
import { VERIFICATION_LAYERS } from '../../../../backend/case/src/clue/verification/layers.ts';
import { LAYER_KEYS } from './fake-layer-server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverFile = path.join(here, 'fake-layer-server.mjs');
const port = Number(process.env.VERIFY_SELF_CHECK_PORT ?? '18099');

// 按给定经纬度生成边长 0.008 度的合成正方形 GeoJSON 文本。
function square(lon, lat) {
  const d = 0.008;
  return JSON.stringify({
    type: 'Polygon',
    coordinates: [
      [
        [lon, lat],
        [lon + d, lat],
        [lon + d, lat + d],
        [lon, lat + d],
        [lon, lat],
      ],
    ],
  });
}

// 造一份单部件核查请求，供适配器调用。
function requestOf(geojson) {
  return {
    clueId: 'vf-self-check',
    domain: 'land',
    spatialVersion: 'self-check',
    totalArea: 1000,
    parts: [{ partId: 'part-1', partIndex: 0, geojson }],
  };
}

// 打印失败原因并置退出码，不立即终止后续检查。
function fail(message) {
  console.error(`[FAIL] ${message}`);
  process.exitCode = 1;
}

// 在 10 秒内轮询健康检查；超时抛错并带上最后一次失败原因。
async function waitHealth(url) {
  const deadline = Date.now() + 10_000;
  let last = '尚未连接';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`假图层健康检查未就绪：${last}`);
}

const child = spawn(process.execPath, [serverFile], {
  env: {
    ...process.env,
    VERIFY_LAYER_PORT: String(port),
    VERIFY_LAYER_HOST: '127.0.0.1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
child.stdout.on('data', (chunk) => {
  serverLog += chunk.toString();
});
child.stderr.on('data', (chunk) => {
  serverLog += chunk.toString();
});

const base = `http://127.0.0.1:${port}`;
const report = {
  adapter: 'createLayerServiceVerificationPort',
  fakeService: base,
  checks: [],
};

try {
  await waitHealth(`${base}/health`);
  const health = await fetch(`${base}/health`).then((response) => response.json());
  const productKeys = VERIFICATION_LAYERS.map((layer) => layer.key);
  if (JSON.stringify(health.layers) !== JSON.stringify(productKeys)) {
    fail(`假服务图层键与产品名册不一致：${JSON.stringify(health.layers)}`);
  } else if (JSON.stringify(LAYER_KEYS) !== JSON.stringify(productKeys)) {
    fail('假服务导出的图层键与健康检查不一致');
  } else {
    report.checks.push({ name: 'layer-keys', pass: true, keys: productKeys });
  }

  const urls = Object.fromEntries(productKeys.map((key) => [key, `${base}/query`]));
  const live = createLayerServiceVerificationPort({ serviceUrls: urls });

  const success = await live.run(requestOf(square(113.241, 23.051)));
  const successStates = success.layers.map((layer) => layer.state);
  const successOk =
    success.layers.length === 7 &&
    success.layers.every(
      (layer) => layer.state === 'overlapped' && layer.features[0]?.overlapArea === 1000,
    );
  report.checks.push({ name: 'success', pass: successOk, states: successStates });
  if (!successOk) fail(`核查成功场景未被适配器读成七层有相交：${successStates.join(',')}`);

  const partial = await live.run(requestOf(square(113.341, 23.151)));
  const partialOverlapped = partial.layers.filter((layer) => layer.state === 'overlapped');
  const partialClear = partial.layers.filter((layer) => layer.state === 'no_overlap');
  const partialOk =
    partialOverlapped.length === 3 &&
    partialOverlapped.every((layer) => layer.features[0]?.overlapArea === 250) &&
    partialClear.length === 4 &&
    partial.layers.every((layer) => layer.state !== 'unavailable');
  report.checks.push({
    name: 'partial',
    pass: partialOk,
    overlapped: partialOverlapped.map((layer) => layer.layerKey),
    noOverlap: partialClear.map((layer) => layer.layerKey),
  });
  if (!partialOk) fail('部分命中场景未被适配器读成三层有相交、四层无相交');

  const duplicate = await live.run(requestOf(square(113.441, 23.251)));
  const duplicateOk = duplicate.layers.every((layer) => layer.state === 'overlapped');
  report.checks.push({
    name: 'duplicate-layers',
    pass: duplicateOk,
    states: duplicate.layers.map((layer) => layer.state),
  });
  if (!duplicateOk) fail('疑似重复夹具的图层查询没有全部查成');

  const empty = createLayerServiceVerificationPort({ serviceUrls: {} });
  const missed = await empty.run(requestOf(square(113.541, 23.351)));
  const emptyOk = missed.layers.every(
    (layer) => layer.state === 'unavailable' && layer.unavailableReason === 'service-not-configured',
  );
  report.checks.push({ name: 'empty-url', pass: emptyOk });
  if (!emptyOk) fail('空地址没有被适配器判成 service-not-configured');

  report.pass = report.checks.every((item) => item.pass);
  console.log(JSON.stringify(report, null, 2));
  if (!report.pass) process.exitCode = 1;
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
  if (serverLog.trim() !== '') console.error(serverLog);
} finally {
  child.kill();
  await once(child, 'exit').catch(() => undefined);
}
