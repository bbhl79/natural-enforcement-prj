// 线索持久化端口（#211）。
//
// 模块对存储的唯一面向，可注入（CLUE_STORE 令牌）。形态与身份组织模块的 IDENTITY_STORE 相同：
// 端口是纯类型（不引 Prisma），Prisma 适配器在 prisma-clue-store.ts（模块内唯一 import
// 生成客户端的文件，被根 tsconfig 排除在 unit 层之外，由 integration 层承载其编译）。
//
// 几何三表（空间对象、空间部件、命中集）的写入走 $queryRaw（执行纪律 2）：
// 适配器里的几何读写经 case 内的空间写入口径，不经 ORM 写。

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
}
