// #119 事务前置：业务行与留痕同成同败，拒绝留痕在回滚后另起事务写入。
// 用内存「库」模拟事务：body 正常结束才把本事务的写入并入已提交的行。
import { describe, expect, it } from 'vitest';

import {
  AUDIT_ACTION_AUTHZ_DENIED,
  rejected,
  runAuditedTransaction,
  type AuditEntry,
  type AuditTrailFactory,
  type AuthzDeniedEntry,
  type OpenTransaction,
} from '../src/index.ts';

type Tx = { rows: string[] };

function memoryDb() {
  const committed: string[] = [];
  let opened = 0;
  const open: OpenTransaction<Tx> = async (body) => {
    opened += 1;
    const tx: Tx = { rows: [] };
    const result = await body(tx);
    committed.push(...tx.rows);
    return result;
  };
  const factory: AuditTrailFactory = {
    forClient: (client) => ({
      append: async (entry: AuditEntry) => {
        (client as Tx).rows.push(`audit:${entry.action}`);
      },
    }),
  };
  return { committed, open, factory, opened: () => opened };
}

const denial: AuthzDeniedEntry = {
  action: AUDIT_ACTION_AUTHZ_DENIED,
  outcome: 'failed',
  actorId: null,
  actorCode: 'P-1',
  subjectPersonnelId: null,
  subjectCode: null,
  orgUnitId: null,
  sourceIp: null,
  reason: 'permission-denied',
  opcode: 'personnel.locked.release',
  resourceType: 'personnel',
  resourceId: 'p-2',
  previousValue: null,
};

describe('runAuditedTransaction', () => {
  it('正常返回时业务行与留痕一起提交', async () => {
    const db = memoryDb();
    const result = await runAuditedTransaction(db.open, (tx) => tx, db.factory, async (tx, audit) => {
      tx.rows.push('business');
      await audit.append({ ...denial, action: 'authz.denied' });
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(db.committed).toEqual(['business', 'audit:authz.denied']);
  });

  it('留痕写入抛错时业务行回滚，错误原样抛出', async () => {
    const db = memoryDb();
    const failing: AuditTrailFactory = {
      forClient: (client) => ({
        append: async (entry: AuditEntry) => {
          await db.factory.forClient(client).append(entry);
          throw new Error('业务写完后抛错');
        },
      }),
    };
    await expect(runAuditedTransaction(db.open, (tx) => tx, failing, async (tx, audit) => {
      tx.rows.push('business');
      await audit.append(denial);
      return 'ok';
    })).rejects.toThrow('业务写完后抛错');
    expect(db.committed).toEqual([]);
  });

  it('返回 rejected 时业务行回滚，另起一个事务写拒绝留痕并返回结果', async () => {
    const db = memoryDb();
    const result = await runAuditedTransaction<Tx, { status: number }>(
      db.open,
      (tx) => tx,
      db.factory,
      async (tx) => {
        tx.rows.push('business');
        return rejected({ status: 403 }, denial);
      },
    );
    expect(result).toEqual({ status: 403 });
    expect(db.committed).toEqual(['audit:authz.denied']);
    expect(db.opened()).toBe(2);
  });

  it('rejected 不带留痕时不再开第二个事务', async () => {
    const db = memoryDb();
    const result = await runAuditedTransaction<Tx, string>(db.open, (tx) => tx, db.factory, async (tx) => {
      tx.rows.push('business');
      return rejected('no');
    });
    expect(result).toBe('no');
    expect(db.committed).toEqual([]);
    expect(db.opened()).toBe(1);
  });
});
