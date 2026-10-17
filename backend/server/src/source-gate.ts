import { Injectable } from '@nestjs/common';

const WINDOW_MS = 15 * 60 * 1000;
const BLOCK_MS = 30 * 60 * 1000;
const LIMIT = 10;

interface Bucket {
  windowStartedAt: number;
  count: number;
  blockedUntil: number | null;
}

/** 来源地址闸。计数只在本进程内存里，进程重启后没有了。 */
@Injectable()
export class SourceGate {
  private readonly buckets = new Map<string, Bucket>();

  blocked(ip: string | null, now: Date): boolean {
    if (ip == null || ip === '') return false;
    const bucket = this.buckets.get(ip);
    if (bucket?.blockedUntil == null) return false;
    if (now.getTime() >= bucket.blockedUntil) {
      this.buckets.delete(ip);
      return false;
    }
    return true;
  }

  /** 记一次登录失败。使计数达到 10 的这一次不拒绝，下一次才拒绝。 */
  record(ip: string | null, now: Date): void {
    if (ip == null || ip === '') return;
    const t = now.getTime();
    const existing = this.buckets.get(ip);
    if (existing?.blockedUntil != null && t < existing.blockedUntil) return;
    if (!existing || t - existing.windowStartedAt >= WINDOW_MS) {
      this.buckets.set(ip, { windowStartedAt: t, count: 1, blockedUntil: null });
      return;
    }
    existing.count += 1;
    if (existing.count >= LIMIT) existing.blockedUntil = t + BLOCK_MS;
  }
}
