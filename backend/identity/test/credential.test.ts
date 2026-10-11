// 口令散列单测（#52，unit 层无库）：argon2 0.45.1 预编译二进制免编译可用性的实测腿
//（工具链容器 alpine x86_64 musl；--ignore-scripts 安装下直接加载包内 prebuilds）。
// 期望值为 PHC 串形制的独立字面编码（$argon2id 前缀），一旦退化为明文或不符即红。
import { describe, expect, it } from 'vitest';

import { CredentialService } from '../src/services/credential.service.ts';
import type { IdentityStore } from '../src/persistence/identity-store.ts';

describe('口令散列（argon2 0.45.1，#52）', () => {
  it('散列产出 PHC 形制的 argon2id 串，绝非明文', async () => {
    const service = new CredentialService(noopStore());
    const hash = await service.hashPassword('s3cret-pass');
    expect(hash).toMatch(/^\$argon2id\$v=19\$/);
    expect(hash).not.toContain('s3cret-pass');
  });

  it('同口令散列两次结果不同（随机盐），且均可验真', async () => {
    const service = new CredentialService(noopStore());
    const first = await service.hashPassword('s3cret-pass');
    const second = await service.hashPassword('s3cret-pass');
    expect(first).not.toBe(second);
    await expect(service.verifyHash(first, 's3cret-pass')).resolves.toBe(true);
    await expect(service.verifyHash(second, 's3cret-pass')).resolves.toBe(true);
  });

  it('错误口令验真拒绝', async () => {
    const service = new CredentialService(noopStore());
    const hash = await service.hashPassword('s3cret-pass');
    await expect(service.verifyHash(hash, 'wrong-pass')).resolves.toBe(false);
  });

  it('authenticate 经 store 取 personnel 口令散列验真；未知人员或无口令拒绝', async () => {
    const hash = await new CredentialService(noopStore()).hashPassword('s3cret-pass');
    const store = noopStore({
      known: { passwordHash: hash },
    });
    const service = new CredentialService(store);
    await expect(service.authenticate('known', 's3cret-pass')).resolves.toBe(true);
    await expect(service.authenticate('known', 'wrong-pass')).resolves.toBe(false);
    await expect(service.authenticate('missing', 's3cret-pass')).resolves.toBe(false);
  });
});

// 最小 store 桩：CredentialService 只消费 findPersonnelById 一项
function noopStore(personnel: Record<string, { passwordHash: string | null }> = {}) {
  return {
    findPersonnelById: async (id: string) =>
      personnel[id] ? { id, passwordHash: personnel[id].passwordHash } : null,
  } as unknown as IdentityStore;
}
