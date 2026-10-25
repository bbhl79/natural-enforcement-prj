// 线索持久化端口（#211）。
//
// 模块对存储的唯一面向，可注入（CLUE_STORE 令牌）。形态与身份组织模块的 IDENTITY_STORE 相同：
// 端口是纯类型（不引 Prisma），Prisma 适配器在 prisma-clue-store.ts（模块内唯一 import
// 生成客户端的文件，被根 tsconfig 排除在 unit 层之外，由 integration 层承载其编译）。
//
// 几何三表（空间对象、空间部件、命中集）的写入走 $queryRaw（执行纪律 2）：
// 适配器里的几何读写经 case 内的空间写入口径，不经 ORM 写。

import type { VerificationLayerResult } from '../clue/verification/port.ts';

/** 注入令牌。 */
export const CLUE_STORE = Symbol('CLUE_STORE');

/**
 * 幂等键撞车（同一 Idempotency-Key 已有线索行）。
 * 唯一约束挡下并发同键登记；调用方据此回首次结果或 409，不把底层约束错误抛给接口层。
 */
export class ClueIdempotencyConflictError extends Error {
  constructor() {
    super('幂等键已存在');
    this.name = 'ClueIdempotencyConflictError';
  }
}

/** 要件快照行。 */
export interface ClueRequirementSnapshotRow {
  readonly id: string;
  readonly key: string;
  readonly layer: string;
  readonly group: string;
  readonly label: string;
  readonly required: boolean;
  readonly consequence: string;
  readonly timing: string;
  readonly declarationVersion: string;
}

/** 要件取值行。 */
export interface ClueItemValueRow {
  readonly id: string;
  readonly key: string;
  readonly value: string | null;
}

/** 缺件行（类型层缺件为常驻事实行）。 */
export interface ClueItemGapRow {
  readonly id: string;
  readonly key: string;
  readonly layer: string;
  readonly label: string;
  readonly required: boolean;
  readonly timing: string;
  readonly consequence: string;
}

/** 已登记材料行（文件已写入存储，这里只带版本引用）。 */
export interface ClueMaterialRow {
  readonly id: string;
  readonly kind: 'attachment' | 'spatial-source';
  readonly fileKey: string;
  readonly versionId: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly byteSize: number;
  readonly digest: string;
}

/** 空间部件行。几何以 GeoJSON 文本给出：坐标转换在库内做（4326 → 4490）。 */
export interface ClueSpatialPartRow {
  readonly id: string;
  readonly partIndex: number;
  readonly geojson: string;
  readonly sourceSrid: number;
}

/** 空间对象与它的部件。 */
export interface ClueSpatialWrite {
  readonly id: string;
  readonly kind: 'face' | 'point';
  readonly parts: readonly ClueSpatialPartRow[];
}

/** 线索主体待写内容。编号不在这里：编号由库内 sequence 生成。 */
export interface ClueRowToWrite {
  readonly id: string;
  readonly sourceCode: string;
  readonly domain: string;
  readonly receivedAt: Date;
  readonly narrative: string;
  readonly subjectUnknown: boolean;
  readonly anonymityConfirmed: boolean;
  readonly registeredBy: string;
  readonly enteredOrgId: string;
  readonly idempotencyKey: string;
  readonly requestDigest: string;
  readonly sessionId: string;
}

/** 登记写入内容。全部 id 由调用方给（技术主键由装配层生成）。 */
export interface ClueRegistrationWrite {
  readonly clue: ClueRowToWrite;
  readonly requirements: readonly ClueRequirementSnapshotRow[];
  readonly values: readonly ClueItemValueRow[];
  readonly gaps: readonly ClueItemGapRow[];
  readonly initialTypes: readonly { readonly id: string; readonly typeCode: string }[];
  /** 标签。libraryId 是标签库行的候选 id：库里已有同名标签时不写标签库行。 */
  readonly tags: readonly { readonly id: string; readonly libraryId: string; readonly name: string }[];
  readonly materials: readonly ClueMaterialRow[];
  readonly spatial: ClueSpatialWrite;
}

/** 一条命中（一个面对）。 */
export interface ClueHitSummary {
  /** 本线索的面对。 */
  readonly partId: string;
  readonly partIndex: number;
  readonly otherClueId: string;
  readonly otherClueCode: string;
  /** 对方的面对。 */
  readonly otherPartId: string;
  readonly selfRatio: number;
  readonly otherRatio: number;
  readonly intersectionArea: number;
}

