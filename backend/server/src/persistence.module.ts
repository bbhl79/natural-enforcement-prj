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
import { SESSION_STORE, type NewSession, type SessionRow, type SessionStore } from './session-store.ts';

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
}

class DisconnectPrisma implements OnModuleDestroy {
  constructor(private readonly prisma: PrismaClient) {}

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

@Module({})
class PersistenceModule {
  static register(databaseUrl: string, clock: Clock): DynamicModule {
    const prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: databaseUrl }),
    });
    return {
      module: PersistenceModule,
      global: true,
      providers: [
        { provide: CLOCK, useValue: clock },
        { provide: PRISMA, useValue: prisma },
        { provide: IDENTITY_STORE, useValue: new PrismaIdentityStore(prisma) },
        { provide: AUDIT_TRAIL_PORT, useValue: new PrismaAuditTrail(prisma as unknown as AuditTrailCreateClient) },
        { provide: LOGIN_DIRECTORY, useValue: new PrismaLoginDirectory(prisma) },
        { provide: SESSION_STORE, useValue: new PrismaSessionStore(prisma) },
        {
          provide: DisconnectPrisma,
          useFactory: (client: PrismaClient) => new DisconnectPrisma(client),
          inject: [PRISMA],
        },
      ],
      exports: [IDENTITY_STORE, AUDIT_TRAIL_PORT, LOGIN_DIRECTORY, SESSION_STORE, CLOCK],
    };
  }
}

@Module({})
class BootModule {
  static register(databaseUrl: string, clock: Clock): DynamicModule {
    return {
      module: BootModule,
      imports: [PersistenceModule.register(databaseUrl, clock), AppModule],
    };
  }
}

export async function createApplication(
  databaseUrl: string,
  clock: Clock = { now: () => new Date() },
): Promise<INestApplication> {
  const app = await NestFactory.create(BootModule.register(databaseUrl, clock), { logger: false });
  const withCsrf = app as INestApplication & { enableCsrfProtection?: () => void };
  if (typeof withCsrf.enableCsrfProtection !== 'function') {
    throw new Error('当前 NestJS 没有 enableCsrfProtection');
  }
  withCsrf.enableCsrfProtection();
  return app;
}
