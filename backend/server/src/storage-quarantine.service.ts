// 涉密误传标记与 quarantined 隔离（#224）。
// 有权限角色一期＝目标对象所属根机构系统管理员（与停用机构重派同类收窄；扩角色另报）。
// 标记后业务读／下载／预览拒绝；原 WORM 对象仍保留；无 DeleteObject／物理删除。

import { Inject, Injectable } from '@nestjs/common';

import { rejected } from '@natural-enforcement/audit';
import { CLUE_STORE, type ClueStore } from '@natural-enforcement/case';
import {
  AccessControlService,
  IDENTITY_STORE,
  isAccessDenied,
  type ActorRef,
  type IdentityStore,
} from '@natural-enforcement/identity';
import { STORAGE_PORT, type FileVersionRef, type StoragePort } from '@natural-enforcement/storage';

import { CLOCK, type Clock } from './clock.ts';
import { LOGIN_DIRECTORY, type LoginDirectory } from './login-directory.ts';
import { UNIT_OF_WORK, type UnitOfWork } from './unit-of-work.ts';

const QUARANTINE_OPCODE = 'storage.quarantine.mark';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function newUlid(): string {
  let time = BigInt(Date.now());
  let id = '';
  for (let i = 0; i < 10; i += 1) {
    id = CROCKFORD[Number(time % 32n)] + id;
    time /= 32n;
  }
  for (const byte of crypto.getRandomValues(new Uint8Array(16))) id += CROCKFORD[byte % 32];
  return id;
}

/** 隔离对象错误：业务读路径映射为 403 object-quarantined。 */
export class QuarantinedObjectError extends Error {
  readonly ref: FileVersionRef;
  constructor(ref: FileVersionRef) {
    super(`storage object quarantined: ${ref.fileKey}@${ref.versionId}`);
    this.name = 'QuarantinedObjectError';
    this.ref = ref;
  }
}

export type QuarantineMarkOutcome =
  | {
      readonly status: 200;
      readonly body: {
        readonly result: 'quarantined';
        readonly materialId: string;
        readonly fileKey: string;
        readonly versionId: string;
        readonly quarantinedAt: string;
      };
    }
  | { readonly status: 400; readonly body: { readonly result: 'non-compliant'; readonly reason: 'missing-summary' } }
  | { readonly status: 403; readonly body: { readonly reason: string } }
  | { readonly status: 404; readonly body: { readonly result: 'not-found' } }
  | {
      readonly status: 409;
      readonly body: { readonly result: 'invalid-state'; readonly reason: 'already-quarantined' };
    };

export type MaterialContentOutcome =
  | { readonly status: 200; readonly body: Uint8Array; readonly contentType: string; readonly fileName: string }
  | { readonly status: 403; readonly body: { readonly reason: string } }
  | { readonly status: 404; readonly body: { readonly result: 'not-found' } };

