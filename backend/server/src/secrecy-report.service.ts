// 保密报告工单（#225；#222 草案 §1「报告工单」＋「等待指令」）。
//
// 对已隔离（#224 quarantined）对象生成工单：待报 → 已报 → 已回执，只进不退。
// 工单 → 对象：quarantine_id；对象 → 工单：按材料反查（一对象至多一张工单）。
// 时限提醒：默认发现后 24 小时，系统内提醒责任人；不对外发文，不代替审批。
// 已回执须人工录入保密部门指令摘要与回执附件。任何状态都不触发销毁：
// 本服务不调用、也拿不到 DeleteObject；无超时自动动作；不改 WORM 锁／保留期。
//
// 权限与 #224 对齐：操作码 storage.secrecy-report.manage 只给系统管理，
// 对象级再收窄到目标对象所属根机构的系统管理员。责任人一期＝生成工单的系统管理员本人。

import { Inject, Injectable } from '@nestjs/common';

import { rejected, type AuditAppend } from '@natural-enforcement/audit';
import {
  CLUE_STORE,
  SECRECY_REPORT_STATUS_LABELS,
  checkSecrecyReportTransition,
  secrecyReportDueAt,
  secrecyReportReminder,
  type ClueStore,
  type SecrecyReportStatus,
  type SecrecyReportTicketRow,
} from '@natural-enforcement/case';
import {
  AccessControlService,
  IDENTITY_STORE,
  isAccessDenied,
  newUlid,
  type ActorRef,
  type IdentityStore,
} from '@natural-enforcement/identity';
import { STORAGE_PORT, type StoragePort } from '@natural-enforcement/storage';

import { CLOCK, type Clock } from './clock.ts';
import { LOGIN_DIRECTORY, type LoginDirectory } from './login-directory.ts';
import { UNIT_OF_WORK, type UnitOfWork } from './unit-of-work.ts';

const OPCODE = 'storage.secrecy-report.manage';

/** 回执附件（框架无关形状）。 */
export interface ReceiptFile {
  readonly fileName: string;
  readonly contentType: string;
  readonly byteSize: number;
  readonly content: Uint8Array;
}

/** 工单对外视图。 */
export interface SecrecyReportView {
  readonly id: string;
  readonly status: string;
  readonly statusLabel: string;
  readonly responsiblePersonnelId: string;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly reportDueAt: string;
  /** 时限提醒；只有待报工单有，其余为 null。 */
  readonly reminder: { readonly dueAt: string; readonly remainingMinutes: number; readonly overdue: boolean } | null;
  readonly reportedBy: string | null;
  readonly reportedAt: string | null;
  readonly reportNote: string | null;
  readonly instructionSummary: string | null;
  readonly receipt: { readonly fileName: string; readonly receiptedBy: string; readonly receiptedAt: string } | null;
  readonly object: {
    readonly quarantineId: string;
    readonly materialId: string | null;
    readonly clueId: string | null;
    readonly fileKey: string;
    readonly versionId: string;
    readonly discoveredBy: string;
    readonly discoveredAt: string;
    readonly summary: string;
    /** 对象仍为隔离态：本期无销毁通道。 */
    readonly quarantined: true;
  };
}

type Denied = { readonly status: 403; readonly body: { readonly reason: string } };
type NotFound = { readonly status: 404; readonly body: { readonly result: 'not-found' } };
type Ticket200 = { readonly status: 200; readonly body: { readonly result: string; readonly ticket: SecrecyReportView } };

export type SecrecyReportCreateOutcome =
  | Ticket200
  | Denied
  | NotFound
  | { readonly status: 409; readonly body: { readonly result: 'invalid-state'; readonly reason: 'not-quarantined' | 'already-exists' } };

export type SecrecyReportReadOutcome = Ticket200 | Denied | NotFound;

export type SecrecyReportTransitionOutcome =
  | Ticket200
  | Denied
  | NotFound
  | { readonly status: 400; readonly body: { readonly result: 'non-compliant'; readonly reason: string } }
  | { readonly status: 409; readonly body: { readonly result: 'invalid-state' | 'concurrent-change'; readonly reason: string } };

export type SecrecyReportReminderListOutcome =
  | {
      readonly status: 200;
      readonly body: { readonly deadlineHours: 24; readonly items: readonly SecrecyReportView[] };
    }
  | Denied;

interface Scope {
  readonly actorOrgId: string;
  readonly actorCode: string | null;
}

