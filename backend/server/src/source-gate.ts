import { Injectable } from '@nestjs/common';

const WINDOW_MS = 15 * 60 * 1000;
const BLOCK_MS = 30 * 60 * 1000;
const LIMIT = 10;

/** 部署档。只有这两个值才读取允许名单。 */
export const SOURCE_GATE_DEPLOYMENT_ENV = 'NE_DEPLOYMENT';

/** 允许来源地址。逗号分隔，与进程采信的单个来源地址逐字相同。 */
export const SOURCE_GATE_ALLOWED_SOURCES_ENV = 'NE_SOURCE_GATE_ALLOWED_SOURCES';

const NON_PRODUCTION_DEPLOYMENTS = new Set(['dev', 'verify']);

/** 本闸只读这三个名字。单独声明，避免撞上仓内另一份 ProcessEnv。 */
interface SourceGateEnv {
  readonly NODE_ENV?: string | undefined;
  readonly NE_DEPLOYMENT?: string | undefined;
  readonly NE_SOURCE_GATE_ALLOWED_SOURCES?: string | undefined;
}

interface Bucket {
  windowStartedAt: number;
  count: number;
  blockedUntil: number | null;
}

/**
 * 解析来源地址闸允许名单。
 * 同时满足两项才返回名单：NE_DEPLOYMENT 为 dev 或 verify，NODE_ENV 去掉首尾空白后不是 production。
 * 其余情况返回空集。生产进程保持原闸。名单默认空。
 */
export function resolveSourceGateAllowlist(env: SourceGateEnv): ReadonlySet<string> {
  if ((env.NODE_ENV ?? '').trim() === 'production') return new Set();
  const deployment = (env[SOURCE_GATE_DEPLOYMENT_ENV] ?? '').trim();
  if (!NON_PRODUCTION_DEPLOYMENTS.has(deployment)) return new Set();
  return parseAllowedSources(env[SOURCE_GATE_ALLOWED_SOURCES_ENV]);
}

function parseAllowedSources(raw: string | undefined): ReadonlySet<string> {
  const allowed = new Set<string>();
  if (raw == null) return allowed;
  for (const part of raw.split(',')) {
    const address = part.trim();
    if (address !== '') allowed.add(address);
  }
  return allowed;
}

/** 用当前进程环境构造来源地址闸。启动包只经这一处读允许名单。 */
export function sourceGateForProcess(env: SourceGateEnv): SourceGate {
  return new SourceGate(resolveSourceGateAllowlist(env));
}

/** 来源地址闸。非名单地址的失败计数只在本进程内存里，进程重启后没有了。 */
@Injectable()
export class SourceGate {
  private readonly buckets = new Map<string, Bucket>();
  private readonly allowed: ReadonlySet<string>;

  constructor(allowed?: ReadonlySet<string>) {
    this.allowed = new Set(allowed ?? []);
  }

  blocked(ip: string | null, now: Date): boolean {
    if (ip == null || ip === '') return false;
    if (this.allowed.has(ip)) return false;
    const bucket = this.buckets.get(ip);
    if (bucket?.blockedUntil == null) return false;
    if (now.getTime() >= bucket.blockedUntil) {
      this.buckets.delete(ip);
      return false;
    }
    return true;
  }

  /** 记一次登录失败。使计数达到 10 的这一次不拒绝，下一次才拒绝。名单内地址不计数。 */
  record(ip: string | null, now: Date): void {
    if (ip == null || ip === '') return;
    if (this.allowed.has(ip)) return;
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
