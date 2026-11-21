// PROTOTYPE（#13）— e2e 数据级隔离 teardown：清空并删除 run 专属 rustfs bucket。
// 幂等、best-effort（失败不阻塞报告产出——playwright-e2e.md §2.3 层 1）；
// 由 devenv 在 tools 容器内执行（S3 凭据经环境注入）。
import {
  DeleteBucketCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3'

const bucket = process.argv[2] ?? process.env.E2E_BUCKET
if (!bucket) {
  console.error('用法：node teardown-bucket.js <bucket>（或环境变量 E2E_BUCKET）')
  process.exit(2)
}

const client = new S3Client({
  endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
  region: process.env.S3_REGION ?? 'us-east-1',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY ?? 'rustfsadmin',
    secretAccessKey: process.env.S3_SECRET_KEY ?? '',
  },
  forcePathStyle: true,
})

let deleted = 0
// 轮询清空（ListObjectsV2 单页 ≤1000）→ 删桶；桶不存在 = 已干净
for (;;) {
  const listed = await client.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1000 }))
  const keys = (listed.Contents ?? []).map((o) => ({ Key: o.Key })).filter((k): k is { Key: string } => k.Key !== undefined)
  if (keys.length === 0) break
  await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys } }))
  deleted += keys.length
}
await client.send(new DeleteBucketCommand({ Bucket: bucket }))
console.error(`teardown-bucket：${bucket} 已删（清出 ${deleted} 对象）`)
