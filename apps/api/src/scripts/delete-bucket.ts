// e2e run 资源清理（#70）：只删除带 e2e 专属前缀的 bucket（双条件之一在本脚本强制，
// 另一条件「运行登记册记录」由 devenv/lib/e2e.sh 的清理路径保证——开发 bucket
// `ne-dev-evidence` 永远不会进入本脚本候选集）。对象逐页删除后删 bucket；
// bucket 不存在视为成功（幂等）。
import {
  DeleteBucketCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3'

const E2E_BUCKET_PATTERN = /^e2e-[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/

function isNotFound(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const name = (err as { name?: string }).name
  const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
  return name === 'NoSuchBucket' || name === 'NotFound' || status === 404
}

async function main(): Promise<void> {
  const bucket = process.argv[2]
  if (!bucket || !E2E_BUCKET_PATTERN.test(bucket)) {
    throw new Error(`拒绝删除非 e2e 前缀 bucket：${bucket ?? '(缺参数)'}（只接受 e2e-<run-id>）`)
  }
  const client = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION ?? 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY ?? '',
      secretAccessKey: process.env.S3_SECRET_KEY ?? '',
    },
  })

  let deleted = 0
  try {
    let token: string | undefined
    do {
      const page = await client.send(
        new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }),
      )
      const objects = (page.Contents ?? []).flatMap((item) =>
        item.Key ? [{ Key: item.Key }] : [],
      )
      if (objects.length > 0) {
        await client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: objects, Quiet: true },
          }),
        )
        deleted += objects.length
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined
    } while (token)
  } catch (err) {
    if (!isNotFound(err)) throw err
    console.log(JSON.stringify({ bucket, deleted: 0, result: 'not-found' }))
    return
  }

  try {
    await client.send(new DeleteBucketCommand({ Bucket: bucket }))
  } catch (err) {
    if (!isNotFound(err)) throw err
  }
  console.log(JSON.stringify({ bucket, deleted, result: 'deleted' }))
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exitCode = 1
})