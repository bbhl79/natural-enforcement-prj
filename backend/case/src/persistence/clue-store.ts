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
  /** 补齐时间。null 即仍未补齐。 */
  readonly filledAt: Date | null;
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
  readonly otherPartIndex: number;
  readonly selfRatio: number;
  readonly otherRatio: number;
  readonly intersectionArea: number;
  /** 本线索该面的几何（EPSG:4490 GeoJSON 文本；对比查看用）。 */
  readonly selfGeojson: string;
  /** 对方该面的几何（EPSG:4490 GeoJSON 文本；对比查看用）。 */
  readonly otherGeojson: string;
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

/** 重算上下文：重绘与命中集替换要用的全部事实。 */
export interface ClueDuplicateContext {
  readonly clueId: string;
  readonly code: string;
  readonly domain: string;
  /** 线索来源编码（决定步契约的来源大类判定用）。 */
  readonly sourceCode: string;
  /** 登记时间。 */
  readonly registeredAt: Date;
  /** 匿名线索附件已主动确认移除反映人身份信息。 */
  readonly anonymityConfirmed: boolean;
  /** 线索主状态。 */
  readonly status: string;
  /** 登记人（重绘仅限录入人本人）。 */
  readonly registeredBy: string;
  /** 登记机构。 */
  readonly enteredOrgId: string;
  /** 当前有效的接收机构（未派机构即空）。 */
  readonly assignedOrgUnitIds: readonly string[];
  /** 核查状态（活动核查即 running）。 */
  readonly verificationStatus: string;
  /** 几何形态：face | point。 */
  readonly spatialKind: 'face' | 'point';
  /** 当前空间部件（EPSG:4490 GeoJSON 文本）。 */
  readonly parts: readonly {
    readonly partId: string;
    readonly partIndex: number;
    readonly geojson: string;
  }[];
  /** 当前命中集（本线索视角；重算前的摘要）。 */
  readonly hits: readonly ClueHitSummary[];
  /** 当前命中集计算时间。 */
  readonly dupComputedAt: Date | null;
}

