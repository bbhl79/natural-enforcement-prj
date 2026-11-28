import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { Injectable } from '@nestjs/common'

export interface StorageConfig {
  readonly endpoint: string
  readonly region: string
  readonly accessKeyId: string
  readonly secretAccessKey: string
  readonly bucket: string
}

/**
 * rustfs S3 适配（自研实现收敛点：换对象存储只改此处配置；#69）。
 *
 * 安全边界：
 * - 配置只在首次使用时读取/校验（单测/OpenAPI 派生不需要连存储）；
 * - presigned URL 仅服务间使用（worker 经它读取对象），绝不进入浏览器响应；
 * - 异常向上冒泡，由服务层转为不含内部地址的通用错误。
 *
 * forcePathStyle=true：自托管 S3（rustfs/minio 系）必须路径风格寻址。
 */
@Injectable()
export class StorageService {
  private client?: S3Client
  private config?: StorageConfig
  private bucketReady?: Promise<void>

  private loadConfig(): StorageConfig {
    if (this.config) return this.config
    const endpoint = process.env.S3_ENDPOINT
    const accessKeyId = process.env.S3_ACCESS_KEY
    const secretAccessKey = process.env.S3_SECRET_KEY
    if (!endpoint || !accessKeyId || !secretAccessKey) {
      throw new Error('对象存储配置缺失（需要 S3_ENDPOINT / S3_ACCESS_KEY / S3_SECRET_KEY）')
    }
    this.config = {
      endpoint,
      region: process.env.S3_REGION ?? 'us-east-1',
      accessKeyId,
      secretAccessKey,
      bucket: process.env.S3_BUCKET ?? 'ne-dev-evidence',
    }
    return this.config
  }

  private getClient(): S3Client {
    if (this.client) return this.client
    const cfg = this.loadConfig()
    this.client = new S3Client({
      endpoint: cfg.endpoint,
      region: cfg.region,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
      forcePathStyle: true,
    })
    return this.client
  }

  get bucket(): string {
    return this.loadConfig().bucket
  }

  /** bucket 幂等创建；失败不缓存，允许下一请求重试 */
  private ensureBucket(): Promise<void> {
    this.bucketReady ??= (async () => {
      const client = this.getClient()
      const Bucket = this.bucket
      try {
        await client.send(new HeadBucketCommand({ Bucket }))
      } catch {
        await client.send(new CreateBucketCommand({ Bucket }))
      }
    })().catch((err: unknown) => {
      this.bucketReady = undefined
      throw err
    })
    return this.bucketReady
  }

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    await this.ensureBucket()
    await this.getClient().send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    )
  }

  async get(key: string): Promise<Uint8Array> {
    await this.ensureBucket()
    const resp = await this.getClient().send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    )
    if (!resp.Body) throw new Error('对象无 Body')
    return await resp.Body.transformToByteArray()
  }

  /** 服务间下载 URL（worker 使用；不对外暴露） */
  async presignGet(key: string, ttlSeconds = 300): Promise<string> {
    await this.ensureBucket()
    return getSignedUrl(
      this.getClient(),
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: ttlSeconds },
    )
  }

  /** 清理/回滚用；对象不存在不视为失败 */
  async delete(key: string): Promise<void> {
    await this.ensureBucket()
    await this.getClient().send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
  }
}
