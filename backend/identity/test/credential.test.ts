// 口令散列单测（#52，unit 层无库）：argon2 0.45.1 预编译二进制免编译可用性的实测腿
//（工具链容器 alpine x86_64 musl；--ignore-scripts 安装下直接加载包内 prebuilds）。
// 期望值为 PHC 串形制的独立字面编码（$argon2id 前缀），一旦退化为明文或不符即红。
// #97：定版参数与「参数不符则重写且不改上次改密时间」。
import { hash as hashWithDefaults } from 'argon2';
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
    // 成功交回当前散列（#132）：改密拿它作条件更新的期望值。
    await expect(service.authenticate('known', 's3cret-pass')).resolves.toBe(hash);
    await expect(service.authenticate('known', 'wrong-pass')).resolves.toBeNull();
    await expect(service.authenticate('missing', 's3cret-pass')).resolves.toBeNull();
  });

  it('currentPasswordHash 只读当前散列、不验真（#292 强制改密）', async () => {
    const hash = await new CredentialService(noopStore()).hashPassword('s3cret-pass');
    const service = new CredentialService(noopStore({
      known: { passwordHash: hash },
      blank: { passwordHash: null },
    }));
    await expect(service.currentPasswordHash('known')).resolves.toBe(hash);
    await expect(service.currentPasswordHash('blank')).resolves.toBeNull();
    await expect(service.currentPasswordHash('missing')).resolves.toBeNull();
  });

  it('验真成功且已存参数与定版不符时按定版重写，上次改密时间不变', async () => {
    const changedAt = new Date('2026-01-15T00:00:00.000Z');
    const row = {
      passwordHash: await hashWithDefaults('s3cret-pass'),
      passwordChangedAt: changedAt,
    };
    const store = {
      findPersonnelById: async (id: string) => (
        id === 'known' ? { id, passwordHash: row.passwordHash } : null
      ),
      replacePasswordHash: async (_id: string, expected: string, passwordHash: string) => {
        if (row.passwordHash !== expected) return false;
        row.passwordHash = passwordHash;
        return true;
      },
    } as unknown as IdentityStore;
    const service = new CredentialService(store);
    const returned = await service.authenticate('known', 's3cret-pass');
    expect(returned).toBe(row.passwordHash);
    expect(row.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);
    expect(row.passwordChangedAt).toEqual(new Date('2026-01-15T00:00:00.000Z'));
    await expect(service.verifyHash(row.passwordHash, 's3cret-pass')).resolves.toBe(true);
  });

  it('重散列期间散列被并发重设换掉时不覆盖新散列，并拒绝本次认证', async () => {
    const legacy = await hashWithDefaults('old-pass-1A!');
    const resetHash = await new CredentialService(noopStore()).hashPassword('New-reset-9x');
    const row = { passwordHash: legacy };
    const store = {
      findPersonnelById: async () => {
        const snapshot = { id: 'known', passwordHash: row.passwordHash };
        // 读出旧散列之后、写回之前，管理员重设了口令
        row.passwordHash = resetHash;
        return snapshot;
      },
      replacePasswordHash: async (_id: string, expected: string, passwordHash: string) => {
        if (row.passwordHash !== expected) return false;
        row.passwordHash = passwordHash;
        return true;
      },
    } as unknown as IdentityStore;
    const service = new CredentialService(store);
    await expect(service.authenticate('known', 'old-pass-1A!')).resolves.toBeNull();
    expect(row.passwordHash).toBe(resetHash);
  });

  it('已存参数已是定版时验真成功不重写散列', async () => {
    const pinned = await new CredentialService(noopStore()).hashPassword('s3cret-pass');
    const changedAt = new Date('2026-02-01T00:00:00.000Z');
    const row = { passwordHash: pinned, passwordChangedAt: changedAt };
    const store = {
      findPersonnelById: async () => ({ id: 'known', passwordHash: row.passwordHash }),
      replacePasswordHash: async (_id: string, expected: string, passwordHash: string) => {
        if (row.passwordHash !== expected) return false;
        row.passwordHash = passwordHash;
        return true;
      },
    } as unknown as IdentityStore;
    const service = new CredentialService(store);
    await expect(service.authenticate('known', 's3cret-pass')).resolves.toBe(pinned);
    expect(row.passwordHash).toBe(pinned);
    expect(row.passwordChangedAt).toEqual(changedAt);
  });
});

