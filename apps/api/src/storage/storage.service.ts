import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { Injectable, type OnModuleInit } from '@nestjs/common'

/**
 * rustfs S3 适配（自研实现收敛点：换对象存储只改此处配置）。
 * forcePathStyle=true：自托管 S3（rustfs/minio 系）必须路径风格寻址。
 */
@Injectable()
export class StorageService implements OnModuleInit {
  readonly bucket = process.env.S3_BUCKET ?? 'ne-dev-evidence'

  private readonly client = new S3Client({
    endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
    region: process.env.S3_REGION ?? 'us-east-1',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY ?? 'rustfsadmin',
      secretAccessKey: process.env.S3_SECRET_KEY ?? '',
    },
    forcePathStyle: true,
  })

  async onModuleInit(): Promise<void> {
    await this.ensureBucket()
  }

  private async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }))
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }))
    }
  }

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    )
  }

  async get(key: string): Promise<Uint8Array> {
    const resp = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }))
    const body = resp.Body
    if (!body) throw new Error(`对象无 Body：${key}`)
    return await body.transformToByteArray()
  }

  async presignGet(key: string, ttlSeconds = 300): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: ttlSeconds,
    })
  }
}
