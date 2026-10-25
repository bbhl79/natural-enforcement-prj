// 移送与停用机构池重新指定（#216；规格 D 节、GLOSSARY）。
//
// 移送（自然资源部门以外的机关）：池所属机构内勤在待分派池、承办机构内勤在
// 已派机构／已派承办人发起；对所有违法类型开放，不区分管辖、涉刑、党纪政务三类。
// 移送机关、文书编号、原因必填；发函日期默认北京当日、允许补录；附件选填 0..n。
// 先完整校验表单与全部附件的真实内容（任一不通过即 4xx、存储零写入），再逐件写存储，
// 最后在一个事务里写终态、处置行与成功留痕。登记后进 transferred_out 终态，退出比对与 OpenItems。
//
// 停用机构池重新指定：系统管理员把已停用机构待分派池里未派出的线索（待分派池、
// 待分派决定、不派）重新指定给未停用机构；理由必填，写指定事实（kind='pool-reassign'），
// 不构成指定管辖、不加锁。目标机构已停用、池机构未停用或线索已派出即 409。
//
// 报请指定管辖期间下级不能移送：存在未关闭的报请（status='pending'）即 409
// designation-pending（#215 落地后与其共用同一判定）。

import { Inject, Injectable } from '@nestjs/common';

import {
  rejected,
  type AuditAppend,
  type AuditParties,
  type AuthzDeniedEntry,
  type ClueDispositionRecordedFailedReason,
  type CluePoolReassignedFailedReason,
} from '@natural-enforcement/audit';
import {
  CLUE_STORE,
  POOL_REASSIGN_FROM_STATUSES,
  TRANSFER_FROM_STATUSES,
  assessTransfer,
  beijingDateOf,
  validateAttachmentSet,
  contentDigest,
  type ClueMaterialRow,
  type ClueStore,
} from '@natural-enforcement/case';
import {
  AccessControlService,
  IDENTITY_STORE,
  isAccessDenied,
  newUlid,
  type ActorRef,
  type DenyReason,
  type IdentityStore,
} from '@natural-enforcement/identity';
import { STORAGE_PORT, type StoragePort } from '@natural-enforcement/storage';

import { CLOCK, type Clock } from './clock.ts';
import { LOGIN_DIRECTORY, type LoginDirectory } from './login-directory.ts';
import { UNIT_OF_WORK, type UnitOfWork } from './unit-of-work.ts';

const DISPOSITION_OPCODE = 'clue.disposition.record';
const POOL_REASSIGN_OPCODE = 'clue.pool.reassign';

/** 一件上传的移送附件（控制器已把内容读进内存）。 */
export interface TransferUploadedFile {
  readonly fileName: string;
  readonly contentType: string;
  readonly byteSize: number;
  readonly content: Uint8Array;
}

/** 移送登记请求。 */
export interface ClueTransferRequest {
  readonly transferOrg: string;
  readonly documentNo: string;
  /** 发函日期补录值（空串＝缺省北京当日）。 */
  readonly letterDate: string;
  readonly reason: string;
  readonly attachments: readonly TransferUploadedFile[];
  readonly expectedStatus: string;
}

/** 移送登记结果。 */
export type ClueTransferOutcome =
  | {
      readonly status: 200;
      readonly body: {
        readonly result: 'transferred-out';
        readonly clueId: string;
        readonly code: string;
        readonly status: 'transferred_out';
        readonly letterDate: string;
      };
    }
  | { readonly status: 400; readonly body: { readonly result: 'non-compliant'; readonly rules: readonly string[] } }
  | { readonly status: 403; readonly body: { readonly reason: DenyReason } }
  | { readonly status: 404; readonly body: { readonly result: 'not-found' } }
  | {
      readonly status: 409;
      readonly body: { readonly result: 'invalid-state' | 'concurrent-change'; readonly reason: string };
    };

/** 池重新指定请求。 */
export interface CluePoolReassignRequest {
  readonly orgUnitId: string;
  readonly reason: string;
  readonly expectedStatus: string;
}