describe('口令历史（ADR 0015，#132）', () => {
  it('历史深度经构造参数注入：默认 5，测试可传 2，读取条数 = 深度 - 1', async () => {
    const limits: number[] = [];
    const store = {
      listRecentPasswordHashes: async (_id: string, limit: number) => {
        limits.push(limit);
        return [];
      },
    } as unknown as IdentityStore;
    expect(new CredentialService(store).historyDepth).toBe(5);
    await new CredentialService(store).isReused('p1', 'Any-pass-1!', null);
    expect(limits).toEqual([4]);
    expect(new CredentialService(store, 2).historyDepth).toBe(2);
    await new CredentialService(store, 2).isReused('p1', 'Any-pass-1!', null);
    expect(limits).toEqual([4, 1]);
  });

  it('isReused 命中当前散列或任一历史散列即为真；带旧 argon2 参数的条目照样命中', async () => {
    const current = await new CredentialService(noopStore()).hashPassword('Current-1!');
    // 旧参数条目：argon2 默认参数（m=65536,t=3,p=4），与定版不同，参数写在 PHC 串里。
    const legacy = await hashWithDefaults('Legacy-pass-1!');
    const store = {
      listRecentPasswordHashes: async () => [legacy],
    } as unknown as IdentityStore;
    const service = new CredentialService(store);
    await expect(service.isReused('p1', 'Current-1!', current)).resolves.toBe(true);
    await expect(service.isReused('p1', 'Legacy-pass-1!', current)).resolves.toBe(true);
    await expect(service.isReused('p1', 'Fresh-pass-1!', current)).resolves.toBe(false);
  });

  it('changePassword 走条件更新 + 追加历史：期望值不成立返回 false，什么都不写', async () => {
    const rotations: Array<Record<string, unknown>> = [];
    let hit = true;
    const store = {
      rotatePasswordHash: async (rotation: Record<string, unknown>) => {
        rotations.push(rotation);
        return hit;
      },
    } as unknown as IdentityStore;
    const service = new CredentialService(store);
    const at = new Date('2026-10-19T03:00:00.000Z');
    await expect(service.changePassword('p1', 'New-pass-1!', at, 'expected-hash')).resolves.toBe(true);
    expect(rotations).toHaveLength(1);
    expect(rotations[0]).toMatchObject({
      personnelId: 'p1',
      expectedHash: 'expected-hash',
      passwordChangedAt: at,
      retiredAt: at,
    });
    await expect(service.verifyHash(String(rotations[0]!.passwordHash), 'New-pass-1!')).resolves.toBe(true);
    // 强制门禁读不到当前散列时按空期望值走条件更新（#292），不伪造空串做验真。
    await expect(service.changePassword('p1', 'New-pass-1!', at, null)).resolves.toBe(true);
    expect(rotations[1]).toMatchObject({ personnelId: 'p1', expectedHash: null });
    hit = false;
    await expect(service.changePassword('p1', 'New-pass-1!', at, 'stale-hash')).resolves.toBe(false);
  });
});

// 最小 store 桩：CredentialService 只消费 findPersonnelById 一项
function noopStore(personnel: Record<string, { passwordHash: string | null }> = {}) {
  return {
    findPersonnelById: async (id: string) =>
      personnel[id] ? { id, passwordHash: personnel[id].passwordHash } : null,
  } as unknown as IdentityStore;
}
