// 启动包装配（ADR 0004 / ADR 0012）。
// 本文件是启动包里唯一直接引用身份数据库适配器的文件。
// 它也装配留痕适配器。根类型检查排除本文件：生成客户端只在容器里存在。
import 'reflect-metadata';

import { Module, type DynamicModule, type OnModuleDestroy } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PrismaPg } from '@prisma/adapter-pg';

import {
  PrismaAuditTrailReader,
  prismaAuditTrailFactory,
  type AuditTrailReadClient,
} from '../../../packages/audit/src/prisma-audit-trail.ts';
import {
  AUDIT_TRAIL_FACTORY,
  AUDIT_TRAIL_PORT,
  runAuditedTransaction,
  type AuditTrailFactory,
  type Rejected,
} from '@natural-enforcement/audit';
import {
  BootstrapService,
  CredentialService,
  IDENTITY_STORE,
  NO_OPEN_ITEMS,
  OPEN_ITEMS_COUNTER,
  PASSWORD_HISTORY_DEPTH,
  PASSWORD_HISTORY_DEPTH_TOKEN,
  type BootstrapHooks,
  type BootstrapOutcome,
  type BootstrapRequest,
  type OpenItemsCounter,
} from '@natural-enforcement/identity';
import { PrismaIdentityStore } from '../../identity/src/persistence/prisma-identity-store.ts';
import { PrismaClient, type Prisma } from '../../prisma/generated/prisma/client.ts';

import { AppModule } from './app.module.ts';
import { CLOCK, type Clock } from './clock.ts';
import {
  LOGIN_DIRECTORY,
  type FailureSnapshot,
  type LockedPersonnel,
  type LoginAccount,
  type LoginDirectory,
} from './login-directory.ts';
import {
  REMEMBER_ME_STORE,
  type NewRememberMe,
  type RememberMeRow,
  type RememberMeStore,
} from './remember-me-store.ts';
import {
  DEFAULT_SESSION_CAPACITY,
  SESSION_CAPACITY,
  SESSION_STORE,
  type NewSession,
  type SessionRow,
  type SessionStore,
} from './session-store.ts';
import { UNIT_OF_WORK, type TxScope, type UnitOfWork } from './unit-of-work.ts';

const PRISMA = Symbol('PRISMA');

/** Prisma 根客户端，或一个交互式事务客户端（#119）。 */
type Db = PrismaClient | Prisma.TransactionClient;