/** 池重新指定结果。 */
export type CluePoolReassignOutcome =
  | {
      readonly status: 200;
      readonly body: {
        readonly result: 'pool-reassigned';
        readonly clueId: string;
        readonly code: string;
        readonly status: string;
        readonly orgUnitId: string;
      };
    }
  | { readonly status: 400; readonly body: { readonly result: 'non-compliant'; readonly rules: readonly string[] } }
  | { readonly status: 403; readonly body: { readonly reason: DenyReason } }
  | { readonly status: 404; readonly body: { readonly result: 'not-found' } }
  | {
      readonly status: 409;
      readonly body: { readonly result: 'invalid-state' | 'concurrent-change'; readonly reason: string };
    };

/** 停用机构待分派池线索（管理端清单行）。 */
export interface PoolClueItem {
  readonly clueId: string;
  readonly code: string;
  readonly status: string;
  readonly domain: string;
  readonly registeredAt: string;
}

/** 池线索清单结果。 */
export type PoolClueListOutcome =
  | { readonly status: 200; readonly body: { readonly result: 'pool-clues'; readonly orgUnitId: string; readonly clues: readonly PoolClueItem[] } }
  | { readonly status: 403; readonly body: { readonly reason: DenyReason } }
  | { readonly status: 404; readonly body: { readonly result: 'not-found' } }
  | { readonly status: 409; readonly body: { readonly result: 'invalid-state'; readonly reason: string } };

interface Rejection {
  readonly status: 400 | 409;
  readonly result: 'non-compliant' | 'invalid-state' | 'concurrent-change';
  readonly rules: readonly string[];
  readonly reason: string;
}

@Injectable()
export class ClueDispositionService {
  constructor(
    @Inject(LOGIN_DIRECTORY) private readonly directory: LoginDirectory,
    @Inject(CLUE_STORE) private readonly clues: ClueStore,
    @Inject(IDENTITY_STORE) private readonly identity: IdentityStore,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly access: AccessControlService,
  ) {}