@Injectable()
export class SecrecyReportService {
  constructor(
    private readonly access: AccessControlService,
    @Inject(LOGIN_DIRECTORY) private readonly directory: LoginDirectory,
    @Inject(IDENTITY_STORE) private readonly identity: IdentityStore,
    @Inject(CLUE_STORE) private readonly clues: ClueStore,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** 对已隔离材料对象生成工单（待报），到期时刻＝发现时刻＋24 小时。 */
  async createForMaterial(actor: ActorRef, materialId: string): Promise<SecrecyReportCreateOutcome> {
    const target = await this.clues.findMaterialQuarantineTarget(materialId);
    if (!target) return { status: 404, body: { result: 'not-found' } };
    const resourceId = `${target.fileKey}@${target.versionId}`;
    const scope = await this.authorize(actor, target.enteredOrgId, resourceId);
    if ('status' in scope) return scope;

    const object = await this.clues.findQuarantinedObjectByMaterial(materialId);
    if (!object) {
      return this.rejectBefore(actor, scope, resourceId, 409, 'invalid-state', {
        action: 'storage.secrecy-report-created',
        reason: 'not-quarantined',
      }) as Promise<SecrecyReportCreateOutcome>;
    }

    const createdAt = this.clock.now();
    const id = newUlid();
    const written = await this.uow.run(async (tx) => {
      const result = await tx.clues.insertSecrecyReportTicket({
        id,
        quarantineId: object.quarantineId,
        responsiblePersonnelId: actor.personnelId,
        createdBy: actor.personnelId,
        createdAt,
        reportDueAt: secrecyReportDueAt(object.discoveredAt),
      });
      if (result === 'already-exists') {
        return rejected<'already-exists' | 'written'>('already-exists', {
          action: 'storage.secrecy-report-created',
          outcome: 'failed',
          reason: 'already-exists',
          ...this.parties(actor, scope, resourceId),
        });
      }
      await tx.audit.append({
        action: 'storage.secrecy-report-created',
        ...this.parties(actor, scope, resourceId),
        detail: JSON.stringify({
          ticketId: id,
          quarantineId: object.quarantineId,
          materialId: object.materialId,
          status: 'pending_report',
          responsiblePersonnelId: actor.personnelId,
          reportDueAt: secrecyReportDueAt(object.discoveredAt).toISOString(),
        }),
      });
      return 'written' as const;
    });
    if (written === 'already-exists') {
      return { status: 409, body: { result: 'invalid-state', reason: 'already-exists' } };
    }
    const row = await this.clues.findSecrecyReportTicket(id);
    if (!row) throw new Error(`保密报告工单写入后读不到：${id}`);
    return { status: 200, body: { result: 'created', ticket: this.view(row) } };
  }

  /** 对象 → 工单：按材料反查工单。 */
  async readByMaterial(actor: ActorRef, materialId: string): Promise<SecrecyReportReadOutcome> {
    const target = await this.clues.findMaterialQuarantineTarget(materialId);
    if (!target) return { status: 404, body: { result: 'not-found' } };
    const scope = await this.authorize(actor, target.enteredOrgId, `${target.fileKey}@${target.versionId}`);
    if ('status' in scope) return scope;
    const object = await this.clues.findQuarantinedObjectByMaterial(materialId);
    const row = object ? await this.clues.findSecrecyReportTicketByQuarantine(object.quarantineId) : null;
    if (!row) return { status: 404, body: { result: 'not-found' } };
    return { status: 200, body: { result: 'found', ticket: this.view(row) } };
  }

  /** 工单 → 对象：按工单 id 读，含关联隔离对象。 */
  async read(actor: ActorRef, ticketId: string): Promise<SecrecyReportReadOutcome> {
    const loaded = await this.load(actor, ticketId);
    if ('status' in loaded) return loaded;
    return { status: 200, body: { result: 'found', ticket: this.view(loaded.row) } };
  }

  /** 登记已报：责任人按规程向保密部门／上级报告后人工登记。系统不代发。 */
  async markReported(actor: ActorRef, ticketId: string, reportNoteRaw: string): Promise<SecrecyReportTransitionOutcome> {
    const loaded = await this.load(actor, ticketId);
    if ('status' in loaded) return loaded;
    const { row, scope, resourceId } = loaded;
    const action = 'storage.secrecy-report-reported' as const;
    const reportNote = reportNoteRaw.trim();
    if (reportNote === '') {
      return this.rejectBefore(actor, scope, resourceId, 400, 'non-compliant', { action, reason: 'missing-report-note' });
    }
    if (!checkSecrecyReportTransition(row.status, 'report').ok) {
      return this.rejectBefore(actor, scope, resourceId, 409, 'invalid-state', { action, reason: 'invalid-state' });
    }
    const reportedAt = this.clock.now();
    return this.transition(actor, scope, resourceId, ticketId, action, (tx) =>
      tx.clues.markSecrecyReportReported({ id: ticketId, reportedBy: actor.personnelId, reportedAt, reportNote }),
      { ticketId, from: 'pending_report', to: 'reported', reportNote, reportedAt: reportedAt.toISOString() },
      'reported',
    );
  }

  /** 录入保密部门指令摘要与回执附件 → 已回执。不触发销毁。 */
  async recordReceipt(
    actor: ActorRef,
    ticketId: string,
    input: { readonly instructionSummary: string; readonly attachment: ReceiptFile | null },
  ): Promise<SecrecyReportTransitionOutcome> {
    const loaded = await this.load(actor, ticketId);
    if ('status' in loaded) return loaded;
    const { row, scope, resourceId } = loaded;
    const action = 'storage.secrecy-report-receipted' as const;
    const instructionSummary = input.instructionSummary.trim();
    if (instructionSummary === '') {
      return this.rejectBefore(actor, scope, resourceId, 400, 'non-compliant', {
        action,
        reason: 'missing-instruction-summary',
      });
    }
    const file = input.attachment;
    if (!file || file.byteSize <= 0) {
      return this.rejectBefore(actor, scope, resourceId, 400, 'non-compliant', {
        action,
        reason: 'missing-receipt-attachment',
      });
    }
    if (!checkSecrecyReportTransition(row.status, 'receipt').ok) {
      return this.rejectBefore(actor, scope, resourceId, 409, 'invalid-state', { action, reason: 'invalid-state' });
    }
    // 回执附件追加写入（WORM）；只写不删。
    const ref = await this.storage.putVersion(
      `secrecy-report/${ticketId}/receipt-${sanitizeFileName(file.fileName)}`,
      file.content,
    );
    const receiptedAt = this.clock.now();
    return this.transition(actor, scope, resourceId, ticketId, action, (tx) =>
      tx.clues.markSecrecyReportReceipted({
        id: ticketId,
        instructionSummary,
        receiptFileKey: ref.fileKey,
        receiptVersionId: ref.versionId,
        receiptFileName: file.fileName,
        receiptedBy: actor.personnelId,
        receiptedAt,
      }),
      {
        ticketId,
        from: 'reported',
        to: 'receipted',
        instructionSummary,
        receiptFileKey: ref.fileKey,
        receiptVersionId: ref.versionId,
        receiptFileName: file.fileName,
        receiptedAt: receiptedAt.toISOString(),
      },
      'receipted',
    );
  }

  /** 时限提醒：本人名下待报工单，按到期升序；剩余时间按注入时钟算。只提醒，不产生任何自动动作。 */
  async listReminders(actor: ActorRef): Promise<SecrecyReportReminderListOutcome> {
    const account = await this.directory.findById(actor.personnelId);
    const actorOrgId = account?.orgUnitId ?? '';
    try {
      await this.access.authorize(actor, OPCODE, actorOrgId, {
        resourceType: 'secrecy-report',
        resourceId: 'reminders',
      });
    } catch (error) {
      if (!isAccessDenied(error)) throw error;
      return { status: 403, body: { reason: error.reason } };
    }
    const rows = await this.clues.listPendingSecrecyReports(actor.personnelId);
    return { status: 200, body: { deadlineHours: 24, items: rows.map((row) => this.view(row)) } };
  }

  private async load(
    actor: ActorRef,
    ticketId: string,
  ): Promise<{ row: SecrecyReportTicketRow; scope: Scope; resourceId: string } | Denied | NotFound> {
    const row = await this.clues.findSecrecyReportTicket(ticketId);
    if (!row) return { status: 404, body: { result: 'not-found' } };
    const resourceId = `${row.object.fileKey}@${row.object.versionId}`;
    const scope = await this.authorize(actor, row.object.enteredOrgId, resourceId);
    if ('status' in scope) return scope;
    return { row, scope, resourceId };
  }

  /** 操作码授权＋对象所属根机构收窄（与 #224 同口径）。 */
  private async authorize(actor: ActorRef, enteredOrgId: string | null, resourceId: string): Promise<Scope | Denied> {
    const account = await this.directory.findById(actor.personnelId);
    const actorOrgId = account?.orgUnitId ?? '';
    const actorCode = account?.code ?? null;
    const targetOrgId = enteredOrgId ?? actorOrgId;
    try {
      await this.access.authorize(actor, OPCODE, targetOrgId, { resourceType: 'storage-object', resourceId });
    } catch (error) {
      if (!isAccessDenied(error)) throw error;
      return { status: 403, body: { reason: error.reason } };
    }
    const rootId =
      enteredOrgId === null ? '' : ((await this.identity.findOrgUnitPathToRoot(enteredOrgId))[0] ?? '');
    if (rootId === '' || actorOrgId !== rootId) {
      await this.uow.run(async (tx) => {
        await tx.audit.append({
          action: 'authz.denied',
          outcome: 'failed',
          reason: 'scope-denied',
          actorId: actor.personnelId,
          actorCode,
          subjectPersonnelId: null,
          subjectCode: null,
          orgUnitId: actorOrgId || null,
          sourceIp: null,
          opcode: OPCODE,
          resourceType: 'storage-object',
          resourceId,
          previousValue: null,
          targetOrgUnitId: targetOrgId || null,
          targetOrgUnitBasis: 'object',
        });
      });
      return { status: 403, body: { reason: 'scope-denied' } };
    }
    return { actorOrgId, actorCode };
  }

  private async transition(
    actor: ActorRef,
    scope: Scope,
    resourceId: string,
    ticketId: string,
    action: 'storage.secrecy-report-reported' | 'storage.secrecy-report-receipted',
    write: (tx: Parameters<Parameters<UnitOfWork['run']>[0]>[0]) => Promise<boolean>,
    detail: Record<string, unknown>,
    result: string,
  ): Promise<SecrecyReportTransitionOutcome> {
    const applied = await this.uow.run(async (tx) => {
      if (!(await write(tx))) {
        return rejected<boolean>(false, {
          action,
          outcome: 'failed',
          reason: 'concurrent-change',
          ...this.parties(actor, scope, resourceId),
        } as AuditAppend);
      }
      await tx.audit.append({
        action,
        ...this.parties(actor, scope, resourceId),
        detail: JSON.stringify(detail),
      } as AuditAppend);
      return true;
    });
    if (!applied) return { status: 409, body: { result: 'concurrent-change', reason: 'concurrent-change' } };
    const row = await this.clues.findSecrecyReportTicket(ticketId);
    if (!row) throw new Error(`保密报告工单迁移后读不到：${ticketId}`);
    return { status: 200, body: { result, ticket: this.view(row) } };
  }

  /** 校验拒绝：业务行不动，另起事务写失败留痕。 */
  private async rejectBefore(
    actor: ActorRef,
    scope: Scope,
    resourceId: string,
    status: 400 | 409,
    result: 'non-compliant' | 'invalid-state',
    failure: { readonly action: AuditAppend['action']; readonly reason: string },
  ): Promise<SecrecyReportTransitionOutcome> {
    const body = { result, reason: failure.reason };
    await this.uow.run(async () =>
      rejected<null>(null, {
        action: failure.action,
        outcome: 'failed',
        reason: failure.reason,
        ...this.parties(actor, scope, resourceId),
      } as AuditAppend),
    );
    return { status, body } as SecrecyReportTransitionOutcome;
  }

  private parties(actor: ActorRef, scope: Scope, resourceId: string) {
    return {
      actorId: actor.personnelId,
      actorCode: scope.actorCode,
      subjectPersonnelId: null as string | null,
      subjectCode: null as string | null,
      orgUnitId: scope.actorOrgId || null,
      sourceIp: null as string | null,
      opcode: OPCODE,
      resourceType: 'storage-object',
      resourceId,
    };
  }

  private view(row: SecrecyReportTicketRow): SecrecyReportView {
    const reminder = secrecyReportReminder(row.status, row.reportDueAt, this.clock.now());
    return {
      id: row.id,
      status: row.status,
      statusLabel: SECRECY_REPORT_STATUS_LABELS[row.status as SecrecyReportStatus] ?? row.status,
      responsiblePersonnelId: row.responsiblePersonnelId,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
      reportDueAt: row.reportDueAt.toISOString(),
      reminder: reminder
        ? { dueAt: reminder.dueAt.toISOString(), remainingMinutes: reminder.remainingMinutes, overdue: reminder.overdue }
        : null,
      reportedBy: row.reportedBy,
      reportedAt: row.reportedAt?.toISOString() ?? null,
      reportNote: row.reportNote,
      instructionSummary: row.instructionSummary,
      receipt:
        row.receiptFileName && row.receiptedBy && row.receiptedAt
          ? { fileName: row.receiptFileName, receiptedBy: row.receiptedBy, receiptedAt: row.receiptedAt.toISOString() }
          : null,
      object: {
        quarantineId: row.object.quarantineId,
        materialId: row.object.materialId,
        clueId: row.object.clueId,
        fileKey: row.object.fileKey,
        versionId: row.object.versionId,
        discoveredBy: row.object.discoveredBy,
        discoveredAt: row.object.discoveredAt.toISOString(),
        summary: row.object.summary,
        quarantined: true,
      },
    };
  }
}

/** 文件名里的路径分隔符与控制字符换成下划线（与登记同一口径）。 */
function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^\w.\-一-龥]+/gu, '_').slice(0, 120) || 'file';
}
