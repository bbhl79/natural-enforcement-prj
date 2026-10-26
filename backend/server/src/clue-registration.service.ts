// 线索登记（#211；规格 E「上传方式」与错误码表）。
//
// 一次登记 = 一个 multipart/form-data 请求，表单与全部文件一次提交。服务端先完整校验
// 表单与全部文件的真实内容，任一不通过即 4xx（失败留痕，存储一个字节都不写）；全部通过后
// 逐件写入存储，最后在一个数据库事务里写业务行、材料关联与成功留痕。
//
// 三层要件（ADR 0018）：公共层与来源层的阻断项缺失 → 400 non-compliant + 失败留痕，
// 业务行不变；类型层缺件不阻断登记，确认后保存，缺件清单落库为常驻事实。
//
// 幂等：Idempotency-Key 必填，服务端把它与请求摘要存在 Clue 的两个列上。同 key 同报文
// 返回首次结果（200），同 key 异报文返回 409 already-exists。
//
// 留痕：动作词 clue.registered（成功与失败两种），结构化快照写进 detail（只写不回）。

import { Inject, Injectable } from '@nestjs/common';

import {
  rejected,
  type AuditParties,
  type ClueRegisterFailedReason,
} from '@natural-enforcement/audit';
import {
  CLUE_REQUIREMENT_DECLARATION_VERSION,
  CLUE_STORE,
  DOMAINS,
  MAX_SPATIAL_SOURCE_BYTES,
  assessGaps,
  buildFormSchemaItems,
  contentDigest,
  isAnonymousValue,
  isBooleanValue,
  layerOf,
  parseSpatialSource,
  requestDigest,
  validateAttachmentSet,
  ClueIdempotencyConflictError,
  type ClueFormValues,
  type ClueGap,
  type ClueMaterialRow,
  type ClueRegistrationWrite,
  type ClueStore,
  type Domain,
} from '@natural-enforcement/case';
import { findSourceCode, findSourceGroupCode, findViolationType } from '@natural-enforcement/geo-dict';
import {
  AccessControlService,
  isAccessDenied,
  newUlid,
  type ActorRef,
  type DenyReason,
} from '@natural-enforcement/identity';
import { STORAGE_PORT, type StoragePort } from '@natural-enforcement/storage';

import { ClueVerificationService } from './clue-verification.service.ts';
import { LOGIN_DIRECTORY, type LoginDirectory } from './login-directory.ts';
import { UNIT_OF_WORK, type UnitOfWork } from './unit-of-work.ts';

const REGISTER_OPCODE = 'clue.register';

/** 一件上传的文件（控制器已把内容读进内存）。 */
export interface ClueUploadedFile {
  readonly fileName: string;
  readonly contentType: string;
  readonly byteSize: number;
  readonly content: Uint8Array;
}

/** 一次登记请求（表单与文件已解析成结构）。 */
export interface ClueRegistrationRequest {
  readonly idempotencyKey: string;
  readonly sourceCode: string;
  readonly domain: string;
  /** 初步涉嫌违法类型（可空可多选，取值取自违法类型清单）。 */
  readonly types: readonly string[];
  /** 标签（登记时 create-on-use）。 */
  readonly tags: readonly string[];
  /** 当事人不明：独立标记，不拦登记与分派。 */
  readonly subjectUnknown: boolean;
  /** 类型层缺件的确认。 */
  readonly confirm: boolean;
  /** 匿名线索附件已主动确认移除反映人身份信息。 */
  readonly anonymityConfirmed: boolean;
  /** 输入坐标系。 */
  readonly srid: number;
  /** 要件取值。 */
  readonly values: ClueFormValues;
  /** 普通附件。 */
  readonly attachments: readonly ClueUploadedFile[];
  /** 几何来源文件（GeoJSON）。 */
  readonly spatialSource: ClueUploadedFile | null;
  /** 操作者所在会话（幂等键绑定会话与操作者）。 */
  readonly sessionId: string;
}

/** 命中摘要（响应体）。 */
export interface ClueRegistrationHit {
  readonly otherClueId: string;
  readonly otherClueCode: string;
  readonly selfRatio: number;
  readonly otherRatio: number;
  readonly intersectionArea: number;
}

/** 响应体。 */
export interface ClueRegistrationBody {
  readonly result: 'registered';
  readonly id: string;
  readonly code: string;
  readonly status: string;
  /** 常驻缺件清单（类型层缺件）。 */
  readonly gaps: readonly { readonly key: string; readonly label: string }[];
  /** 正式命中（疑似重复）。 */
  readonly hits: readonly ClueRegistrationHit[];
}