function byCodePoint(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

class PrismaLoginDirectory implements LoginDirectory {
  constructor(private readonly prisma: Db) {}

  async findByMobile(mobile: string): Promise<LoginAccount | null> {
    const person = await this.prisma.personnel.findUnique({ where: { mobilePhone: mobile } });
    if (!person) return null;
    return this.toAccount(person);
  }

  async findById(id: string): Promise<LoginAccount | null> {
    const person = await this.prisma.personnel.findUnique({ where: { id } });
    if (!person) return null;
    return this.toAccount(person);
  }

  async saveFailure(id: string, snapshot: FailureSnapshot): Promise<void> {
    await this.prisma.personnel.update({
      where: { id },
      data: {
        passwordFailureCount: snapshot.count,
        passwordFailureWindowStartedAt: snapshot.windowStartedAt,
        lockedUntil: snapshot.lockedUntil,
      },
    });
  }

  async clearFailure(id: string): Promise<void> {
    await this.prisma.personnel.update({
      where: { id },
      data: {
        passwordFailureCount: 0,
        passwordFailureWindowStartedAt: null,
        lockedUntil: null,
      },
    });
  }

  async listLocked(now: Date): Promise<LockedPersonnel[]> {
    const people = await this.prisma.personnel.findMany({
      where: { lockedUntil: { gt: now } },
      include: {
        assignments: {
          where: { endedAt: null },
          include: { orgUnit: true },
        },
      },
      orderBy: { code: 'asc' },
    });
    return people.flatMap((person) => {
      if (person.lockedUntil == null) return [];
      const assignment = person.assignments[0] ?? null;
      return [{
        id: person.id,
        code: person.code,
        name: person.name,
        orgUnitId: assignment?.orgUnitId ?? null,
        orgName: assignment?.orgUnit.name ?? null,
        lockedUntil: person.lockedUntil,
      }];
    });
  }

  async isRootOrg(orgUnitId: string): Promise<boolean> {
    const org = await this.prisma.orgUnit.findUnique({ where: { id: orgUnitId } });
    return org != null && org.parentId == null;
  }

  async rootOrgId(): Promise<string | null> {
    const org = await this.prisma.orgUnit.findFirst({
      where: { parentId: null, deactivatedAt: null },
      orderBy: { code: 'asc' },
    });
    return org?.id ?? null;
  }

  private async toAccount(person: {
    id: string;
    code: string;
    name: string;
    passwordChangedAt: Date | null;
    deactivatedAt: Date | null;
    passwordFailureCount: number;
    passwordFailureWindowStartedAt: Date | null;
    lockedUntil: Date | null;
  }): Promise<LoginAccount> {
    const assignment = await this.prisma.personnelAssignment.findFirst({
      where: { personnelId: person.id, endedAt: null },
      include: { orgUnit: true },
    });
    const bindings = await this.prisma.personnelRole.findMany({
      where: { personnelId: person.id, deactivatedAt: null, role: { deactivatedAt: null } },
      include: { role: true },
    });
    const roles = bindings.map((binding) => binding.role.name).sort(byCodePoint);
    return {
      id: person.id,
      code: person.code,
      name: person.name,
      passwordChangedAt: person.passwordChangedAt,
      deactivatedAt: person.deactivatedAt,
      failureCount: person.passwordFailureCount,
      failureWindowStartedAt: person.passwordFailureWindowStartedAt,
      lockedUntil: person.lockedUntil,
      orgUnitId: assignment?.orgUnitId ?? null,
      orgName: assignment?.orgUnit.name ?? null,
      roles,
    };
  }
}

class PrismaSessionStore implements SessionStore {
  constructor(private readonly prisma: Db) {}

  async insert(row: NewSession): Promise<void> {
    await this.prisma.authSession.create({
      data: {
        id: row.id,
        personnelId: row.personnelId,
        secretHash: row.secretHash,
        rememberMeChainId: row.rememberMeChainId,
        authenticatedAt: row.authenticatedAt,
        lastSeenAt: row.lastSeenAt,
        absoluteEndsAt: row.absoluteEndsAt,
      },
    });
  }

  async findBySecretHash(secretHash: string): Promise<SessionRow | null> {
    const row = await this.prisma.authSession.findUnique({ where: { secretHash } });
    if (!row) return null;
    return {
      id: row.id,
      personnelId: row.personnelId,
      secretHash: row.secretHash,
      rememberMeChainId: row.rememberMeChainId,
      authenticatedAt: row.authenticatedAt,
      lastSeenAt: row.lastSeenAt,
      absoluteEndsAt: row.absoluteEndsAt,
      endedAt: row.endedAt,
    };
  }

  async touch(id: string, lastSeenAt: Date): Promise<void> {
    await this.prisma.authSession.update({ where: { id }, data: { lastSeenAt } });
  }

  async end(id: string, endedAt: Date, reason: string): Promise<void> {
    await this.prisma.authSession.update({
      where: { id },
      data: { endedAt, endReason: reason },
    });
  }

  async listActive(personnelId: string): Promise<SessionRow[]> {
    const rows = await this.prisma.authSession.findMany({
      where: { personnelId, endedAt: null },
      orderBy: { authenticatedAt: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      personnelId: row.personnelId,
      secretHash: row.secretHash,
      rememberMeChainId: row.rememberMeChainId,
      authenticatedAt: row.authenticatedAt,
      lastSeenAt: row.lastSeenAt,
      absoluteEndsAt: row.absoluteEndsAt,
      endedAt: row.endedAt,
    }));
  }

  async listOpen(): Promise<SessionRow[]> {
    const rows = await this.prisma.authSession.findMany({ where: { endedAt: null } });
    return rows.map((row) => ({
      id: row.id,
      personnelId: row.personnelId,
      secretHash: row.secretHash,
      rememberMeChainId: row.rememberMeChainId,
      authenticatedAt: row.authenticatedAt,
      lastSeenAt: row.lastSeenAt,
      absoluteEndsAt: row.absoluteEndsAt,
      endedAt: row.endedAt,
    }));
  }
}

class LostRace extends Error {}

function isLostRace(error: unknown): boolean {
  if (error instanceof LostRace) return true;
  if (typeof error !== 'object' || error == null) return false;
  const code = 'code' in error ? String(error.code) : '';
  if (code === 'P2002') return true;
  const message = 'message' in error ? String(error.message) : '';
  return message.includes('predecessor_id');
}

class PrismaRememberMeStore implements RememberMeStore {
  /** root 为空表示本存储绑定在调用方的交互式事务里。 */
  constructor(private readonly prisma: Db, private readonly root: PrismaClient | null) {}

  async insert(row: NewRememberMe): Promise<void> {
    await this.prisma.authRememberMe.create({
      data: {
        id: row.id,
        personnelId: row.personnelId,
        chainId: row.chainId,
        secretHash: row.secretHash,
        absoluteEndsAt: row.absoluteEndsAt,
        predecessorId: row.predecessorId,
        createdAt: row.createdAt,
      },
    });
  }

  async findBySecretHash(secretHash: string): Promise<RememberMeRow | null> {
    const row = await this.prisma.authRememberMe.findUnique({ where: { secretHash } });
    if (!row) return null;
    return {
      id: row.id,
      personnelId: row.personnelId,
      chainId: row.chainId,
      secretHash: row.secretHash,
      absoluteEndsAt: row.absoluteEndsAt,
      predecessorId: row.predecessorId,
      endedAt: row.endedAt,
      endReason: row.endReason,
      createdAt: row.createdAt,
    };
  }

  async findSuccessor(predecessorId: string): Promise<RememberMeRow | null> {
    const row = await this.prisma.authRememberMe.findUnique({ where: { predecessorId } });
    if (!row) return null;
    return {
      id: row.id,
      personnelId: row.personnelId,
      chainId: row.chainId,
      secretHash: row.secretHash,
      absoluteEndsAt: row.absoluteEndsAt,
      predecessorId: row.predecessorId,
      endedAt: row.endedAt,
      endReason: row.endReason,
      createdAt: row.createdAt,
    };
  }

  async end(id: string, endedAt: Date, reason: string): Promise<void> {
    await this.prisma.authRememberMe.update({
      where: { id },
      data: { endedAt, endReason: reason },
    });
  }

  async endActiveOnChain(chainId: string, endedAt: Date, reason: string): Promise<void> {
    await this.prisma.authRememberMe.updateMany({
      where: { chainId, endedAt: null },
      data: { endedAt, endReason: reason },
    });
  }

  async endActiveForPersonnel(personnelId: string, endedAt: Date, reason: string): Promise<void> {
    await this.prisma.authRememberMe.updateMany({
      where: { personnelId, endedAt: null },
      data: { endedAt, endReason: reason },
    });
  }

  async rotate(currentId: string, next: NewRememberMe, endedAt: Date): Promise<'rotated' | 'lost-race'> {
    // 已在调用方事务里时并入该事务；否则自开一个事务。
    const inTransaction = <T>(body: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> =>
      this.root ? this.root.$transaction(body) : body(this.prisma);
    try {
      await inTransaction(async (tx) => {
        const locked = await tx.$queryRaw<Array<{ ended_at: Date | null }>>`
          SELECT ended_at FROM auth_remember_me WHERE id = ${currentId} FOR UPDATE
        `;
        if (locked.length === 0 || locked[0]?.ended_at != null) throw new LostRace();
        await tx.authRememberMe.update({
          where: { id: currentId },
          data: { endedAt, endReason: 'rotated' },
        });
        await tx.authRememberMe.create({
          data: {
            id: next.id,
            personnelId: next.personnelId,
            chainId: next.chainId,
            secretHash: next.secretHash,
            absoluteEndsAt: next.absoluteEndsAt,
            predecessorId: next.predecessorId,
            createdAt: next.createdAt,
          },
        });
      });
      return 'rotated';
    } catch (error) {
      if (isLostRace(error)) return 'lost-race';
      throw error;
    }
  }
}

/** 管理动作的工作单元（#119）。每次 run 开一个交互式事务，事务内各存储与留痕共用同一事务客户端。 */
class PrismaUnitOfWork implements UnitOfWork {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly factory: AuditTrailFactory,
  ) {}

  run<T>(work: (tx: TxScope) => Promise<T | Rejected<T>>): Promise<T> {
    return runAuditedTransaction<TxScope, T>(
      (body) => this.prisma.$transaction((client) => body(this.scope(client))),
      (tx) => tx.client,
      this.factory,
      (tx) => work(tx),
    );
  }

  private scope(client: Prisma.TransactionClient): TxScope {
    return {
      client,
      store: new PrismaIdentityStore(client, 'transaction'),
      directory: new PrismaLoginDirectory(client),
      sessions: new PrismaSessionStore(client),
      remember: new PrismaRememberMeStore(client, null),
      audit: this.factory.forClient(client),
      auditReader: new PrismaAuditTrailReader(client as unknown as AuditTrailReadClient),
    };
  }
}

/** 启动参数之外的可覆写项。只给测试用。 */
export interface ApplicationOverrides {
  /** 接缝①：覆写留痕工厂，例如「业务写完后抛错」。 */
  auditTrailFactory?: AuditTrailFactory;
  /** 接缝③：承办中事项计数。默认恒为 0（#124）。 */
  openItemsCounter?: OpenItemsCounter;
  /** 口令历史比对深度（ADR 0015，#132）。默认 5；测试可传 2。 */
  passwordHistoryDepth?: number;
}

class DisconnectPrisma implements OnModuleDestroy {
  constructor(private readonly prisma: PrismaClient) {}

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

@Module({})
class PersistenceModule {
  static register(
    databaseUrl: string,
    clock: Clock,
    sessionCapacity: number,
    overrides: ApplicationOverrides,
  ): DynamicModule {
    const prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: databaseUrl }),
    });
    const auditTrailFactory = overrides.auditTrailFactory ?? prismaAuditTrailFactory;
    return {
      module: PersistenceModule,
      global: true,
      providers: [
        { provide: CLOCK, useValue: clock },
        { provide: SESSION_CAPACITY, useValue: sessionCapacity },
        { provide: PRISMA, useValue: prisma },
        { provide: IDENTITY_STORE, useValue: new PrismaIdentityStore(prisma) },
        { provide: AUDIT_TRAIL_FACTORY, useValue: auditTrailFactory },
        { provide: AUDIT_TRAIL_PORT, useValue: auditTrailFactory.forClient(prisma) },
        { provide: LOGIN_DIRECTORY, useValue: new PrismaLoginDirectory(prisma) },
        { provide: SESSION_STORE, useValue: new PrismaSessionStore(prisma) },
        { provide: REMEMBER_ME_STORE, useValue: new PrismaRememberMeStore(prisma, prisma) },
        { provide: UNIT_OF_WORK, useValue: new PrismaUnitOfWork(prisma, auditTrailFactory) },
        { provide: OPEN_ITEMS_COUNTER, useValue: overrides.openItemsCounter ?? NO_OPEN_ITEMS },
        { provide: PASSWORD_HISTORY_DEPTH_TOKEN, useValue: overrides.passwordHistoryDepth ?? PASSWORD_HISTORY_DEPTH },
        {
          provide: DisconnectPrisma,
          useFactory: (client: PrismaClient) => new DisconnectPrisma(client),
          inject: [PRISMA],
        },
      ],
      exports: [
        IDENTITY_STORE,
        AUDIT_TRAIL_FACTORY,
        AUDIT_TRAIL_PORT,
        UNIT_OF_WORK,
        OPEN_ITEMS_COUNTER,
        PASSWORD_HISTORY_DEPTH_TOKEN,
        LOGIN_DIRECTORY,
        SESSION_STORE,
        REMEMBER_ME_STORE,
        CLOCK,
        SESSION_CAPACITY,
      ],
    };
  }
}

