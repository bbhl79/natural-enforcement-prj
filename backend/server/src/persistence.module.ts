// 启动包装配（ADR 0004 / ADR 0012）。
// 本文件是启动包里唯一直接引用身份数据库适配器的文件。
// 它也装配留痕适配器。根类型检查排除本文件：生成客户端只在容器里存在。
import 'reflect-metadata';

import { Module, type DynamicModule, type OnModuleDestroy } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaAuditTrail, type AuditTrailCreateClient } from '../../../packages/audit/src/prisma-audit-trail.ts';
import { AUDIT_TRAIL_PORT } from '@natural-enforcement/audit';
import { IDENTITY_STORE } from '@natural-enforcement/identity';
import { PrismaIdentityStore } from '../../identity/src/persistence/prisma-identity-store.ts';
import { PrismaClient } from '../../prisma/generated/prisma/client.ts';

import { AppModule } from './app.module.ts';
import { CLOCK, type Clock } from './clock.ts';
import {
  LOGIN_DIRECTORY,
  type FailureSnapshot,
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

const PRISMA = Symbol('PRISMA');

function byCodePoint(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

class PrismaLoginDirectory implements LoginDirectory {
  constructor(private readonly prisma: PrismaClient) {}

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
  constructor(private readonly prisma: PrismaClient) {}

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
  constructor(private readonly prisma: PrismaClient) {}

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
    try {
      await this.prisma.$transaction(async (tx) => {
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

class DisconnectPrisma implements OnModuleDestroy {
  constructor(private readonly prisma: PrismaClient) {}

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

@Module({})
class PersistenceModule {
  static register(databaseUrl: string, clock: Clock, sessionCapacity: number): DynamicModule {
    const prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: databaseUrl }),
    });
    return {
      module: PersistenceModule,
      global: true,
      providers: [
        { provide: CLOCK, useValue: clock },
        { provide: SESSION_CAPACITY, useValue: sessionCapacity },
        { provide: PRISMA, useValue: prisma },
        { provide: IDENTITY_STORE, useValue: new PrismaIdentityStore(prisma) },
        { provide: AUDIT_TRAIL_PORT, useValue: new PrismaAuditTrail(prisma as unknown as AuditTrailCreateClient) },
        { provide: LOGIN_DIRECTORY, useValue: new PrismaLoginDirectory(prisma) },
        { provide: SESSION_STORE, useValue: new PrismaSessionStore(prisma) },
        { provide: REMEMBER_ME_STORE, useValue: new PrismaRememberMeStore(prisma) },
        {
          provide: DisconnectPrisma,
          useFactory: (client: PrismaClient) => new DisconnectPrisma(client),
          inject: [PRISMA],
        },
      ],
      exports: [
        IDENTITY_STORE,
        AUDIT_TRAIL_PORT,
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
  static register(databaseUrl: string, clock: Clock, sessionCapacity: number): DynamicModule {
    return {
      module: BootModule,
      imports: [PersistenceModule.register(databaseUrl, clock, sessionCapacity), AppModule],
    };
  }
}

export async function createApplication(
  databaseUrl: string,
  clock: Clock = { now: () => new Date() },
  sessionCapacity: number = DEFAULT_SESSION_CAPACITY,
): Promise<INestApplication> {
  const app = await NestFactory.create(BootModule.register(databaseUrl, clock, sessionCapacity), { logger: false });
  const withCsrf = app as INestApplication & { enableCsrfProtection?: () => void };
  if (typeof withCsrf.enableCsrfProtection !== 'function') {
    throw new Error('当前 NestJS 没有 enableCsrfProtection');
  }
  withCsrf.enableCsrfProtection();
  return app;
}
