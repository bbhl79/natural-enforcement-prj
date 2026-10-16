// 口令凭证服务（#52）：argon2 0.45.1 散列（infra/VERSIONS.md 身份行定案，
// 预编译 linux x64/arm64 容器免编译）。身份校验的「已认证」证据链：
// authenticate = 取 personnel 口令散列验真；人员未失效判定在 AccessControlService。
import { Inject, Injectable } from '@nestjs/common';
import { argon2id, hash, needsRehash, verify, type HashOptions } from 'argon2';

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

@Injectable()
export class CredentialService {
  constructor(
    @Inject(IDENTITY_STORE) private readonly store: IdentityStore,
  ) {}

  /** 口令散列为 PHC 形制 argon2id 串（随机盐，同口令两次结果不同） */
  async hashPassword(plain: string): Promise<string> {
    return hash(plain, ARGON2_OPTIONS);
  }

  /** 散列验真（不触库；authenticate 的下半段） */
  async verifyHash(digest: string, plain: string): Promise<boolean> {
    return verify(digest, plain);
  }

  /** 人员口令认证：未知人员 / 无口令字段 / 验真失败一律拒绝（不区分原因，防探测） */
  async authenticate(personnelId: string, plain: string): Promise<boolean> {
    const personnel = await this.store.findPersonnelById(personnelId);
    if (!personnel || !personnel.passwordHash) return false;
    const accepted = await this.verifyHash(personnel.passwordHash, plain);
    if (!accepted) return false;
    if (!personnel.passwordHash.startsWith('$argon2id$') || needsRehash(personnel.passwordHash, {
      memoryCost: ARGON2_OPTIONS.memoryCost,
      timeCost: ARGON2_OPTIONS.timeCost,
      parallelism: ARGON2_OPTIONS.parallelism,
    })) {
      await this.store.replacePasswordHash(personnelId, await this.hashPassword(plain));
    }
    return true;
  }

  /** 改密或重设：按定版参数写入新散列，并记下改密时间。 */
  async changePassword(personnelId: string, plain: string, passwordChangedAt: Date): Promise<void> {
    await this.store.changePassword(personnelId, await this.hashPassword(plain), passwordChangedAt);
  }
}
