// 集成测试选库（#93）：测试进程的数据库地址指向 it_template。
// 用例从它复制出 e2_时间戳，断言打在复制品上，结束时整库删除。
// 开发库 postgres 不作为复制源。
import { PrismaPg } from '@prisma/adapter-pg';
import { expect, it } from 'vitest';

import { PrismaClient } from '../backend/prisma/generated/prisma/client.ts';
import { openClonedDatabase } from './cloned-database.ts';

it('测试进程的数据库地址指向 it_template', () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL 未注入（须由 dev test integration harness 提供）');
  const sourceDb = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ''));
  expect(sourceDb).toBe('it_template');
});

it('用例从 it_template 复制出 e2_时间戳，断言打在复制品上，结束时整库删除', async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL 未注入（须由 dev test integration harness 提供）');
  const opened = await openClonedDatabase();
  try {
    expect(opened.sourceDb).toBe('it_template');
    expect(opened.scratchDbName).toMatch(/^e2_\d+$/);
    const current = await opened.prisma.$queryRaw<{ name: string }[]>`
      SELECT current_database() AS name
    `;
    expect(current[0]?.name).toBe(opened.scratchDbName);
    const seeded = await opened.prisma.personnel.findUnique({ where: { code: 'P-SUP-A' } });
    expect(seeded?.code).toBe('P-SUP-A');
  } finally {
    const scratchDbName = opened.scratchDbName;
    await opened.close();
    const adminUrl = new URL(databaseUrl);
    adminUrl.pathname = '/template1';
    const admin = new PrismaClient({
      adapter: new PrismaPg({ connectionString: adminUrl.toString() }),
    });
    try {
      const names = await admin.$queryRaw<{ datname: string }[]>`
        SELECT datname FROM pg_database WHERE datname IN ('it_template', 'postgres', ${scratchDbName})
      `;
      const present = names.map((row) => row.datname).sort();
      expect(present).toEqual(['it_template', 'postgres']);
    } finally {
      await admin.$disconnect();
    }
  }
});