@Injectable()
export class StorageQuarantineService {
  constructor(
    private readonly access: AccessControlService,
    @Inject(LOGIN_DIRECTORY) private readonly directory: LoginDirectory,
    @Inject(IDENTITY_STORE) private readonly identity: IdentityStore,
    @Inject(CLUE_STORE) private readonly clues: ClueStore,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** 标记涉密误传：对象标 quarantined＋不可篡改留痕。 */
  async markMaterial(
    actor: ActorRef,
    materialId: string,
    summaryRaw: string,
  ): Promise<QuarantineMarkOutcome> {
    const target = await this.clues.findMaterialQuarantineTarget(materialId);
    if (!target) return { status: 404, body: { result: 'not-found' } };

    const account = await this.directory.findById(actor.personnelId);
    const actorOrgId = account?.orgUnitId ?? '';
    const actorCode = account?.code ?? null;

    try {
      await this.access.authorize(actor, QUARANTINE_OPCODE, target.enteredOrgId, {
        resourceType: 'storage-object',
        resourceId: `${target.fileKey}@${target.versionId}`,
      });
    } catch (error) {
      if (!isAccessDenied(error)) throw error;
      return { status: 403, body: { reason: error.reason } };
    }

    // 一期收窄：只允许目标对象所属根机构的系统管理员（#224 口径锁；要扩角色另报）。
    // pathToRoot 自根向叶，首元即根机构；部门系统管理员即使同树亦不放行。
    const objectRootId = (await this.identity.findOrgUnitPathToRoot(target.enteredOrgId))[0] ?? '';
    if (objectRootId === '' || actorOrgId !== objectRootId) {
      await this.deny(actor, actorCode, actorOrgId, target, 'scope-denied');
      return { status: 403, body: { reason: 'scope-denied' } };
    }

    const summary = summaryRaw.trim();
    if (summary === '') {
      return this.reject(actor, actorCode, actorOrgId, target, {
        status: 400,
        result: 'non-compliant',
        reason: 'missing-summary',
      });
    }

    const quarantinedAt = this.clock.now();
    return this.uow.run(async (tx) => {
      const written = await tx.clues.insertObjectQuarantine({
        id: newUlid(),
        fileKey: target.fileKey,
        versionId: target.versionId,
        materialId: target.materialId,
        clueId: target.clueId,
        summary,
        discoveredBy: actor.personnelId,
        discoveredAt: quarantinedAt,
      });
      if (written === 'already-quarantined') {
        return rejected<QuarantineMarkOutcome>(
          { status: 409, body: { result: 'invalid-state', reason: 'already-quarantined' } },
          {
            action: 'storage.quarantined',
            outcome: 'failed',
            reason: 'already-quarantined',
            ...this.parties(actor, actorCode, actorOrgId, target),
          },
        );
      }
      await tx.audit.append({
        action: 'storage.quarantined',
        ...this.parties(actor, actorCode, actorOrgId, target),
        detail: JSON.stringify({
          materialId: target.materialId,
          fileKey: target.fileKey,
          versionId: target.versionId,
          clueId: target.clueId,
          summary,
          discoveredBy: actor.personnelId,
          discoveredAt: quarantinedAt.toISOString(),
        }),
      });
      return {
        status: 200,
        body: {
          result: 'quarantined' as const,
          materialId: target.materialId,
          fileKey: target.fileKey,
          versionId: target.versionId,
          quarantinedAt: quarantinedAt.toISOString(),
        },
      };
    });
  }

  /** 业务读材料内容：已隔离则 403 object-quarantined；桶内对象仍在。 */
  async readMaterialContent(actor: ActorRef, materialId: string): Promise<MaterialContentOutcome> {
    const target = await this.clues.findMaterialQuarantineTarget(materialId);
    if (!target) return { status: 404, body: { result: 'not-found' } };
    try {
      await this.access.authorize(actor, 'clue.read', target.enteredOrgId, {
        resourceType: 'storage-object',
        resourceId: `${target.fileKey}@${target.versionId}`,
      });
    } catch (error) {
      if (!isAccessDenied(error)) throw error;
      return { status: 403, body: { reason: error.reason } };
    }
    if (await this.clues.isObjectQuarantined(target.fileKey, target.versionId)) {
      return { status: 403, body: { reason: 'object-quarantined' } };
    }
    const content = await this.storage.readVersion({
      fileKey: target.fileKey,
      versionId: target.versionId,
    });
    // contentType 不在隔离目标里；再查一次材料行代价大，读路径只保证拒隔离。
    // 用 octet-stream；文件名取自目标。
    return {
      status: 200,
      body: content,
      contentType: 'application/octet-stream',
      fileName: target.fileName,
    };
  }

  /** 供核查产物等读路径：已隔离抛 QuarantinedObjectError。 */
  async assertReadable(ref: FileVersionRef): Promise<void> {
    if (await this.clues.isObjectQuarantined(ref.fileKey, ref.versionId)) {
      throw new QuarantinedObjectError(ref);
    }
  }

  private parties(
    actor: ActorRef,
    actorCode: string | null,
    actorOrgId: string,
    target: { readonly clueId: string; readonly fileKey: string; readonly versionId: string },
  ) {
    return {
      actorId: actor.personnelId,
      actorCode,
      subjectPersonnelId: null as string | null,
      subjectCode: null as string | null,
      orgUnitId: actorOrgId || null,
      sourceIp: null as string | null,
      opcode: QUARANTINE_OPCODE,
      resourceType: 'storage-object',
      resourceId: `${target.fileKey}@${target.versionId}`,
    };
  }

  private async deny(
    actor: ActorRef,
    actorCode: string | null,
    actorOrgId: string,
    target: { readonly clueId: string; readonly fileKey: string; readonly versionId: string; readonly enteredOrgId: string },
    reason: 'scope-denied' | 'permission-denied',
  ): Promise<void> {
    await this.uow.run(async (tx) => {
      await tx.audit.append({
        action: 'authz.denied',
        outcome: 'failed',
        reason,
        actorId: actor.personnelId,
        actorCode,
        subjectPersonnelId: null,
        subjectCode: null,
        orgUnitId: actorOrgId || null,
        sourceIp: null,
        opcode: QUARANTINE_OPCODE,
        resourceType: 'storage-object',
        resourceId: `${target.fileKey}@${target.versionId}`,
        previousValue: null,
        targetOrgUnitId: target.enteredOrgId,
        targetOrgUnitBasis: 'object',
      });
    });
  }

  private async reject(
    actor: ActorRef,
    actorCode: string | null,
    actorOrgId: string,
    target: { readonly clueId: string; readonly fileKey: string; readonly versionId: string },
    outcome: { status: 400; result: 'non-compliant'; reason: 'missing-summary' },
  ): Promise<QuarantineMarkOutcome> {
    const body = { result: outcome.result, reason: outcome.reason } as const;
    await this.uow.run(async () =>
      rejected<QuarantineMarkOutcome>(
        { status: outcome.status, body },
        {
          action: 'storage.quarantined',
          outcome: 'failed',
          reason: outcome.reason,
          ...this.parties(actor, actorCode, actorOrgId, target),
        },
      ),
    );
    return { status: outcome.status, body };
  }
}