/** 命中集待写行（双向：对方线索也打上疑似重复标记）。 */
export interface ClueHitWrite {
  /** 本线索这一行的 id。 */
  readonly id: string;
  /** 对方线索那一行的 id（反向标记）。 */
  readonly reverseId: string;
  readonly partId: string;
  readonly otherClueId: string;
  readonly otherPartId: string;
  readonly selfRatio: number;
  readonly otherRatio: number;
  readonly intersectionArea: number;
}

/** 登记结果。 */
export interface ClueRegistrationOutcome {
  readonly code: string;
  readonly status: string;
  readonly hits: readonly ClueHitSummary[];
}

/** 幂等行（同 key 异报文判 409 用）。 */
export interface ClueIdempotencyRow {
  readonly id: string;
  readonly code: string;
  readonly requestDigest: string;
  readonly status: string;
}

/** 登记结果读取（幂等重放：同 key 同报文回首次结果）。 */
export interface ClueRegistrationResult {
  readonly id: string;
  readonly code: string;
  readonly status: string;
  readonly gaps: readonly { readonly key: string; readonly label: string }[];
  readonly hits: readonly ClueHitSummary[];
}

/** 补齐缺件的写入内容。 */
export interface ClueGapFillWrite {
  readonly clueId: string;
  /** 补上的取值。 */
  readonly values: readonly { readonly id: string; readonly key: string; readonly value: string }[];
  /** 被补齐的缺件行 id。 */
  readonly gapIds: readonly string[];
  /** 补齐时间。 */
  readonly filledAt: Date;
}

/** 补齐结果。 */
export interface ClueGapFillOutcome {
  /** 已补齐的要件键。 */
  readonly filledKeys: readonly string[];
  /** 仍未补齐的缺件。 */
  readonly remaining: readonly { readonly key: string; readonly label: string }[];
}

/** 核查执行中已有活动核查（每条线索至多一个）。 */
export class ClueVerificationRunningError extends Error {
  constructor() {
    super('该线索已有进行中的核查');
    this.name = 'ClueVerificationRunningError';
  }
}

/** 线索的核查上下文：编排与对象级校验要用的全部事实。 */
export interface ClueVerificationContext {
  readonly clueId: string;
  readonly code: string;
  /** 法域：land／mineral 跑核查，survey／planning 不跑。 */
  readonly domain: string;
  /** 线索主状态。 */
  readonly status: string;
  /** 登记人（人员 id）。 */
  readonly registeredBy: string;
  /** 登记机构。 */
  readonly enteredOrgId: string;
  /** 线索归属的机构（登记机构与当前有效的接收机构）。对象级校验用。 */
  readonly orgUnitIds: readonly string[];
  /** 图斑总面积（平方米）。 */
  readonly totalArea: number;
  /** 空间部件（EPSG:4490 GeoJSON 文本）。 */
  readonly parts: readonly {
    readonly partId: string;
    readonly partIndex: number;
    readonly geojson: string;
  }[];
}

/** 一次核查运行的产物引用（对象存储的文件版本引用）。 */
export interface ClueVerificationArtifacts {
  readonly report: { readonly fileKey: string; readonly versionId: string };
  readonly analysis: { readonly fileKey: string; readonly versionId: string };
}

/** 起一次核查运行的写入内容。 */
export interface ClueVerificationRunWrite {
  readonly id: string;
  readonly clueId: string;
  readonly runNo: number;
  /** 触发方式：auto（自动核查）｜manual（手动重跑）。 */
  readonly trigger: 'auto' | 'manual';
  readonly startedAt: Date;
}

/** 收尾一次运行的写入内容。 */
export interface ClueVerificationFinishWrite {
  readonly runId: string;
  readonly status: 'done' | 'failed';
  /** 已用尝试次数。 */
  readonly attemptsUsed: number;
  /** 失败类别：瞬时｜确定性；不失败即 null。 */
  readonly failureCategory: 'transient' | 'deterministic' | null;
  /** 缺图层（键）；不缺即空。 */
  readonly missingLayers: readonly string[];
  /** 每层事实（含服务地址、查询时间、要素标识与相交要素几何）。 */
  readonly layers: readonly VerificationLayerResult[];
  /** 产物引用；没跑成即 null。 */
  readonly artifacts: ClueVerificationArtifacts | null;
  readonly endedAt: Date;
}