@Module({})
class BootModule {
  static register(
    databaseUrl: string,
    clock: Clock,
    sessionCapacity: number,
    overrides: ApplicationOverrides,
  ): DynamicModule {
    return {
      module: BootModule,
      imports: [PersistenceModule.register(databaseUrl, clock, sessionCapacity, overrides), AppModule],
    };
  }
}

export async function createApplication(
  databaseUrl: string,
  clock: Clock = { now: () => new Date() },
  sessionCapacity: number = DEFAULT_SESSION_CAPACITY,
  overrides: ApplicationOverrides = {},
): Promise<INestApplication> {
  const app = await NestFactory.create(
    BootModule.register(databaseUrl, clock, sessionCapacity, overrides),
    { logger: false },
  );
  const withCsrf = app as INestApplication & { enableCsrfProtection?: () => void };
  if (typeof withCsrf.enableCsrfProtection !== 'function') {
    throw new Error('当前 NestJS 没有 enableCsrfProtection');
  }
  withCsrf.enableCsrfProtection();
  return app;
}

/** 生产引导命令（#131）用的装配：一个 Prisma 根客户端、身份存储和留痕工厂。没有 HTTP 入口。 */
export interface BootstrapRunner {
  /** 按定版 argon2id 参数散列初始口令（在事务之外计算）。 */
  hashPassword(plain: string): Promise<string>;
  run(request: BootstrapRequest, hooks?: BootstrapHooks): Promise<BootstrapOutcome>;
  close(): Promise<void>;
}

export function openBootstrapRunner(
  databaseUrl: string,
  overrides: ApplicationOverrides = {},
): BootstrapRunner {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
  const store = new PrismaIdentityStore(prisma);
  const service = new BootstrapService(store, overrides.auditTrailFactory ?? prismaAuditTrailFactory);
  const credentials = new CredentialService(store);
  return {
    hashPassword: (plain) => credentials.hashPassword(plain),
    run: (request, hooks) => service.run(request, hooks),
    close: () => prisma.$disconnect(),
  };
}
