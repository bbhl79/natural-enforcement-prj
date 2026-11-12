// 用途：为集成用例复制一次性数据库，使断言与收尾不影响模板库与开发库。
// 集成测试选库（#93）：从 it_template 复制出 e2_时间戳。
// 断言打在复制品上。结束时整库删除。开发库 postgres 不作为复制源。
import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../backend/prisma/generated/prisma/client.ts';

const IT_TEMPLATE_DB = 'it_template';

/** 一次克隆的句柄：克隆库名、复制源、连接串，以及连库客户端与销毁方法。 */
export type ClonedDatabase = {
  prisma: PrismaClient;
  scratchDbName: string;
  sourceDb: string;
  connectionString: string;
  close: () => Promise<void>;
};

function quoteIdent(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`非法数据库标识：${name}`);
  }
  return `"${name}"`;
}

/**
 * 以 it_template 为模板建一个 e2_<时间戳> 克隆库并返回其客户端。
 * 复制源不是 it_template 或 DATABASE_URL 缺失时抛错；建库最多重试 10 次。
 * close 先断开克隆连接，再用 FORCE 删除克隆库。
 * 调用方：integration 下多数集成用例的 beforeAll，例如 integration/clue-verification.test.ts。
 */
export async function openClonedDatabase(): Promise<ClonedDatabase> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL 未注入（须由 dev test integration harness 提供）');
  const sourceDb = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ''));
  if (sourceDb !== IT_TEMPLATE_DB) {
    throw new Error(`集成测试复制源必须是 it_template，当前是 ${sourceDb}`);
  }
  const scratchDbName = `e2_${Date.now()}`;
  const adminUrl = new URL(databaseUrl);
  adminUrl.pathname = '/template1';
  const adminPrisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: adminUrl.toString() }),
  });
  let created = false;
  let lastError: unknown;
  for (let attempt = 0; attempt < 10 && !created; attempt += 1) {
    try {
      await adminPrisma.$executeRawUnsafe(
        `CREATE DATABASE ${quoteIdent(scratchDbName)} TEMPLATE ${quoteIdent(sourceDb)}`,
      );
      created = true;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
  if (!created) {
    await adminPrisma.$disconnect();
    throw lastError;
  }
  const scratchUrl = new URL(databaseUrl);
  scratchUrl.pathname = `/${scratchDbName}`;
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: scratchUrl.toString() }),
  });
  return {
    prisma,
    scratchDbName,
    sourceDb,
    connectionString: scratchUrl.toString(),
    close: async () => {
      try {
        await prisma.$disconnect();
      } finally {
        try {
          await adminPrisma.$executeRawUnsafe(
            `DROP DATABASE IF EXISTS ${quoteIdent(scratchDbName)} WITH (FORCE)`,
          );
        } finally {
          await adminPrisma.$disconnect();
        }
      }
    },
  };
}