/** 一次核查运行行。 */
export interface ClueVerificationRunRow {
  readonly id: string;
  readonly clueId: string;
  readonly runNo: number;
  readonly status: 'running' | 'done' | 'failed';
  readonly attemptsUsed: number;
  readonly trigger: 'auto' | 'manual';
  readonly failureCategory: 'transient' | 'deterministic' | null;
  readonly missingLayers: readonly string[];
  readonly layers: readonly VerificationLayerResult[];
  readonly artifacts: ClueVerificationArtifacts | null;
  readonly startedAt: Date;
  readonly endedAt: Date | null;
}

/** 线索当前的主办与协办（对象级校验用）。 */
export interface ClueActiveHandler {
  readonly personnelId: string;
  readonly role: string;
}

/** 当前有效的分派事实（首次分派、重新分派或指定管辖）。 */
export interface ClueActiveAssignment {
  readonly orgUnitId: string;
  /** 类别：initial | reassign | designate | pool-reassign。 */
  readonly kind: string;
  /** 是否指定管辖。 */
  readonly designate: boolean;
  /** 操作人（人员 id）。 */
  readonly assignedBy: string;
  /** 操作人当时所属机构（指定管辖锁判定用；旧行为空）。 */
  readonly assignedByOrgId: string | null;
}

/** 一条命中（含对方线索状态：决定步只把未结案命中算作「须已知晓」）。 */
export interface ClueDispatchHit {
  readonly partId: string;
  readonly partIndex: number;
  readonly otherClueId: string;
  readonly otherClueCode: string;
  readonly otherPartId: string;
  readonly otherStatus: string;
  readonly selfRatio: number;
  readonly otherRatio: number;
  readonly intersectionArea: number;
}

/** 分派编排上下文：决定、派机构、派承办人与辖区建议要用的全部事实。 */
export interface ClueDispatchContext {
  readonly clueId: string;
  readonly code: string;
  readonly status: string;
  readonly sourceCode: string;
  readonly domain: string;
  readonly registeredBy: string;
  readonly enteredOrgId: string;
  /** 几何形态：face | point。 */
  readonly kind: 'face' | 'point';
  /** 图斑总面积（平方米；点状为 0）。 */
  readonly totalArea: number;
  /** 命中集计算时间。 */
  readonly dupComputedAt: Date | null;
  readonly parts: readonly {
    readonly partId: string;
    readonly partIndex: number;
    readonly geojson: string;
  }[];
  readonly assignment: ClueActiveAssignment | null;
  readonly handlers: readonly ClueActiveHandler[];
  readonly hits: readonly ClueDispatchHit[];
}

/** 分派决定的写入。 */
export interface ClueDecisionWrite {
  readonly clueId: string;
  readonly expectedStatus: string;
  readonly nextStatus: 'in_pool' | 'held';
}

/** 派机构的写入。 */
export interface ClueOrgAssignWrite {
  readonly clueId: string;
  readonly expectedStatus: string;
  readonly assignmentId: string;
  readonly orgUnitId: string;
  /** 类别：initial | reassign | designate。 */
  readonly kind: 'initial' | 'reassign' | 'designate';
  readonly designate: boolean;
  readonly assignedBy: string;
  readonly assignedByOrgId: string;
  /** 理由（重新分派与指定管辖必填；自由文本留业务行，不进留痕）。 */
  readonly reason: string | null;
  readonly assignedAt: Date;
}

/** 撤回不派编排上下文里的一条命中（权限校验要对方线索的承办机构）。 */
export interface ClueWithdrawHit {
  readonly otherClueId: string;
  readonly otherClueCode: string;
  readonly otherStatus: string;
  /** 对方线索当前承办机构（无有效分派即 null；其内勤是撤回不派的有权人之一）。 */
  readonly otherHandlerOrgId: string | null;
}

/** 撤回不派编排上下文：权限与状态校验要用的全部事实。 */
export interface ClueWithdrawContext {
  readonly clueId: string;
  readonly code: string;
  readonly status: string;
  readonly registeredBy: string;
  readonly enteredOrgId: string;
  readonly hits: readonly ClueWithdrawHit[];
}

/** 撤回不派的写入。 */
export interface ClueWithdrawWrite {
  readonly clueId: string;
  readonly expectedStatus: string;
  readonly withdrawalId: string;
  readonly reasonCodes: readonly string[];
  readonly note: string;
  readonly withdrawnBy: string;
  readonly withdrawnAt: Date;
}

/** 派主办／协办的写入。 */
export interface CluePeopleAssignWrite {
  readonly clueId: string;
  readonly expectedStatus: string;
  readonly handlers: readonly {
    readonly id: string;
    readonly personnelId: string;
    readonly role: 'main' | 'assist';
  }[];
  readonly assignedAt: Date;
}

