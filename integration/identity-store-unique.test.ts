// #119 身份存储层：业务唯一冲突（工号、手机号、人员—角色）统一返回「已存在」结果，不抛未处理异常。
// 在交互式事务里冲突时只撤销这一笔写入，事务仍可继续并提交。
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newUlid } from '../backend/identity/src/index.ts';
import { PrismaIdentityStore } from '../backend/identity/src/persistence/prisma-identity-store.ts';
import { openClonedDatabase, type ClonedDatabase } from './cloned-database.ts';

let cloned: ClonedDatabase;
let store: PrismaIdentityStore;
let deptAId = '';
let roleId = '';

function person(code: string, mobilePhone: string | null) {
  return { id: newUlid(), code, name: code, orgUnitId: deptAId, passwordHash: null, mobilePhone };
}

beforeAll(async () => {
  cloned = await openClonedDatabase();
  store = new PrismaIdentityStore(cloned.prisma);
  deptAId = (await cloned.prisma.orgUnit.findUniqueOrThrow({ where: { code: 'ORG-DEPT-A' } })).id;
  roleId = (await cloned.prisma.role.findFirstOrThrow({ where: { name: '经办', deactivatedAt: null } })).id;
}, 60_000);

afterAll(async () => {
  await cloned?.close();
});

describe('业务唯一冲突映射为「已存在」', () => {
  it('工号重复：返回 personnel-code，库里只有原来那一行', async () => {
    expect(await store.insertPersonnel(person('P-119-U1', '13800011951'))).toEqual({ result: 'written' });
    expect(await store.insertPersonnel(person('P-119-U1', '13800011952'))).toEqual({
      result: 'already-exists',
      conflict: 'personnel-code',
    });
    expect(await cloned.prisma.personnel.count({ where: { code: 'P-119-U1' } })).toBe(1);
    expect(await cloned.prisma.personnel.count({ where: { mobilePhone: '13800011952' } })).toBe(0);
  });

  it('手机号重复：登记返回 mobile-phone；改手机号撞上他人也返回 mobile-phone', async () => {
    expect(await store.insertPersonnel(person('P-119-U2', '13800011961'))).toEqual({ result: 'written' });
    expect(await store.insertPersonnel(person('P-119-U3', '13800011961'))).toEqual({
      result: 'already-exists',
      conflict: 'mobile-phone',
    });
    expect(await cloned.prisma.personnel.count({ where: { code: 'P-119-U3' } })).toBe(0);
    const other = person('P-119-U4', '13800011962');
    expect(await store.insertPersonnel(other)).toEqual({ result: 'written' });
    expect(await store.updatePersonnelMobilePhone(other.id, '13800011961')).toEqual({
      result: 'already-exists',
      conflict: 'mobile-phone',
    });
    const row = await cloned.prisma.personnel.findUniqueOrThrow({ where: { id: other.id } });
    expect(row.mobilePhone).toBe('13800011962');
    expect(await store.updatePersonnelMobilePhone(other.id, '13800011963')).toEqual({ result: 'written' });
  });

  it('重复授予同一角色：返回 personnel-role；摘除后可再次授予', async () => {
    const holder = person('P-119-U5', null);
    await store.insertPersonnel(holder);
    const first = { id: newUlid(), personnelId: holder.id, roleId };
    expect(await store.insertPersonnelRole(first)).toEqual({ result: 'written' });
    expect(await store.insertPersonnelRole({ id: newUlid(), personnelId: holder.id, roleId })).toEqual({
      result: 'already-exists',
      conflict: 'personnel-role',
    });
    expect(await cloned.prisma.personnelRole.count({ where: { personnelId: holder.id } })).toBe(1);
    await cloned.prisma.personnelRole.update({ where: { id: first.id }, data: { deactivatedAt: new Date() } });
    expect(await store.insertPersonnelRole({ id: newUlid(), personnelId: holder.id, roleId })).toEqual({
      result: 'written',
    });
  });

  it('事务里冲突后事务仍可用：后续写入照常提交', async () => {
    const existing = person('P-119-U6', '13800011971');
    await store.insertPersonnel(existing);
    const fresh = person('P-119-U7', '13800011972');
    const outcome = await store.inTransaction(async ({ store: tx }) => {
      const duplicate = await tx.insertPersonnel(person('P-119-U6', null));
      const duplicateRole = await tx.insertPersonnelRole({ id: newUlid(), personnelId: existing.id, roleId });
      const again = await tx.insertPersonnelRole({ id: newUlid(), personnelId: existing.id, roleId });
      const written = await tx.insertPersonnel(fresh);
      return { duplicate, duplicateRole, again, written };
    });
    expect(outcome).toEqual({
      duplicate: { result: 'already-exists', conflict: 'personnel-code' },
      duplicateRole: { result: 'written' },
      again: { result: 'already-exists', conflict: 'personnel-role' },
      written: { result: 'written' },
    });
    expect(await cloned.prisma.personnel.count({ where: { code: 'P-119-U7' } })).toBe(1);
    expect(await cloned.prisma.personnelRole.count({ where: { personnelId: existing.id } })).toBe(1);
  });

  it('事务里抛错时整体回滚', async () => {
    const lost = person('P-119-U8', '13800011981');
    await expect(store.inTransaction(async ({ store: tx }) => {
      await tx.insertPersonnel(lost);
      throw new Error('回滚');
    })).rejects.toThrow('回滚');
    expect(await cloned.prisma.personnel.count({ where: { code: 'P-119-U8' } })).toBe(0);
  });
});