  /** 移送登记（自然资源部门以外的机关；登记后进 transferred_out 终态）。 */
  async recordTransfer(actor: ActorRef, clueId: string, input: ClueTransferRequest): Promise<ClueTransferOutcome> {
    const context = await this.clues.readTransferContext(clueId);
    if (!context) return { status: 404, body: { result: 'not-found' } };
    const account = await this.directory.findById(actor.personnelId);
    const actorOrgId = account?.orgUnitId ?? '';
    const actorCode = account?.code ?? null;
    // 对象级机构：待分派池取登记机构（池所属机构），已派机构／已派承办人取承办机构。
    const targetOrgId = context.assignmentOrgId ?? context.enteredOrgId;

    // 授权第一层：操作码（拒绝时 authorize 自己写 authz.denied 留痕）。
    try {
      await this.access.authorize(actor, DISPOSITION_OPCODE, targetOrgId, {
        resourceType: 'clue',
        resourceId: clueId,
      });
    } catch (error) {
      if (!isAccessDenied(error)) throw error;
      return { status: 403, body: { reason: error.reason } };
    }
    // 授权第二层：对象级（池所属机构内勤／承办机构内勤；经办不能移送）。
    if ((account?.roles ?? []).includes('内勤') !== true || actorOrgId !== targetOrgId) {
      await this.deny(actor, actorCode, actorOrgId, DISPOSITION_OPCODE, clueId, targetOrgId);
      return { status: 403, body: { reason: 'permission-denied' } };
    }

    // 纯校验：必填与发函日期（缺省北京当日）。任一不通过即 400，存储零写入。
    const assessed = assessTransfer({
      transferOrg: input.transferOrg,
      documentNo: input.documentNo,
      reason: input.reason,
      letterDateRaw: input.letterDate,
      today: beijingDateOf(this.clock.now()),
    });
    if (!assessed.ok) {
      return this.rejectTransfer(actor, actorCode, targetOrgId, clueId, {
        status: 400,
        result: 'non-compliant',
        rules: [assessed.rule],
        reason: assessed.rule,
      });
    }
    // 附件校验：件数、合计字节与逐件真实内容。任一不通过即 400，存储零写入。
    const attachments = input.attachments.map((file) => ({
      fileName: file.fileName,
      byteSize: file.byteSize,
      content: file.content,
    }));
    const attachmentCheck = validateAttachmentSet(attachments);
    if (!attachmentCheck.ok) {
      return this.rejectTransfer(actor, actorCode, targetOrgId, clueId, {
        status: 400,
        result: 'non-compliant',
        rules: [attachmentCheck.rule],
        reason: 'invalid-attachment',
      });
    }
    // 报请期间的锁：存在未关闭的指定管辖报请，下级不能移送。
    // 判定与 #215 的指定锁同源：同一条报请行、同一 status='pending' 口径。
    if ((await this.clues.readPendingDesignationRequest(clueId)) !== null) {
      return this.rejectTransfer(actor, actorCode, targetOrgId, clueId, {
        status: 409,
        result: 'invalid-state',
        rules: [],
        reason: 'designation-pending',
      });
    }
    const guard = this.stateGuard(context.status, input.expectedStatus, [...TRANSFER_FROM_STATUSES]);
    if (guard) {
      return this.rejectTransfer(actor, actorCode, targetOrgId, clueId, guard);
    }

    // 校验已全过，逐件写存储（fileKey 与登记同一口径）。
    const materials: ClueMaterialRow[] = [];
    let index = 0;
    for (const file of input.attachments) {
      index += 1;
      const fileKey = `clue/${clueId}/transfer/${index}-${sanitizeFileName(file.fileName)}`;
      const ref = await this.storage.putVersion(fileKey, file.content);
      materials.push({
        id: newUlid(),
        kind: 'attachment',
        fileKey: ref.fileKey,
        versionId: ref.versionId,
        fileName: file.fileName,
        contentType: file.contentType,
        byteSize: file.byteSize,
        digest: contentDigest(file.content),
      });
    }

    // 终态、处置行与成功留痕同成同败；并发冲突回滚后另起事务写失败留痕。
    const now = this.clock.now();
    return this.uow.run(async (tx) => {
      const applied = await tx.clues.recordTransfer({
        clueId,
        expectedStatus: input.expectedStatus,
        dispositionId: newUlid(),
        transferredOrg: input.transferOrg.trim(),
        documentNo: input.documentNo.trim(),
        letterDate: assessed.letterDate,
        reason: input.reason.trim(),
        recordedBy: actor.personnelId,
        recordedAt: now,
        materials,
      });
      if (!applied) {
        return rejected<ClueTransferOutcome>(
          { status: 409, body: { result: 'concurrent-change', reason: 'concurrent-change' } },
          this.transferEntry(this.parties(actor, actorCode, targetOrgId, clueId, DISPOSITION_OPCODE), {
            outcome: 'failed',
            reason: 'concurrent-change',
          }),
        );
      }
      await tx.audit.append(
        this.transferEntry(this.parties(actor, actorCode, targetOrgId, clueId, DISPOSITION_OPCODE), {
          detail: JSON.stringify({
            code: context.code,
            disposition: 'transfer',
            transferredOrg: input.transferOrg.trim(),
            documentNo: input.documentNo.trim(),
            letterDate: assessed.letterDate,
          }),
        }),
      );
      return {
        status: 200,
        body: {
          result: 'transferred-out' as const,
          clueId,
          code: context.code,
          status: 'transferred_out' as const,
          letterDate: assessed.letterDate,
        },
      };
    });
  }

