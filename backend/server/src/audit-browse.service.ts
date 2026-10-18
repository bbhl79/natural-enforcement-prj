import { Inject, Injectable } from '@nestjs/common';
import {
  auditCategoryOf,
  isAuditCategory,
  rejected,
  type AuditCategory,
  type Rejected,
  type AuditTrailQuery,
  type AuditTrailRecord,
} from '@natural-enforcement/audit';
import { AccessControlService, type ActorRef, type DenyReason } from '@natural-enforcement/identity';

import {
  describeAuditRow,
  auditRowCells,
  AUDIT_COLUMNS,
  type AuditResourceNames,
  type AuditRowView,
} from './audit-labels.ts';
import { CLOCK, type Clock } from './clock.ts';
import { UNIT_OF_WORK, type TxScope, type UnitOfWork } from './unit-of-work.ts';
import { buildXlsx } from './xlsx.ts';

export const AUDIT_READ = 'audit.admin.read';
export const AUDIT_EXPORT = 'audit.admin.export';

const DAY_MS = 24 * 60 * 60 * 1000;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ACTOR_CODE_MAX = 64;

/** 查阅与导出的请求体。字段都可省：时间默认昨天到今天（Asia/Shanghai），范围默认本人任职机构。 */
export interface AuditFilterInput {
  from?: unknown;
  to?: unknown;
  category?: unknown;
  actorCode?: unknown;
  outcome?: unknown;
  orgUnitId?: unknown;
}

export interface AuditFilter {
  /** 起止日期（含），Asia/Shanghai 日历日，YYYY-MM-DD。 */
  from: string;
  to: string;
  category: AuditCategory | null;
  actorCode: string | null;
  outcome: 'succeeded' | 'failed' | null;
}

export interface AuditScope {
  orgUnitId: string;
  orgName: string;
  /** 范围根是根机构：带上没有所属机构的行。 */
  includesUnanchored: boolean;
}

export interface AuditRowBody extends AuditRowView {
  id: string;
  action: string;
  outcome: string;
  category: AuditCategory | null;
}

type Denial = { status: 403; body: { reason: DenyReason } };
type Invalid = { status: 400; body: { result: 'non-compliant'; rules: ['invalid-filter'] } };

/** 授权与筛选都通过后的范围与库里的查阅条件。 */
interface Authorized {
  scope: AuditScope;
  filter: AuditFilter;
  query: AuditTrailQuery;
  actorCode: string | null;
}

/** 授权与筛选都通过后取到的行。 */
interface Prepared {
  scope: AuditScope;
  filter: AuditFilter;
  rows: AuditRowBody[];
  actorCode: string | null;
}

const INVALID: Invalid = { status: 400, body: { result: 'non-compliant', rules: ['invalid-filter'] } };

export type AuditQueryOutcome =
  | {
      status: 200;
      body: { result: 'listed'; scope: AuditScope; filter: AuditFilter; total: number; rows: AuditRowBody[] };
    }
  | Denial
  | Invalid;

export type AuditExportOutcome =
  | { status: 200; file: Buffer; filename: string; itemCount: number }
  | Denial
  | Invalid;

export type AuditSummaryOutcome =
  | { status: 200; body: { result: 'counted'; today: number } }
  | Denial;