/** 线索存储端口。 */
export interface ClueStore {
  /** 按幂等键查线索。 */
  findByIdempotencyKey(key: string): Promise<ClueIdempotencyRow | null>;
  /** 读登记结果（编号、状态、缺件、命中）。 */
  readRegistrationResult(clueId: string): Promise<ClueRegistrationResult | null>;
  /**
   * 写一条线索及其要件快照、取值、缺件、类型、标签、材料、空间对象与部件；
   * 同时算出当前命中集（面状逐面对，未结案线索参与比对）并回传，但不写命中行。
   */
  insertRegistration(write: ClueRegistrationWrite): Promise<ClueRegistrationOutcome>;
  /** 写命中集：正反两个方向各一行，对方线索也打上疑似重复标记（不改对方状态）。 */
  insertHits(clueId: string, hits: readonly ClueHitWrite[]): Promise<void>;
  /** 读线索的登记机构（对象级校验的目标机构）。 */
  readClueOrgUnitId(clueId: string): Promise<string | null>;
  /** 读一条线索的未补齐缺件。 */
  listOpenGaps(clueId: string): Promise<ClueItemGapRow[]>;
  /** 补齐：写取值并把对应缺件标为已补齐（缺件行保留为事实，清单随之外）。 */
  fillGaps(write: ClueGapFillWrite): Promise<ClueGapFillOutcome>;
  /** 读线索的核查上下文（法域、状态、登记人、几何与图斑总面积）。 */
  readVerificationContext(clueId: string): Promise<ClueVerificationContext | null>;
  /** 该线索的下一个运行序号。 */
  nextVerificationRunNo(clueId: string): Promise<number>;
  /**
   * 起一次核查运行：写运行行并把线索的核查状态置为进行中。
   * 每条线索至多一个活动核查；已有活动核查即抛 ClueVerificationRunningError。
   */
  insertVerificationRun(write: ClueVerificationRunWrite): Promise<void>;
  /** 读一次运行。 */
  readVerificationRun(runId: string): Promise<ClueVerificationRunRow | null>;
  /** 读线索的全部运行（序号倒序）。 */
  listVerificationRuns(clueId: string): Promise<ClueVerificationRunRow[]>;
  /** 收尾一次运行：写状态、尝试次数、失败类别、缺图层、每层事实与产物引用，并同步线索核查状态。 */
  finishVerificationRun(write: ClueVerificationFinishWrite): Promise<void>;
  /** 记一次已用尝试次数（自动重试的中间态：运行仍在进行中）。 */
  recordVerificationAttempt(runId: string, attemptsUsed: number): Promise<void>;
  /** 线索当前的主办与协办（对象级校验用）。 */
  listActiveHandlers(clueId: string): Promise<readonly { personnelId: string; role: string }[]>;
  /** 读分派编排上下文（状态、来源、当前分派事实、承办人与命中集）。 */
  readDispatchContext(clueId: string): Promise<ClueDispatchContext | null>;
  /**
   * 写分派决定：状态由 expectedStatus 条件更新为待分派池（派）或 held（不派）。
   * 返回 false 表示当前状态与 expectedStatus 不符（并发冲突），业务行不变。
   */
  applyDecision(write: ClueDecisionWrite): Promise<boolean>;
  /**
   * 派机构（首次分派、重新分派、指定管辖）：状态条件更新为已派机构，
   * 关止当前分派事实与承办人（重新分派时），写入新的分派事实行。
   * 返回 false 表示当前状态与 expectedStatus 不符（并发冲突），业务行不变。
   */
  assignOrg(write: ClueOrgAssignWrite): Promise<boolean>;
  /**
   * 派主办／协办：状态条件更新为已派承办人，关止原承办人并写入新承办人行。
   * 返回 false 表示当前状态与 expectedStatus 不符（并发冲突），业务行不变。
   */
  assignPeople(write: CluePeopleAssignWrite): Promise<boolean>;
  /** 读撤回不派编排上下文（状态、登记人、当前命中集与对方承办机构）。 */
  readWithdrawContext(clueId: string): Promise<ClueWithdrawContext | null>;
  /**
   * 撤回不派：状态由 expectedStatus 条件更新为待分派池，写入撤回行，
   * 同时了结该线索未处理的结案提醒（撤回即回答了提醒）。
   * 返回 false 表示当前状态与 expectedStatus 不符（并发冲突），业务行不变。
   */
  applyWithdrawal(write: ClueWithdrawWrite): Promise<boolean>;
}
