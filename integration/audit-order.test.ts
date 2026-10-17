// 留痕同毫秒写入的先后。断言打在按 created_at, id 取回的行序上。
// created_at 是毫秒精度。同一进程内并发发起的追加多半落在同一毫秒，
// created_at 相同时行序只能由编号决定，编号须随调用先后递增。
import { PrismaAuditTrail } from '@natural-enforcement/audit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { openClonedDatabase, type ClonedDatabase } from './cloned-database.ts';

const ROWS = 300;

let cloned: ClonedDatabase;

beforeAll(async () => {
  cloned = await openClonedDatabase();
});

afterAll(async () => {
  await cloned?.close();
});

describe('留痕取回顺序', () => {
  it('同一进程同一毫秒内依次发起的追加，按 created_at, id 取回时与发起先后一致', async () => {
    const trail = new PrismaAuditTrail(cloned.prisma);
    const markers = Array.from({ length: ROWS }, (_unused, i) => `order-${String(i).padStart(4, '0')}`);
    await Promise.all(
      markers.map((marker) =>
        trail.append({
          action: 'login.succeeded',
          actorId: null,
          actorCode: null,
          subjectPersonnelId: null,
          subjectCode: null,
          orgUnitId: null,
          sourceIp: null,
          resourceType: 'audit-order',
          resourceId: marker,
        }),
      ),
    );

    const rows = await cloned.prisma.$queryRaw<{ resource_id: string }[]>`
      SELECT resource_id
      FROM audit_trail
      WHERE resource_type = 'audit-order'
      ORDER BY created_at, id
    `;
    expect(rows.map((row) => row.resource_id)).toEqual(markers);
  });
});