  /** 停用机构待分派池线索清单（管理端；只授系统管理，池机构须已停用）。 */
  async listPoolClues(actor: ActorRef, orgUnitId: string): Promise<PoolClueListOutcome> {
    const org = await this.identity.findOrgUnitById(orgUnitId);
    if (!org) return { status: 404, body: { result: 'not-found' } };
    const account = await this.directory.findById(actor.personnelId);
    const actorOrgId = account?.orgUnitId ?? '';
    // 授权：操作码只授系统管理（拒绝时 authorize 自己写 authz.denied 留痕）。
    try {
      await this.access.authorize(actor, POOL_REASSIGN_OPCODE, orgUnitId, {
        resourceType: 'org-unit',
        resourceId: orgUnitId,
      });
    } catch (error) {
      if (!isAccessDenied(error)) throw error;
      return { status: 403, body: { reason: error.reason } };
    }
    // 对象级：只接已停用机构的待分派池。
    if (org.deactivatedAt === null) {
      const outcome: PoolClueListOutcome = {
        status: 409,
        body: { result: 'invalid-state', reason: 'org-unit-not-deactivated' },
      };
      await this.uow.run(async () =>
        rejected<PoolClueListOutcome>(outcome, {
          action: 'clue.pool-reassigned',
          outcome: 'failed',
          reason: 'org-unit-not-deactivated',
          ...this.parties(actor, account?.code ?? null, actorOrgId, orgUnitId, POOL_REASSIGN_OPCODE),
        }),
      );
      return outcome;
    }
    const rows = await this.clues.listPoolClues(orgUnitId);
    return {
      status: 200,
      body: {
        result: 'pool-clues' as const,
        orgUnitId,
        clues: rows.map((row) => ({
          clueId: row.clueId,
          code: row.code,
          status: row.status,
          domain: row.domain,
          registeredAt: row.registeredAt.toISOString(),
        })),
      },
    };
  }

  /** 停用机构池重新指定（只授系统管理；不构成指定管辖、不加锁）。 */
  async reassignPool(
    actor: ActorRef,
    clueId: string,
    input: CluePoolReassignRequest,
  ): Promise<CluePoolReassignOutcome> {
    const context = await this.clues.readTransferContext(clueId);
    if (!context) return { status: 404, body: { result: 'not-found' } };
    const account = await this.directory.findById(actor.personnelId);
    const actorOrgId = account?.orgUnitId ?? '';
    const actorCode = account?.code ?? null;
    const orgUnitId = input.orgUnitId.trim();
    if (orgUnitId === '') {
      return this.rejectPool(actor, actorCode, actorOrgId, clueId, {
        status: 400,
        result: 'non-compliant',
        rules: ['org-unit-required'],
        reason: 'org-unit-required',
      });
    }
    const target = await this.identity.findOrgUnitById(orgUnitId);
    if (!target) return { status: 404, body: { result: 'not-found' } };

    // 授权第一层：操作码（clue.pool.reassign 只授系统管理；拒绝时写 authz.denied）。
    try {
      await this.access.authorize(actor, POOL_REASSIGN_OPCODE, orgUnitId, {
        resourceType: 'clue',
        resourceId: clueId,
      });
    } catch (error) {
      if (!isAccessDenied(error)) throw error;
      return { status: 403, body: { reason: error.reason } };
    }
    // P4 权限：只允许能覆盖目标根机构的系统管理员（根机构／超管）。
    // 目标机构的根机构必须在操作者的数据范围内，部门管理员不能跨根机构重指定。
    if (actorOrgId !== '') {
      const targetRootId = (await this.identity.findOrgUnitPathToRoot(orgUnitId)).at(-1) ?? '';
      if (targetRootId !== '') {
        const rootPath = await this.identity.findOrgUnitPathToRoot(targetRootId);
        rootPath.push(targetRootId);
        if (!rootPath.includes(actorOrgId)) {
          await this.denyPool(actor, actorCode, actorOrgId, clueId, 'scope-denied');
          return { status: 403, body: { reason: 'scope-denied' } };
        }
      }
    }
    // 理由必填。
    if (input.reason.trim() === '') {
      return this.rejectPool(actor, actorCode, actorOrgId, clueId, {
        status: 400,
        result: 'non-compliant',
        rules: ['missing-reassign-reason'],
        reason: 'missing-reassign-reason',
      });
    }
    // 目标须为未停用机构。
    if (target.deactivatedAt !== null) {
      return this.rejectPool(actor, actorCode, actorOrgId, clueId, {
        status: 409,
        result: 'invalid-state',
        rules: [],
        reason: 'org-unit-deactivated',
      });
    }
    // 对象级：只接已停用机构待分派池里未派出的线索。
    const poolOrg = await this.identity.findOrgUnitById(context.enteredOrgId);
    if (!poolOrg || poolOrg.deactivatedAt === null) {
      return this.rejectPool(actor, actorCode, actorOrgId, clueId, {
        status: 409,
        result: 'invalid-state',
        rules: [],
        reason: 'org-unit-not-deactivated',
      });
    }
    const guard = this.stateGuard(context.status, input.expectedStatus, [...POOL_REASSIGN_FROM_STATUSES]);
    if (guard) {
      return this.rejectPool(actor, actorCode, actorOrgId, clueId, guard);
    }

    // 归属变更与指定事实同成同败；并发冲突回滚后另起事务写失败留痕。
    return this.uow.run(async (tx) => {
      const applied = await tx.clues.reassignPool({
        clueId,
        expectedStatus: input.expectedStatus,
        assignmentId: newUlid(),
        orgUnitId,
        reason: input.reason.trim(),
        assignedBy: actor.personnelId,
        assignedByOrgId: actorOrgId,
        assignedAt: this.clock.now(),
      });
      if (!applied) {
        return rejected<CluePoolReassignOutcome>(
          { status: 409, body: { result: 'concurrent-change', reason: 'concurrent-change' } },
          {
            action: 'clue.pool-reassigned',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(actor, actorCode, actorOrgId, clueId, POOL_REASSIGN_OPCODE),
          },
        );
      }
      await tx.audit.append({
        action: 'clue.pool-reassigned',
        ...this.parties(actor, actorCode, actorOrgId, clueId, POOL_REASSIGN_OPCODE),
        detail: JSON.stringify({
          code: context.code,
          deactivatedOrgId: context.enteredOrgId,
          orgUnitId,
        }),
      });
      return {
        status: 200,
        body: {
          result: 'pool-reassigned' as const,
          clueId,
          code: context.code,
          status: context.status,
          orgUnitId,
        },
      };
    });
  }