/** Asia/Shanghai 日历日。 */
function shanghaiDate(at: Date): string {
  return new Date(at.getTime() + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
}

/** 日历日在 Asia/Shanghai 的零点。不是合法日期时为 null。 */
function shanghaiMidnight(date: string): Date | null {
  if (!DATE.test(date)) return null;
  const at = new Date(`${date}T00:00:00.000+08:00`);
  if (Number.isNaN(at.getTime()) || shanghaiDate(at) !== date) return null;
  return at;
}

/** 校验并补齐筛选条件。不合法时为 null。 */
export function parseAuditFilter(input: AuditFilterInput, now: Date): AuditFilter | null {
  const today = shanghaiDate(now);
  const yesterday = shanghaiDate(new Date(now.getTime() - DAY_MS));
  const from = input.from === undefined || input.from === null || input.from === '' ? yesterday : input.from;
  const to = input.to === undefined || input.to === null || input.to === '' ? today : input.to;
  if (typeof from !== 'string' || typeof to !== 'string') return null;
  const fromAt = shanghaiMidnight(from);
  const toAt = shanghaiMidnight(to);
  if (!fromAt || !toAt || fromAt.getTime() > toAt.getTime()) return null;
  let category: AuditCategory | null = null;
  if (input.category !== undefined && input.category !== null && input.category !== '') {
    if (!isAuditCategory(input.category)) return null;
    category = input.category;
  }
  let actorCode: string | null = null;
  if (input.actorCode !== undefined && input.actorCode !== null) {
    if (typeof input.actorCode !== 'string' || input.actorCode.length > ACTOR_CODE_MAX) return null;
    actorCode = input.actorCode.trim() || null;
  }
  let outcome: AuditFilter['outcome'] = null;
  if (input.outcome !== undefined && input.outcome !== null && input.outcome !== '') {
    if (input.outcome !== 'succeeded' && input.outcome !== 'failed') return null;
    outcome = input.outcome;
  }
  return { from, to, category, actorCode, outcome };
}

/** 导出文件名「管理台留痕_起止日期.xlsx」（原型 v0.4 G32：管理台留痕_20261016-20261017.xlsx）。 */
export function auditExportFilename(filter: Pick<AuditFilter, 'from' | 'to'>): string {
  return `管理台留痕_${filter.from.replace(/-/g, '')}-${filter.to.replace(/-/g, '')}.xlsx`;
}

/**
 * 管理台留痕的查阅与导出（#126，#105「留痕查阅与导出」）。
 * - 授权：audit.admin.read / audit.admin.export，目标机构 = 请求的范围根（默认本人任职机构）。
 * - 范围：有所属机构的行按所属机构落在范围根子树内；没有所属机构的行视同根机构，只有范围根是根机构时出现。
 *   授权拒绝行的所属机构是目标机构（#105；ADR 0011 修正）。
 * - 查阅写 audit.viewed，导出写 audit.exported（带条数）。都在读完之后写，所以本次写的行不在本次结果里。
 *   读取与留痕同一事务：留痕写失败时整体失败，不交出数据。
 * - 导出范围等于查阅范围：同一筛选条件、同一段代码取行，文件的每一行与页面一行的文字相同。
 */
@Injectable()
export class AuditBrowseService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly access: AccessControlService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async query(actor: ActorRef, input: AuditFilterInput, sourceIp: string | null): Promise<AuditQueryOutcome> {
    return this.uow.run<AuditQueryOutcome>(async (tx) => {
      const ready = await this.prepare(tx, actor, AUDIT_READ, input);
      if (!('scope' in ready)) return ready;
      const { scope, filter, rows, actorCode } = ready;
      await tx.audit.append({
        action: 'audit.viewed',
        ...this.parties(actor, actorCode, scope, AUDIT_READ, sourceIp),
      });
      return { status: 200, body: { result: 'listed', scope, filter, total: rows.length, rows } };
    });
  }

  async export(actor: ActorRef, input: AuditFilterInput, sourceIp: string | null): Promise<AuditExportOutcome> {
    return this.uow.run<AuditExportOutcome>(async (tx) => {
      const ready = await this.prepare(tx, actor, AUDIT_EXPORT, input);
      if (!('scope' in ready)) return ready;
      const { scope, filter, rows, actorCode } = ready;
      const file = buildXlsx('管理台留痕', [[...AUDIT_COLUMNS], ...rows.map(auditRowCells)]);
      await tx.audit.append({
        action: 'audit.exported',
        ...this.parties(actor, actorCode, scope, AUDIT_EXPORT, sourceIp),
        itemCount: rows.length,
      });
      return { status: 200, file, filename: auditExportFilename(filter), itemCount: rows.length };
    });
  }

  /** 管理台首页「今日 N 条」（P3）：同一套授权与范围，库里只数条数，不取行、不写 audit.viewed。 */
  async summary(actor: ActorRef): Promise<AuditSummaryOutcome> {
    return this.uow.run<AuditSummaryOutcome>(async (tx) => {
      const today = shanghaiDate(this.clock.now());
      const ready = await this.authorize(tx, actor, AUDIT_READ, { from: today, to: today });
      if (!('scope' in ready)) {
        if ('outcome' in ready) return ready;
        throw new Error('今日条数的筛选条件不合法');
      }
      // 首页条数不按类别筛（筛选条件里本来也没有类别），count 忽略 category
      return { status: 200, body: { result: 'counted', today: await tx.auditReader.count(ready.query) } };
    });
  }

  /** 授权、校验筛选、算出范围；通过后得到库里的查阅条件。 */
  private async authorize(
    tx: TxScope,
    actor: ActorRef,
    opcode: string,
    input: AuditFilterInput,
  ): Promise<Authorized | Rejected<Denial> | Invalid> {
    const me = await tx.directory.findById(actor.personnelId);
    const requested = typeof input.orgUnitId === 'string' && input.orgUnitId !== '' ? input.orgUnitId : null;
    const target = requested ?? me?.orgUnitId ?? '';
    const decision = await this.access.check(actor, opcode, target, {
      resourceType: 'org-unit',
      resourceId: target || null,
    }, tx.store);
    if (!decision.allowed) {
      return rejected<Denial>({ status: 403, body: { reason: decision.reason } }, decision.denial);
    }
    const filter = parseAuditFilter(input, this.clock.now());
    if (!filter) return INVALID;
    const org = await tx.store.findOrgUnitById(target);
    const scope: AuditScope = {
      orgUnitId: target,
      orgName: org?.name ?? '',
      includesUnanchored: org != null && org.parentId == null,
    };
    const query: AuditTrailQuery = {
      from: shanghaiMidnight(filter.from) as Date,
      to: new Date((shanghaiMidnight(filter.to) as Date).getTime() + DAY_MS),
      orgUnitIds: await tx.store.listOrgUnitSubtreeIds(target),
      includeUnanchored: scope.includesUnanchored,
      category: filter.category,
      actorCode: filter.actorCode,
      outcome: filter.outcome,
    };
    return { scope, filter, query, actorCode: me?.code ?? null };
  }

  private async prepare(
    tx: TxScope,
    actor: ActorRef,
    opcode: string,
    input: AuditFilterInput,
  ): Promise<Prepared | Rejected<Denial> | Invalid> {
    const ready = await this.authorize(tx, actor, opcode, input);
    if (!('scope' in ready)) return ready;
    const records = await tx.auditReader.list(ready.query);
    const names = await this.resourceNames(tx, records);
    const rows: AuditRowBody[] = records.map((record) => ({
      id: record.id,
      action: record.action,
      outcome: record.outcome,
      category: auditCategoryOf(record.action, record.opcode),
      ...describeAuditRow(record, names),
    }));
    return { scope: ready.scope, filter: ready.filter, rows, actorCode: ready.actorCode };
  }

  /**
   * 授权拒绝行只写资源标识，不写被作用人员（ADR 0011）。
   * 「对象」一列按资源标识查：人员查工号，机构查名称。
   * 「所属机构」一列：授权拒绝行的所属机构是目标机构，库里不连机构表，按标识查名称（ADR 0011 修正）。
   */
  private async resourceNames(tx: TxScope, records: readonly AuditTrailRecord[]): Promise<AuditResourceNames> {
    const ids = (type: string) => new Set(
      records.filter((row) => row.resourceType === type && row.resourceId).map((row) => row.resourceId as string),
    );
    const personnelCodes = new Map<string, string>();
    for (const id of ids('personnel')) {
      const person = await tx.store.findPersonnelById(id);
      if (person) personnelCodes.set(id, person.code);
    }
    const orgNames = new Map<string, string>();
    const orgIds = ids('org-unit');
    for (const row of records) {
      if (row.anchorOrgUnitId && row.anchorOrgUnitId !== row.orgUnitId) orgIds.add(row.anchorOrgUnitId);
    }
    for (const id of orgIds) {
      const org = await tx.store.findOrgUnitById(id);
      if (org) orgNames.set(id, org.name);
    }
    return { personnelCodes, orgNames };
  }

  private parties(actor: ActorRef, actorCode: string | null, scope: AuditScope, opcode: string, sourceIp: string | null) {
    return {
      actorId: actor.personnelId,
      actorCode,
      subjectPersonnelId: null,
      subjectCode: null,
      orgUnitId: scope.orgUnitId,
      sourceIp,
      opcode,
      resourceType: 'org-unit',
      resourceId: scope.orgUnitId,
    };
  }
}
