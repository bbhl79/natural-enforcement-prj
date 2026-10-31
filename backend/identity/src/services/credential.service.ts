// 口令凭证服务（#52）：argon2 0.45.1 散列（infra/VERSIONS.md 身份行定案，
// 预编译 linux x64/arm64 容器免编译）。身份校验的「已认证」证据链：
// authenticate = 取 personnel 口令散列验真；人员未失效判定在 AccessControlService。
// 口令历史（ADR 0015，#132）：比对口径「当前口令 + 最近 depth-1 条历史」，
// 深度经构造参数注入（PASSWORD_HISTORY_DEPTH_TOKEN 令牌），默认取 password-policy 的常量。
import { Inject, Injectable } from '@nestjs/common';
import { argon2id, hash, needsRehash, verify, type HashOptions } from 'argon2';

import { PASSWORD_HISTORY_DEPTH as DEFAULT_HISTORY_DEPTH } from '../domain/password-policy.ts';
import { IDENTITY_STORE, type IdentityStore } from '../persistence/identity-store.ts';

/**
 * 定版散列参数。下限为 argon2id、内存 19 MiB、迭代 2 次、并行度 1。
 * 记入 infra/VERSIONS.md。memoryCost 单位是 KiB。
 */
export const ARGON2_OPTIONS: HashOptions = {
  type: argon2id,
  memoryCost: 19 * 1024,
  timeCost: 2,
  parallelism: 1,
};

/** 注入令牌：口令历史比对深度（ADR 0015）。宿主绑定值；测试可覆写为 2。数值常量见 password-policy。 */
export const PASSWORD_HISTORY_DEPTH_TOKEN = Symbol('PASSWORD_HISTORY_DEPTH');

@Injectable()
export class CredentialService {
  constructor(
    @Inject(IDENTITY_STORE) private readonly store: IdentityStore,
    @Inject(PASSWORD_HISTORY_DEPTH_TOKEN) readonly historyDepth: number = DEFAULT_HISTORY_DEPTH,
  ) {}

  /** 口令散列为 PHC 形制 argon2id 串（随机盐，同口令两次结果不同） */
  async hashPassword(plain: string): Promise<string> {
    return hash(plain, ARGON2_OPTIONS);
  }

  /** 散列验真（不触库；authenticate 的下半段） */
  async verifyHash(digest: string, plain: string): Promise<boolean> {
    return verify(digest, plain);
  }

  /**
   * 人员口令认证：未知人员 / 无口令字段 / 验真失败一律拒绝（不区分原因，防探测）。
   * 成功返回当前生效的散列（旧参数时已按定版重算），供改密作条件更新的期望值（#132）；失败返回 null。
   */
  async authenticate(personnelId: string, plain: string): Promise<string | null> {
    const personnel = await this.store.findPersonnelById(personnelId);
    if (!personnel || !personnel.passwordHash) return null;
    const accepted = await this.verifyHash(personnel.passwordHash, plain);
    if (!accepted) return null;
    let current = personnel.passwordHash;
    if (!current.startsWith('$argon2id$') || needsRehash(current, {
      memoryCost: ARGON2_OPTIONS.memoryCost,
      timeCost: ARGON2_OPTIONS.timeCost,
      parallelism: ARGON2_OPTIONS.parallelism,
    })) {
      const rehashed = await this.hashPassword(plain);
      const replaced = await this.store.replacePasswordHash(personnelId, current, rehashed);
      // 散列已被并发的重设或改密换掉：本次验真针对的是旧口令，拒绝。
      if (!replaced) return null;
      current = rehashed;
    }
    return current;
  }

  /**
   * 读取人员当前生效的口令散列，不做验真（#292）：强制改密门禁没有当前口令可验，
   * 用库中散列作历史比对与条件更新的期望值。
   */
  async currentPasswordHash(personnelId: string): Promise<string | null> {
    const personnel = await this.store.findPersonnelById(personnelId);
    return personnel?.passwordHash ?? null;
  }

  /**
   * 历史比对（ADR 0015）：逐条调用 verifyHash，不比较散列串，也不重新计算散列去对比。
   * 每条历史散列自带随机盐；带旧 argon2 参数的条目照样能命中（参数写在 PHC 串里）。
   * 空散列（此前没有口令）跳过。
   */
  async matchesAny(digests: ReadonlyArray<string | null>, plain: string): Promise<boolean> {
    for (const digest of digests) {
      if (digest !== null && await this.verifyHash(digest, plain)) return true;
    }
    return false;
  }

  /**
   * 新口令是否命中「当前散列 + 最近 depth-1 条历史」（ADR 0015），共比较 depth 个散列。
   * 只在其余口令规则全部通过后调用，省掉不必要的 argon2 计算。
   */
  async isReused(personnelId: string, plain: string, currentHash: string | null): Promise<boolean> {
    const digests = await this.store.listRecentPasswordHashes(personnelId, this.historyDepth - 1);
    return this.matchesAny([currentHash, ...digests], plain);
  }

  /**
   * 本人改密（#132）：散列在事务外计算；事务内以认证时读到的散列为期望值做条件更新，
   * 并把旧散列追加进历史。期望值不成立（并发已换掉）返回 false，什么都不写，
   * 由调用方回 409 concurrent-change。
   */
  async changePassword(
    personnelId: string,
    plain: string,
    passwordChangedAt: Date,
    expectedHash: string | null,
  ): Promise<boolean> {
    return this.store.rotatePasswordHash({
      personnelId,
      expectedHash,
      passwordHash: await this.hashPassword(plain),
      passwordChangedAt,
      retiredAt: passwordChangedAt,
    });
  }
}