export type ClueRegistrationOutcome =
  | { readonly status: 201; readonly body: ClueRegistrationBody }
  /** 类型层缺件确认后保存：仍是登记成功，但缺件清单随正文回。 */
  | { readonly status: 200; readonly body: ClueRegistrationBody }
  | { readonly status: 400; readonly body: { readonly result: 'non-compliant'; readonly rules: readonly string[] } }
  | { readonly status: 413; readonly body: { readonly result: 'non-compliant'; readonly rules: readonly string[] } }
  | { readonly status: 403; readonly body: { readonly reason: DenyReason } }
  | { readonly status: 409; readonly body: { result: 'already-exists' } };

/** 校验不通过：规则码、失败原因与状态码。 */
interface Rejection {
  readonly rules: readonly string[];
  readonly reason: ClueRegisterFailedReason;
  readonly status: 400 | 413;
}

/** 登记计划：校验通过后要写的一切。 */
interface ClueRegistrationPlan {
  readonly clueId: string;
  readonly idempotencyKey: string;
  readonly digest: string;
  readonly write: ClueRegistrationWrite;
  readonly gaps: readonly ClueGap[];
  readonly attachments: readonly ClueUploadedFile[];
  readonly spatialSource: ClueUploadedFile | null;
}

@Injectable()
export class ClueRegistrationService {
  constructor(
    @Inject(LOGIN_DIRECTORY) private readonly directory: LoginDirectory,
    @Inject(CLUE_STORE) private readonly clues: ClueStore,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    private readonly access: AccessControlService,
    private readonly verification: ClueVerificationService,
  ) {}

  async register(actor: ActorRef, request: ClueRegistrationRequest): Promise<ClueRegistrationOutcome> {
    const account = await this.directory.findById(actor.personnelId);
    const orgUnitId = account?.orgUnitId ?? '';

    // 一、纯校验：表单与全部文件的真实内容。任一不通过即 4xx，存储零写入。
    const prepared = this.prepare(actor, orgUnitId, request);
    if (!prepared.ok) {
      return this.reject(actor, account?.code ?? null, orgUnitId, prepared.rejection);
    }
    const plan = prepared.plan;

    // 二、授权：先判权限再写存储，避免无权请求留下孤儿文件。
    try {
      await this.access.authorize(actor, REGISTER_OPCODE, orgUnitId);
    } catch (error) {
      if (!isAccessDenied(error)) throw error;
      return { status: 403, body: { reason: error.reason } };
    }

    // 三、幂等：同 key 同报文回首次结果；同 key 异报文 409。
    const existing = await this.clues.findByIdempotencyKey(plan.idempotencyKey);
    if (existing) {
      if (existing.requestDigest !== plan.digest) {
        return { status: 409, body: { result: 'already-exists' } };
      }
      const replay = await this.clues.readRegistrationResult(existing.id);
      if (replay) return { status: 200, body: toBody(replay) };
    }

    // 四、逐件写存储（校验已全过）。
    const materials = await this.writeStorage(plan);

    // 五、一个事务：业务行 + 材料关联 + 成功留痕。
    const write: ClueRegistrationWrite = { ...plan.write, materials };
    try {
      const outcome = await this.uow.run(async (tx): Promise<ClueRegistrationOutcome> => {
        const inserted = await tx.clues.insertRegistration(write);
        await tx.clues.insertHits(
          plan.clueId,
          inserted.hits.map((hit) => ({
            id: newUlid(),
            reverseId: newUlid(),
            partId: hit.partId,
            otherClueId: hit.otherClueId,
            otherPartId: hit.otherPartId,
            selfRatio: hit.selfRatio,
            otherRatio: hit.otherRatio,
            intersectionArea: hit.intersectionArea,
          })),
        );
        const body: ClueRegistrationBody = {
          result: 'registered',
          id: plan.clueId,
          code: inserted.code,
          status: inserted.status,
          gaps: plan.gaps.map((gap) => ({ key: gap.key, label: gap.label })),
          hits: inserted.hits.map((hit) => ({
            otherClueId: hit.otherClueId,
            otherClueCode: hit.otherClueCode,
            selfRatio: hit.selfRatio,
            otherRatio: hit.otherRatio,
            intersectionArea: hit.intersectionArea,
          })),
        };
        await tx.audit.append({
          action: 'clue.registered',
          ...this.parties(actor, account?.code ?? null, orgUnitId, plan.clueId),
          detail: JSON.stringify({
            code: inserted.code,
            status: inserted.status,
            hits: body.hits.map((hit) => ({
              otherClueCode: hit.otherClueCode,
              selfRatio: Number(hit.selfRatio.toFixed(1)),
              otherRatio: Number(hit.otherRatio.toFixed(1)),
            })),
            typeGapKeys: plan.gaps.map((gap) => gap.key),
          }),
        });
        return { status: plan.gaps.length > 0 ? 200 : 201, body };
      });
      // 六、录入保存成功后自动入队内业核查（不可跳过；测绘与规划不跑）。
      // 投递失败时运行已置「没跑成」，重跑提示继续挂着，不影响登记结果。
      await this.scheduleVerification(plan.clueId);
      return outcome;
    } catch (error) {
      // 并发同幂等键：唯一约束挡住后来者，后来者回首次结果（异报文则 409）。
      if (error instanceof ClueIdempotencyConflictError) {
        const row = await this.clues.findByIdempotencyKey(plan.idempotencyKey);
        if (row && row.requestDigest === plan.digest) {
          const replay = await this.clues.readRegistrationResult(row.id);
          if (replay) return { status: 200, body: toBody(replay) };
        }
        return { status: 409, body: { result: 'already-exists' } };
      }
      throw error;
    }
  }