  /**
   * 停用机构池线索批量重指定（#207 P4）：系统管理停用机构后，把该机构下的
   * in_pool／pending_decision／held 线索一并交系统管理根机构重新指定。
   * 返回重指定条数。仍在审批中或已派出的线索不受影响。
   */
  async reassignDeactivatedOrgPool(
    actor: ActorRef,
    deactivatedOrgId: string,
  ): Promise<number> {
    const rootOrgId = await this.identity.findRootOrgUnitId();
    if (!rootOrgId) return 0;
    const rows = await this.clues.listPoolClues(deactivatedOrgId);
    if (rows.length === 0) return 0;
    let reassigned = 0;
    for (const row of rows) {
      const outcome = await this.reassignPool(actor, row.clueId, {
        orgUnitId: rootOrgId,
        expectedStatus: row.status,
        reason: `机构 ${deactivatedOrgId} 已停用，池线索重新指定`,
      });
      if (outcome.status === 200) reassigned += 1;
    }
    return reassigned;
  }

  /** 状态守卫：expectedStatus 不符即并发冲突；状态不在允许集合即 invalid-state。 */
  private stateGuard(
    actual: string,
    expected: string,
    allowed: readonly string[],
  ): Rejection | null {
    if (actual !== expected) {
      return { status: 409, result: 'concurrent-change', rules: [], reason: 'concurrent-change' };
    }
    if (!allowed.includes(actual)) {
      return { status: 409, result: 'invalid-state', rules: [], reason: 'invalid-state' };
    }
    return null;
  }

  /** 对象级拒绝：403 并写 authz.denied 留痕（回滚后另起事务写，#119 口径）。 */
  private async deny(
    actor: ActorRef,
    actorCode: string | null,
    orgUnitId: string,
    opcode: string,
    clueId: string,
    targetOrgUnitId: string,
  ): Promise<void> {
    const denial: AuthzDeniedEntry = {
      action: 'authz.denied',
      outcome: 'failed',
      actorId: actor.personnelId,
      actorCode,
      subjectPersonnelId: null,
      subjectCode: null,
      orgUnitId,
      sourceIp: null,
      reason: 'permission-denied',
      opcode,
      resourceType: 'clue',
      resourceId: clueId,
      previousValue: null,
      targetOrgUnitId,
      targetOrgUnitBasis: 'object',
    };
    await this.uow.run(async () =>
      rejected<ClueTransferOutcome>({ status: 403, body: { reason: 'permission-denied' } }, denial),
    );
  }

