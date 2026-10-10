// E3 不可变必失败用例驱动（#53，integration 层 integration/e3-immutable-storage.sh 调用）。
// 驱动真实 RustFS（容器网络内 http://rustfs:9000，S3 兼容 API + 对象锁 WORM）：
//   写版本 → 原地改写尝试 / 删除尝试 → 必须「被拒」或「产生新世代而原版本无损」。
// 红绿对照的判别轴 = 原版本（versionId 寻址）内容是否仍完整：
//   校验拒绝（403 AccessDenied）或 新世代（改写/删除不触及原版本）→ 通过；
//   校验缺失（原版本被改写或消失）→ 失败。
// 运行方式：node packages/storage/src/e3-driver.ts（node 原生 type-stripping），
// 本文件传递闭包内禁止装饰器/第三方依赖。输出人类可读中文行，退出码 0/1。
// 注意：本用例证明的是存储层 append-only/WORM 语义，不宣称任何「封存」语义（G4）。
import { createS3Client, S3Error } from './s3-client.ts';
import { createRustFsStorage } from './rustfs-storage.ts';

const endpoint = process.env.RUSTFS_ENDPOINT ?? 'http://rustfs:9000';
const region = process.env.RUSTFS_REGION ?? 'us-east-1';
const accessKey = process.env.RUSTFS_ACCESS_KEY ?? 'rustfsdev';
const secretKey = process.env.RUSTFS_SECRET_KEY ?? 'rustfsdev-secret';
const bucket = process.env.E3_BUCKET ?? 'ne-e3';
const runId = process.env.E3_RUN_ID ?? `${Date.now()}`;
const fileKey = `e3/${runId}/demo.txt`;

const client = createS3Client({ endpoint, region, accessKey, secretKey });
const storage = createRustFsStorage({ client, bucket });

const contentV1 = new TextEncoder().encode(`E3 原始版本内容 run=${runId}`);
const contentAttack = new TextEncoder().encode(`E3 原地改写尝试 run=${runId}`);

let failures = 0;

function report(ok: boolean, name: string, detail: string): void {
  if (!ok) failures += 1;
  console.log(`${ok ? '[通过]' : '[失败]'} ${name}：${detail}`);
}

const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

async function main(): Promise<void> {
  console.log(`E3 不可变必失败用例（RustFS ${endpoint}，桶 ${bucket}）`);

  // 0. 桶在场 + 对象锁 + 版本控制（幂等：已建即跳过）
  if (!(await client.bucketExists(bucket))) {
    await client.createBucket(bucket, { objectLockEnabled: true });
    console.log(`[通过] 建桶（对象锁启用）：${bucket}`);
  } else {
    console.log(`[通过] 桶已存在（跳过建桶）：${bucket}`);
  }
  if ((await client.getVersioning(bucket)) !== 'Enabled') {
    await client.setVersioning(bucket, 'Enabled');
    console.log('[通过] 版本控制已启用（Versioning=Enabled）');
  } else {
    console.log('[通过] 版本控制已启用（原本即 Enabled）');
  }
  try {
    await client.setDefaultRetention(bucket, { mode: 'COMPLIANCE', years: 100 });
    console.log('[通过] 桶级默认保留已配置（COMPLIANCE 100 年，双保险）');
  } catch (err) {
    console.log(
      `[通过] 桶级默认保留未获支持（${err instanceof S3Error ? err.code : String(err)}），` +
        '降级为写入侧保留头（适配器强制，语义不放宽）',
    );
  }

  // 1. 写入版本 + 按版本读回（写入路径本身是绿的，红绿对照才有意义）
  const ref = await storage.putVersion(fileKey, contentV1);
  const readBack = await storage.readVersion(ref);
  report(
    bytesEqual(readBack, contentV1),
    '写入新版本并按版本读回',
    `versionId=${ref.versionId} 内容一致`,
  );
  // 一切不可变断言统一经 versionId 寻址原版本
  const originalIntact = async (): Promise<boolean> =>
    bytesEqual(await client.getObject(bucket, fileKey, ref.versionId), contentV1);

  // 2. 原地改写尝试（绕过通道：协议层直发 PUT，不带对象锁头）
  try {
    const result = await client.putObject(bucket, fileKey, contentAttack);
    const intact = await originalIntact();
    report(
      intact,
      '原地改写尝试',
      intact
        ? `校验未缺失：原版本无损` +
            (result.versionId && result.versionId !== ref.versionId
              ? `，存储端产生新世代 versionId=${result.versionId}（新世代而非改写）`
              : '，存储端拒绝原地改写语义')
        : '校验缺失：原版本内容已被原地改写（append-only 不成立）',
    );
  } catch (err) {
    const rejected = err instanceof S3Error && err.status === 403;
    report(
      rejected,
      '原地改写尝试',
      rejected
        ? `校验拒绝：403 ${err instanceof S3Error ? err.code : ''}（WORM 拒绝原地改写）`
        : `意外错误：${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 3. 删除尝试（绕过通道：协议层直发 DELETE 最新世代）
  try {
    await client.deleteObject(bucket, fileKey);
    const intact = await originalIntact();
    report(
      intact,
      '删除尝试',
      intact
        ? '校验未缺失：删除仅产生新世代（删除标记语义），原版本仍可按 versionId 读取'
        : '校验缺失：删除后原版本不可读（append-only 不成立）',
    );
  } catch (err) {
    const rejected = err instanceof S3Error && err.status === 403;
    report(
      rejected,
      '删除尝试',
      rejected
        ? `校验拒绝：403 ${err instanceof S3Error ? err.code : ''}（WORM 拒绝删除）`
        : `意外错误：${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 4. 定点删除原版本尝试（WORM 的最强断言：DELETE ?versionId=<原版本>）
  try {
    await client.deleteObject(bucket, fileKey, ref.versionId);
    report(
      false,
      '定点删除原版本尝试',
      '校验缺失：COMPLIANCE 保留期内的原版本可被定点删除（对象锁 WORM 不成立）',
    );
  } catch (err) {
    const rejected = err instanceof S3Error && err.status === 403;
    report(
      rejected,
      '定点删除原版本尝试',
      rejected
        ? `校验拒绝：403 ${err instanceof S3Error ? err.code : ''}（对象锁 WORM 拒绝定点删除原版本）`
        : `意外错误：${err instanceof Error ? err.message : String(err)}`,
    );
  }

  console.log(
    failures === 0
      ? 'E3 结论：写入后不可原地修改/删除（被拒或新世代），append-only 存储语义成立。'
      : `E3 结论：存在 ${failures} 项校验缺失，不可变语义不成立。`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(`E3 用例执行异常：${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