  /** 自动入队内业核查。投递失败只记日志：线索已保存，核查状态由运行行承载。 */
  private async scheduleVerification(clueId: string): Promise<void> {
    try {
      await this.verification.scheduleAutomatic(clueId);
    } catch (error) {
      console.error(`内业核查自动入队失败（线索 ${clueId}）：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 纯校验：来源与法域与类型核参照数据，要件叠加后判缺件，附件与几何核真实内容。
   * 返回通过时的全部写入计划（id、摘要、要件行、缺件、空间部件）。
   */
  private prepare(
    actor: ActorRef,
    orgUnitId: string,
    request: ClueRegistrationRequest,
  ):
    | { readonly ok: true; readonly plan: ClueRegistrationPlan }
    | { readonly ok: false; readonly rejection: Rejection } {
    const idempotencyKey = request.idempotencyKey.trim();
    if (idempotencyKey === '') {
      return { ok: false, rejection: { rules: ['idempotency-key-required'], reason: 'invalid-form', status: 400 } };
    }
    const source = findSourceCode(request.sourceCode);
    const sourceGroupCode = findSourceGroupCode(request.sourceCode);
    if (!source || sourceGroupCode === null) {
      return { ok: false, rejection: { rules: ['source-code-invalid'], reason: 'invalid-form', status: 400 } };
    }
    const domain = request.domain.trim();
    if (!DOMAINS.includes(domain as Domain)) {
      return { ok: false, rejection: { rules: ['domain-invalid'], reason: 'invalid-form', status: 400 } };
    }
    for (const code of request.types) {
      const type = findViolationType(code);
      if (!type || !type.selectable || type.domain !== domain) {
        return { ok: false, rejection: { rules: ['type-code-invalid'], reason: 'invalid-form', status: 400 } };
      }
    }

    const items = buildFormSchemaItems({ sourceGroupCode, typeCodes: request.types });
    const known = new Set(items.map((item) => item.key));
    for (const key of Object.keys(request.values)) {
      if (!known.has(key) && !PUBLIC_VALUE_KEYS.has(key)) {
        return { ok: false, rejection: { rules: ['value-invalid'], reason: 'invalid-form', status: 400 } };
      }
    }
    const anonymousRaw = request.values['clue.reporter_anonymous'];
    if (anonymousRaw !== undefined && anonymousRaw.trim() !== '' && !isBooleanValue(anonymousRaw)) {
      return { ok: false, rejection: { rules: ['value-invalid'], reason: 'invalid-form', status: 400 } };
    }

    const fileSatisfiedKeys = ['clue.source', 'clue.domain'];
    if (request.spatialSource !== null) fileSatisfiedKeys.push('clue.location');
    if (request.attachments.length > 0) fileSatisfiedKeys.push('clue.materials');
    const gaps = assessGaps({
      items,
      values: request.values,
      sourceCode: request.sourceCode,
      subjectUnknown: request.subjectUnknown,
      fileSatisfiedKeys,
    });
    if (gaps.blocking.length > 0) {
      return {
        ok: false,
        rejection: { rules: gaps.blocking.map((gap) => gap.key), reason: 'missing-required-items', status: 400 },
      };
    }
    if (gaps.typeGaps.length > 0 && !request.confirm) {
      return {
        ok: false,
        rejection: { rules: gaps.typeGaps.map((gap) => gap.key), reason: 'missing-required-items', status: 400 },
      };
    }

    // 取值格式：收到或发现的时间须能解析成时刻（空值已由缺件判定拦下）。
    const receivedAt = parseReceivedAt(request.values['clue.received_at']);
    if (receivedAt === null) {
      return { ok: false, rejection: { rules: ['value-invalid'], reason: 'invalid-form', status: 400 } };
    }

    // 附件：类型、真实内容、件数与字节数。GeoJSON 来源文件不占普通附件配额。
    const attachmentCheck = validateAttachmentSet(
      request.attachments.map((file) => ({
        fileName: file.fileName,
        byteSize: file.byteSize,
        content: file.content,
      })),
    );
    if (!attachmentCheck.ok) {
      return {
        ok: false,
        rejection: {
          rules: [attachmentCheck.rule],
          reason: 'invalid-attachment',
          status: attachmentCheck.tooLarge === true ? 413 : 400,
        },
      };
    }
    if (request.spatialSource !== null && request.spatialSource.byteSize > MAX_SPATIAL_SOURCE_BYTES) {
      return {
        ok: false,
        rejection: { rules: ['attachment-size-exceeded'], reason: 'invalid-geometry', status: 413 },
      };
    }

    // 几何：土地/矿产＝面，测绘/规划＝点；只收 EPSG:4326。
    let parts: { id: string; partIndex: number; geojson: string; sourceSrid: number }[] = [];
    let spatialKind: 'face' | 'point' = 'face';
    if (request.spatialSource !== null) {
      const parsed = parseSpatialSource({
        text: Buffer.from(request.spatialSource.content).toString('utf8'),
        domain: domain as Domain,
        srid: request.srid,
      });
      if (!parsed.ok) {
        return { ok: false, rejection: { rules: [parsed.rule], reason: 'invalid-geometry', status: 400 } };
      }
      spatialKind = parsed.kind;
      parts = parsed.parts.map((part) => ({
        id: newUlid(),
        partIndex: part.partIndex,
        geojson: part.geojson,
        sourceSrid: parsed.sourceSrid,
      }));
    }

    // 匿名线索的附件：须主动确认已移除反映人身份信息。
    const anonymous = isAnonymousValue(anonymousRaw ?? '');
    if (anonymous && request.attachments.length > 0 && !request.anonymityConfirmed) {
      return {
        ok: false,
        rejection: { rules: ['anonymity-confirmation-required'], reason: 'invalid-form', status: 400 },
      };
    }

    const files = [
      ...request.attachments.map((file) => ({
        kind: 'attachment' as const,
        fileName: file.fileName,
        digest: contentDigest(file.content),
      })),
      ...(request.spatialSource === null
        ? []
        : [
            {
              kind: 'spatial-source' as const,
              fileName: request.spatialSource.fileName,
              digest: contentDigest(request.spatialSource.content),
            },
          ]),
    ];
    const digest = requestDigest({
      sourceCode: request.sourceCode,
      domain,
      typeCodes: request.types,
      tags: request.tags,
      subjectUnknown: request.subjectUnknown,
      values: request.values,
      files,
    });

    const clueId = newUlid();
    const write: ClueRegistrationWrite = {
      clue: {
        id: clueId,
        sourceCode: request.sourceCode,
        domain,
        receivedAt,
        narrative: request.values['clue.narrative'] ?? '',
        subjectUnknown: request.subjectUnknown,
        anonymityConfirmed: request.anonymityConfirmed,
        registeredBy: actor.personnelId,
        enteredOrgId: orgUnitId,
        idempotencyKey,
        requestDigest: digest,
        sessionId: request.sessionId,
      },
      requirements: items.map((item) => ({
        id: newUlid(),
        key: item.key,
        layer: layerOf(item),
        group: item.group,
        label: item.label,
        required: item.required,
        consequence: item.consequence,
        timing: item.timing,
        declarationVersion: CLUE_REQUIREMENT_DECLARATION_VERSION,
      })),
      values: Object.entries(request.values)
        .filter(([, value]) => value.trim() !== '')
        .map(([key, value]) => ({ id: newUlid(), key, value })),
      gaps: gaps.typeGaps.map((gap) => ({
        id: newUlid(),
        key: gap.key,
        layer: gap.layer,
        label: gap.label,
        required: gap.required,
        timing: gap.timing,
        consequence: gap.consequence,
        filledAt: null,
      })),
      initialTypes: request.types.map((typeCode) => ({ id: newUlid(), typeCode })),
      tags: request.tags.map((name) => ({ id: newUlid(), libraryId: newUlid(), name })),
      materials: [],
      spatial: { id: newUlid(), kind: spatialKind, parts },
    };

    return {
      ok: true,
      plan: {
        clueId,
        idempotencyKey,
        digest,
        write,
        gaps: gaps.typeGaps,
        attachments: request.attachments,
        spatialSource: request.spatialSource,
      },
    };
  }

  /** 逐件写存储。校验已全过，这里只写不判。 */
  private async writeStorage(plan: ClueRegistrationPlan): Promise<ClueMaterialRow[]> {
    const items: { kind: 'attachment' | 'spatial-source'; file: ClueUploadedFile }[] = [
      ...plan.attachments.map((file) => ({ kind: 'attachment' as const, file })),
      ...(plan.spatialSource === null ? [] : [{ kind: 'spatial-source' as const, file: plan.spatialSource }]),
    ];
    const materials: ClueMaterialRow[] = [];
    let index = 0;
    for (const item of items) {
      index += 1;
      const fileKey = `clue/${plan.clueId}/${item.kind}/${index}-${sanitizeFileName(item.file.fileName)}`;
      const ref = await this.storage.putVersion(fileKey, item.file.content);
      materials.push({
        id: newUlid(),
        kind: item.kind,
        fileKey: ref.fileKey,
        versionId: ref.versionId,
        fileName: item.file.fileName,
        contentType: item.file.contentType,
        byteSize: item.file.byteSize,
        digest: contentDigest(item.file.content),
      });
    }
    return materials;
  }

  /** 失败留痕：拒绝类留痕在回滚后另起事务写入（#119 口径）。 */
  private async reject(
    actor: ActorRef,
    actorCode: string | null,
    orgUnitId: string,
    rejection: Rejection,
  ): Promise<ClueRegistrationOutcome> {
    const body = { result: 'non-compliant' as const, rules: rejection.rules };
    const outcome: ClueRegistrationOutcome =
      rejection.status === 413 ? { status: 413, body } : { status: 400, body };
    await this.uow.run(async () =>
      rejected<ClueRegistrationOutcome>(outcome, {
        action: 'clue.registered',
        outcome: 'failed',
        reason: rejection.reason,
        ...this.parties(actor, actorCode, orgUnitId, null),
      }),
    );
    return outcome;
  }

  /** 留痕的当事人列。反映人明文、精确坐标与要件值不进留痕。 */
  private parties(
    actor: ActorRef,
    actorCode: string | null,
    orgUnitId: string,
    clueId: string | null,
  ): AuditParties {
    return {
      actorId: actor.personnelId,
      actorCode,
      subjectPersonnelId: null,
      subjectCode: null,
      orgUnitId,
      sourceIp: null,
      opcode: REGISTER_OPCODE,
      resourceType: clueId === null ? null : 'clue',
      resourceId: clueId,
    };
  }
}

/** 公共层里由表单顶层字段承担的键：它们不进 values，也不单独算缺件。 */
const PUBLIC_VALUE_KEYS = new Set([
  'clue.source',
  'clue.domain',
  'clue.location',
  'clue.received_at',
  'clue.narrative',
  'clue.initial_types',
  'clue.materials',
  'clue.tags',
]);

/** 收到或发现的时间：ISO 日期或日期时间。 */
function parseReceivedAt(raw: string | undefined): Date | null {
  if (raw === undefined || raw.trim() === '') return null;
  const value = new Date(raw.trim());
  if (Number.isNaN(value.getTime())) return null;
  return value;
}

/** 文件名里的路径分隔符与控制字符换成下划线。 */
function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^\w.\-一-龥]+/gu, '_').slice(0, 120) || 'file';
}

/** 幂等重放：把库里的登记结果整成响应体。 */
function toBody(result: {
  id: string;
  code: string;
  status: string;
  gaps: readonly { key: string; label: string }[];
  hits: readonly {
    otherClueId: string;
    otherClueCode: string;
    selfRatio: number;
    otherRatio: number;
    intersectionArea: number;
  }[];
}): ClueRegistrationBody {
  return {
    result: 'registered',
    id: result.id,
    code: result.code,
    status: result.status,
    gaps: result.gaps,
    hits: result.hits.map((hit) => ({
      otherClueId: hit.otherClueId,
      otherClueCode: hit.otherClueCode,
      selfRatio: hit.selfRatio,
      otherRatio: hit.otherRatio,
      intersectionArea: hit.intersectionArea,
    })),
  };
}