  /** 池重新指定的对象级拒绝：403 并写 authz.denied 留痕（#207 P4）。 */
  private async denyPool(
    actor: ActorRef,
    actorCode: string | null,
    orgUnitId: string,
    clueId: string,
    reason: DenyReason,
  ): Promise<void> {
    const denial: AuthzDeniedEntry = {
      action: 'authz.denied',
      outcome: 'failed',
      actorId: actor.personnelId,
      actorCode,
      subjectPersonnelId: null,
      subjectCode: null,
      orgUnitId,
      sourceIp: null,
      reason,
      opcode: POOL_REASSIGN_OPCODE,
      resourceType: 'clue',
      resourceId: clueId,
      previousValue: null,
      targetOrgUnitId: orgUnitId,
      targetOrgUnitBasis: 'object',
    };
    await this.uow.run(async () =>
      rejected<CluePoolReassignOutcome>({ status: 403, body: { reason } }, denial),
    );
  }

  /** 移送拒绝类留痕：回滚后另起事务写入。 */
  private async rejectTransfer(
    actor: ActorRef,
    actorCode: string | null,
    orgUnitId: string,
    clueId: string,
    rejection: Rejection,
  ): Promise<ClueTransferOutcome> {
    const outcome: ClueTransferOutcome =
      rejection.status === 400
        ? { status: 400, body: { result: 'non-compliant', rules: rejection.rules } }
        : {
            status: 409,
            body: {
              result: rejection.result as 'invalid-state' | 'concurrent-change',
              reason: rejection.reason,
            },
          };
    await this.uow.run(async () =>
      rejected<ClueTransferOutcome>(
        outcome,
        this.transferEntry(this.parties(actor, actorCode, orgUnitId, clueId, DISPOSITION_OPCODE), {
          outcome: 'failed',
          reason: rejection.reason as ClueDispositionRecordedFailedReason,
        }),
      ),
    );
    return outcome;
  }

  /** 池重新指定拒绝类留痕：回滚后另起事务写入。 */
  private async rejectPool(
    actor: ActorRef,
    actorCode: string | null,
    orgUnitId: string,
    clueId: string,
    rejection: Rejection,
  ): Promise<CluePoolReassignOutcome> {
    const outcome: CluePoolReassignOutcome =
      rejection.status === 400
        ? { status: 400, body: { result: 'non-compliant', rules: rejection.rules } }
        : {
            status: 409,
            body: {
              result: rejection.result as 'invalid-state' | 'concurrent-change',
              reason: rejection.reason,
            },
          };
    await this.uow.run(async () =>
      rejected<CluePoolReassignOutcome>(outcome, {
        action: 'clue.pool-reassigned',
        outcome: 'failed',
        reason: rejection.reason as CluePoolReassignedFailedReason,
        ...this.parties(actor, actorCode, orgUnitId, clueId, POOL_REASSIGN_OPCODE),
      }),
    );
    return outcome;
  }

  /** 移送留痕行：动作词一个，成功带 detail、失败带原因。 */
  private transferEntry(
    parties: AuditParties,
    extra: {
      readonly outcome?: 'failed';
      readonly reason?: ClueDispositionRecordedFailedReason;
      readonly detail?: string;
    },
  ): AuditAppend {
    return extra.outcome === 'failed'
      ? {
          action: 'clue.disposition-recorded',
          outcome: 'failed',
          reason: extra.reason ?? 'invalid-state',
          ...parties,
        }
      : { action: 'clue.disposition-recorded', ...parties, detail: extra.detail ?? null };
  }

  /** 留痕的当事人列。 */
  private parties(
    actor: ActorRef,
    actorCode: string | null,
    orgUnitId: string,
    clueId: string,
    opcode: string,
  ): AuditParties {
    return {
      actorId: actor.personnelId,
      actorCode,
      subjectPersonnelId: null,
      subjectCode: null,
      orgUnitId,
      sourceIp: null,
      opcode,
      resourceType: 'clue',
      resourceId: clueId,
    };
  }
}

/** 文件名里的路径分隔符与控制字符换成下划线（与登记同一口径）。 */
function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^\w.\-一-龥]+/gu, '_').slice(0, 120) || 'file';
}