/** 疑似重复对方的展示基础信息（含反映人取值，按权限在装配层脱敏）。 */
export interface ClueDuplicatePeer {
  readonly clueId: string;
  readonly code: string;
  readonly status: string;
  readonly registeredAt: Date;
  /** 线索来源编码。 */
  readonly sourceCode: string;
  /** 匿名线索附件已主动确认移除反映人身份信息。 */
  readonly anonymityConfirmed: boolean;
  /** 位置取值（clue.location；没有即 null）。 */
  readonly location: string | null;
  /** 反映人姓名取值（clue.reporter_name；没有即 null）。 */
  readonly reporterName: string | null;
  /** 反映人联系方式取值（clue.reporter_contact；没有即 null）。 */
  readonly reporterContact: string | null;
  /** 是否匿名（clue.reporter_anonymous 取值为「是」）。 */
  readonly reporterAnonymous: boolean;
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

/** 线索详情行（基本信息与子项合集）。 */
export interface ClueDetailRow {
  readonly id: string;
  readonly code: string;
  readonly domain: string;
  readonly sourceCode: string;
  readonly status: string;
  readonly verificationStatus: string;
  readonly receivedAt: Date;
  readonly registeredAt: Date;
  readonly narrative: string;
  readonly subjectUnknown: boolean;
  readonly anonymityConfirmed: boolean;
  readonly registeredBy: string;
  readonly enteredOrgId: string;
  readonly requirements: readonly ClueRequirementSnapshotRow[];
  readonly gaps: readonly ClueItemGapRow[];
  readonly values: readonly ClueItemValueRow[];
  readonly tags: readonly { readonly name: string }[];
  readonly initialTypes: readonly string[];
}

/** 一条线索的留痕行（不含 detail 字段）。查询走 $queryRaw 直查库表。 */
export interface ClueTrailRow {
  readonly id: string;
  readonly createdAt: Date;
  readonly action: string;
  readonly outcome: string;
  readonly actorCode: string | null;
  readonly subjectCode: string | null;
  readonly orgUnitId: string | null;
  readonly opcode: string | null;
  readonly resourceType: string | null;
  readonly resourceId: string | null;
  readonly reason: string | null;
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
  /** 初步涉嫌违法类型编码列表（#207 P7：用于分派指导判定）。 */
  readonly typeCodes: readonly string[];
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

/** 一对待提醒的线索对（「不派」的暂存线索 × 被结案的线索）。 */
export interface ClueClosureReminderTarget {
  /** 「不派」的暂存线索（提醒挂在它上面）。 */
  readonly clueId: string;
  readonly clueCode: string;
  /** 被结案的线索。 */
  readonly otherClueId: string;
  readonly otherClueCode: string;
  readonly otherStatus: string;
}

/** 结案提醒行（写入用）。 */
export interface ClueClosureReminderRowToWrite {
  readonly id: string;
  readonly clueId: string;
  readonly kind: 'no-case' | 'transfer' | 'case';
  readonly otherClueId: string;
  readonly createdAt: Date;
}

/** 一条结案提醒（列表与处理用）。 */
export interface ClueClosureReminderRow {
  readonly id: string;
  /** 提醒挂着的线索（「不派」的暂存线索）。 */
  readonly clueId: string;
  readonly clueCode: string;
  readonly kind: string;
  /** 对方线索（被结案的那一条）。 */
  readonly otherClueId: string | null;
  readonly otherClueCode: string | null;
  readonly otherStatus: string | null;
  /** 暂存线索的登记人。 */
  readonly registeredBy: string;
  /** 暂存线索的登记机构。 */
  readonly enteredOrgId: string;
  /** 对方线索当前的承办机构（无有效分派即 null）。 */
  readonly otherHandlerOrgId: string | null;
  readonly createdAt: Date;
  /** 处理时间（未处理即 null）。 */
  readonly resolvedAt: Date | null;
  /** 处理结果：withdraw（撤回不派再办）｜close-with-old（随旧线索办结）。 */
  readonly resolution: string | null;
}

/** 处置登记的写入（不予立案、随旧线索办结、移送）。 */
export interface ClueDispositionWrite {
  readonly clueId: string;
  readonly expectedStatus: string;
  readonly dispositionId: string;
  readonly disposition: 'no-case' | 'with-old' | 'transfer';
  readonly transferredOrg: string | null;
  readonly documentNo: string | null;
  readonly note: string | null;
  readonly recordedBy: string;
  readonly recordedAt: Date;
  /** 终态：closed（不予立案／随旧线索办结）｜transferred_out（移送）。 */
  readonly nextStatus: 'closed' | 'transferred_out';
}

/** 提醒处理的写入（二选一：撤回不派再办｜写明原因随旧线索办结）。 */
export interface ClueReminderResolveWrite {
  readonly reminderId: string;
  readonly clueId: string;
  readonly expectedStatus: string;
  readonly resolution: 'withdraw' | 'close-with-old';
  /** 撤回不派再办时的撤回行 id（随旧线索办结时为空）。 */
  readonly withdrawalId: string | null;
  readonly reasonCodes: readonly string[];
  readonly note: string;
  /** 随旧线索办结时的处置行 id（撤回不派再办时为空）。 */
  readonly dispositionId: string | null;
  readonly resolvedBy: string;
  readonly resolvedAt: Date;
}

/** 不派视图的一行（可撤回不派的线索）。 */
export interface ClueHeldRow {
  readonly id: string;
  readonly code: string;
  readonly status: string;
  readonly sourceCode: string;
  readonly domain: string;
  readonly registeredBy: string;
  readonly enteredOrgId: string;
  readonly registeredAt: Date;
  /** 撞上的对方线索编号（疑似重复命中）。 */
  readonly hitCodes: readonly string[];
  /** 对方线索当前的承办机构（其内勤是撤回不派的有权人之一）。 */
  readonly hitHandlerOrgIds: readonly string[];
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

/** 指定管辖报请行。 */
export interface ClueDesignationRequestRow {
  readonly id: string;
  readonly clueId: string;
  readonly requestingOrgId: string;
  /** 拟归属机构（可选；未选即 null）。 */
  readonly proposedOrgId: string | null;
  /** 受理机构（报请方与拟归属机构最近共同上级中有内勤的最近一级）。 */
  readonly reviewerOrgId: string | null;
  readonly reason: string;
  /** 状态：pending | approved | rejected。 */
  readonly status: string;
  readonly decidedBy: string | null;
  readonly decidedAt: Date | null;
  /** 驳回理由（受理人填；批准时为空）。 */
  readonly decisionReason: string | null;
  readonly createdAt: Date;
}

/** 指定管辖报请的写入。 */
export interface ClueDesignationRequestWrite {
  readonly id: string;
  readonly clueId: string;
  readonly requestingOrgId: string;
  readonly proposedOrgId: string | null;
  readonly reviewerOrgId: string;
  readonly reason: string;
  readonly createdAt: Date;
}

/** 报请写入结果：写入成功；已有待处理报请（部分唯一索引挡下并发同报请）。 */
export type ClueDesignationRequestInsert = 'inserted' | 'pending-exists';

/** 关闭（批准或驳回）一条线索的全部待处理报请。 */
export interface ClueDesignationCloseWrite {
  readonly clueId: string;
  readonly status: 'approved' | 'rejected';
  readonly decidedBy: string;
  readonly decisionReason: string | null;
  readonly decidedAt: Date;
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
  /** 读疑似重复上下文（重绘与重算的对象级校验与前后摘要用）。 */
  readDuplicateContext(clueId: string): Promise<ClueDuplicateContext | null>;
  /** 读一条线索的当前命中集（本线索视角，对方编号带出来）。 */
  listHitSummaries(clueId: string): Promise<ClueHitSummary[]>;
  /**
   * 以库内既有部件重算一条线索的命中集（重绘后的正式计算；不含自己）。
   * 只算不写：调用方在同一写事务里经 replaceHitSet 整体替换。
   */
  computeHitsForClue(clueId: string): Promise<ClueHitSummary[]>;
  /**
   * 整体替换一条线索的命中集：先删掉涉及该线索的全部命中行（正向与反向），
   * 再写入新命中集（正反两行），并把 dup_computed_at 推到当前时刻。零命中即清空。
   */
  replaceHitSet(clueId: string, hits: readonly ClueHitWrite[]): Promise<void>;
  /**
   * 重绘的空间写入：删掉旧部件、写入新部件，更新面数与 dup_computed_at。
   * 涉及该线索的命中行须在同事务里先经 replaceHitSet 清掉（命中行外键挂部件）。
   */
  replaceSpatialParts(clueId: string, parts: readonly ClueSpatialPartRow[]): Promise<void>;
  /** 更新线索主状态（重绘后按命中集重推：待分派决定／待分派池）。 */
  updateClueStatus(clueId: string, status: string): Promise<void>;
  /** 读一条线索的要件取值（键 → 文本取值；没有取值即 null）。 */
  readItemValues(clueId: string): Promise<Readonly<Record<string, string | null>>>;
  /** 批量读疑似重复对方的基础信息（编号、状态、登记时间、来源与反映人取值）。 */
  readDuplicatePeers(peerIds: readonly string[]): Promise<ReadonlyMap<string, ClueDuplicatePeer>>;
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
  /**
   * 结案提醒的待生成对：被结案的线索按当前命中集逐对找到「不派」的对方。
   * 与状态写入同一事务调用（调用方把事务内的存储实例传进来）。
   */
  listClosureReminderTargets(closedClueId: string): Promise<readonly ClueClosureReminderTarget[]>;
  /** 写结案提醒行（技术主键由调用方给）。 */
  insertClosureReminders(rows: readonly ClueClosureReminderRowToWrite[]): Promise<void>;
  /**
   * 处置登记：状态条件更新为终态并写入处置行。
   * 起始状态由处置类型定死（不予立案仅已派承办人、随旧线索办结仅不派、移送三个状态）。
   * 返回 false 表示当前状态不符（并发冲突或状态不允许），业务行不变。
   */
  applyDisposition(write: ClueDispositionWrite): Promise<boolean>;
  /** 读一条结案提醒。 */
  readClosureReminder(reminderId: string): Promise<ClueClosureReminderRow | null>;
  /** 读未处理的结案提醒（按线索的数据范围过滤）。 */
  listPendingClosureReminders(orgUnitIds: readonly string[]): Promise<readonly ClueClosureReminderRow[]>;
  /**
   * 提醒处理：撤回不派再办（回待分派池并写撤回行）或写明原因随旧线索办结（进 closed 并写处置行）；
   * 同时了结该线索未处理的其余结案提醒。
   * 返回 false 表示当前状态与 expectedStatus 不符（并发冲突），业务行不变。
   */
  applyReminderResolution(write: ClueReminderResolveWrite): Promise<boolean>;
  /** 不派视图：读数据范围内的「不派」线索。 */
  listHeldClues(orgUnitIds: readonly string[]): Promise<readonly ClueHeldRow[]>;
  /**
   * 历史关联命中（结案线索的空间重合）：对 closed 与 transferred_out 的线索按空间重合算出命中，
   * 带回对方处置信息。不写命中表，仅查询展示用。
   */
  listHistoricalHits(clueId: string): Promise<readonly ClueHistoricalHit[]>;
  /** 线索中心列表：按查询参数分页列出线索（不含反映人字段）。 */
  listClues(query: ClueListQuery): Promise<ClueListPage>;
  /**
   * 读移送编排上下文（编号、状态、登记机构、当前有效分派机构的接收机构）。
   * 对象级校验用：待分派池取登记机构，已派机构／已派承办人取承办机构。
   */
  readTransferContext(clueId: string): Promise<ClueTransferContext | null>;
  /**
   * 登记移送：状态由 expectedStatus 条件更新为 transferred_out 终态
   * （仅 in_pool/org_assigned/handler_assigned 可移送），写处置行（disposition='transfer'），
   * 关止当前分派事实与承办人行（终态退出 OpenItems），挂已入库的移送附件材料行。
   * 返回 false 表示当前状态与 expectedStatus 不符（并发冲突），业务行不变。
   */
  recordTransfer(write: ClueTransferWrite): Promise<boolean>;
  /**
   * 停用机构待分派池的未派出线索清单（in_pool/pending_decision/held，
   * 登记时间倒序）：管理端重新指定的候选。
   */
  listPoolClues(orgUnitId: string): Promise<readonly CluePoolClueRow[]>;
  /**
   * 停用机构池重新指定：线索归属（entered_org_id）改为新接收机构，状态不变，
   * 条件更新限 in_pool/pending_decision/held（未派出）并防并发冲突；
   * 写入指定事实（ClueAssignment kind='pool-reassign'，designate=false，不加锁）。
   * 返回 false 表示当前状态与 expectedStatus 不符（并发冲突），业务行不变。
   */
  reassignPool(write: CluePoolReassignWrite): Promise<boolean>;
  /** 该线索当前待处理的指定管辖报请（无即 null）。报请期间的指定锁（designation-pending）由它判定。 */
  readPendingDesignationRequest(clueId: string): Promise<ClueDesignationRequestRow | null>;
  /** 全部待处理的指定管辖报请（受理人待办取数；量小，由调用方按受理机构过滤）。 */
  listPendingDesignationRequests(): Promise<ClueDesignationRequestRow[]>;
  /**
   * 写入一条指定管辖报请。每条线索至多一条待处理报请：并发同报请被部分唯一索引挡下，
   * 返回 'pending-exists'，调用方判 409 designation-pending。
   */
  insertDesignationRequest(write: ClueDesignationRequestWrite): Promise<ClueDesignationRequestInsert>;
  /** 关闭该线索的全部待处理报请（指定管辖批准或驳回）；返回关止的条数。 */
  closePendingDesignationRequests(write: ClueDesignationCloseWrite): Promise<number>;
  /** 读线索详情（基本信息、要件快照、缺件、取值、标签、初步违法类型）。 */
  readDetail(clueId: string): Promise<ClueDetailRow | null>;
  /** 读线索的全部留痕（按创建时间倒序，经 $queryRaw 直查 audit_trail；不含 detail 字段）。 */
  listTrail(clueId: string): Promise<readonly ClueTrailRow[]>;
  /** 工作台卡片计数：按身份分类的卡片数字。 */
  countWorkbenchCards(orgUnitIds: readonly string[]): Promise<WorkbenchCardCounts>;
}

/** 工作台卡片计数（#207）。按身份分类。 */
export interface WorkbenchCardCounts {
  frontline: {
    /** 待分派决定：in_pool 或 pending_decision 的线索数。 */
    pendingDecision: number;
    /** 待派机构：org_assigned 的线索数。 */
    orgAssigned: number;
    /** 待派承办人：handler_assigned 的线索数。 */
    handlerAssigned: number;
    /** 不派线索：held 的线索数。 */
    held: number;
    /** 结案提醒：未处理 reminder 数。 */
    reminders: number;
    /** 待处理指定管辖：报请状态 pending。 */
    designationPending: number;
  };
  leader: {
    /** 待审核：法制审核 pending（#51 审批模块未实现，暂置 0）。 */
    lawReview: number;
    /** 待审批：行政审核／行政审批 pending（#51 审批模块未实现，暂置 0）。 */
    approval: number;
    /** 结案提醒：未处理 reminder 数。 */
    reminders: number;
    /** 待处理指定管辖：报请状态 pending。 */
    designationPending: number;
  };
  supervision: {
    /** 全部线索数。 */
    total: number;
    /** 待分派线索数：in_pool 或 pending_decision。 */
    pendingDispatch: number;
    /** 不派线索数：held。 */
    held: number;
    /** 已结案线索数：closed。 */
    closed: number;
  };
}

/** 停用机构待分派池线索行（管理端重新指定的候选清单）。 */
export interface CluePoolClueRow {
  readonly clueId: string;
  readonly code: string;
  /** 主状态：in_pool | pending_decision | held。 */
  readonly status: string;
  readonly domain: string;
  readonly registeredAt: Date;
}

/** 线索中心列表查询参数。 */
export interface ClueListQuery {
  readonly view: 'all' | 'assign' | 'held' | 'remind';
  readonly page: number;
  readonly size: number;
  readonly keyword: string;
  readonly domain: string;
  readonly source: string;
  readonly org: string;
  readonly status: string;
  readonly check: string;
  readonly gap: string;
  readonly from: string;
  readonly to: string;
  /** 操作者可见的机构 id 集合。entered_org_id 或当前承办机构在此集合内的线索可见。 */
  readonly orgUnitIds: readonly string[];
}

/** 线索列表行（不含反映人字段）。 */
export interface ClueListRow {
  readonly id: string;
  readonly code: string;
  readonly domain: string;
  readonly sourceCode: string;
  readonly status: string;
  readonly statusLabel: string;
  readonly verificationStatus: string;
  readonly verificationStatusLabel: string;
  readonly narrative: string;
  readonly registeredAt: Date;
  /** 是否有未补齐缺件。 */
  readonly hasGaps: boolean;
  /** 标签名列表。 */
  readonly tags: readonly string[];
}

/** 线索列表分页结果。 */
export interface ClueListPage {
  readonly rows: readonly ClueListRow[];
  readonly total: number;
  readonly page: number;
  readonly size: number;
}

/** 移送编排上下文：登记与对象级校验要用的全部事实。 */
export interface ClueTransferContext {
  readonly clueId: string;
  readonly code: string;
  /** 线索主状态。 */
  readonly status: string;
  /** 登记机构（待分派池的池所属机构）。 */
  readonly enteredOrgId: string;
  /** 当前有效分派事实的接收机构（已派机构／已派承办人时的承办机构）。 */
  readonly assignmentOrgId: string | null;
}

/** 移送登记的写入。附件须先全部写入存储（校验失败存储零写入）。 */
export interface ClueTransferWrite {
  readonly clueId: string;
  readonly expectedStatus: string;
  readonly dispositionId: string;
  /** 移送机关（自然资源部门以外机关）。 */
  readonly transferredOrg: string;
  /** 文书编号。 */
  readonly documentNo: string;
  /** 发函日期（YYYY-MM-DD，北京日历日）。 */
  readonly letterDate: string;
  /** 原因（自由文本，留业务行）。 */
  readonly reason: string;
  readonly recordedBy: string;
  readonly recordedAt: Date;
  /** 已写入存储的移送附件（材料行，选填 0..n）。 */
  readonly materials: readonly ClueMaterialRow[];
}

/** 历史关联命中（结案线索的空间重合）。不写命中表，仅查询展示。 */
export interface ClueHistoricalHit {
  readonly partId: string;
  readonly partIndex: number;
  readonly otherClueId: string;
  readonly otherClueCode: string;
  readonly otherPartId: string;
  readonly otherPartIndex: number;
  readonly selfRatio: number;
  readonly otherRatio: number;
  readonly intersectionArea: number;
  readonly selfGeojson: string;
  readonly otherGeojson: string;
  /** 对方线索的主状态。 */
  readonly otherStatus: string;
  /** 处置类型：no-case | with-old | transfer。 */
  readonly otherDisposition: string | null;
  /** 处置说明。 */
  readonly otherDispositionNote: string | null;
  /** 处置时间。 */
  readonly otherDisposedAt: Date | null;
}

/** 停用机构池重新指定的写入。 */
export interface CluePoolReassignWrite {
  readonly clueId: string;
  readonly expectedStatus: string;
  readonly assignmentId: string;
  /** 新接收机构（须未停用）。 */
  readonly orgUnitId: string;
  /** 理由（必填，自由文本留业务行）。 */
  readonly reason: string;
  readonly assignedBy: string;
  readonly assignedByOrgId: string;
  readonly assignedAt: Date;
}
