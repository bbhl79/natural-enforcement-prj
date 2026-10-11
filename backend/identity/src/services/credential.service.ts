// 口令凭证服务（#52）：argon2 0.45.1 散列（infra/VERSIONS.md 身份行定案，
// 预编译 linux x64/arm64 容器免编译）。身份校验的「已认证」证据链：
// authenticate = 取 personnel 口令散列验真；人员未失效判定在 AccessControlService。
import { Inject, Injectable } from '@nestjs/common';
import { hash, verify } from 'argon2';

import { IDENTITY_STORE, type IdentityStore } from '../persistence/identity-store.ts';

@Injectable()
export class CredentialService {
  constructor(
    @Inject(IDENTITY_STORE) private readonly store: IdentityStore,
  ) {}

  /** 口令散列为 PHC 形制 argon2id 串（随机盐，同口令两次结果不同） */
  async hashPassword(plain: string): Promise<string> {
    return hash(plain);
  }

  /** 散列验真（不触库；authenticate 的下半段） */
  async verifyHash(digest: string, plain: string): Promise<boolean> {
    return verify(digest, plain);
  }

  /** 人员口令认证：未知人员 / 无口令字段 / 验真失败一律拒绝（不区分原因，防探测） */
  async authenticate(personnelId: string, plain: string): Promise<boolean> {
    const personnel = await this.store.findPersonnelById(personnelId);
    if (!personnel || !personnel.passwordHash) return false;
    return this.verifyHash(personnel.passwordHash, plain);
  }
}
