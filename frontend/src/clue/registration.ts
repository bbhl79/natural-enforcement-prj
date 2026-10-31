// 线索登记（#211；规格 E「录入、标签与文件」）的前端数据层与纯函数。
//
// 表单按 GET /api/clue/form-schema 渲染：公共层、来源层、类型层三层叠加的要件由后端声明给出，
// 前端不导入后端常量、不复制规则（ADR 0018「一份声明，两个用途」）。
// 取值表只此一份：来源编码与可选违法类型经 GET /api/clue/reference 取，渲染成规范选择控件。
//
// 提交是一次 multipart/form-data：表单与全部文件一次提交，带 Idempotency-Key 头。
// 校验不通过返回 400 与 rules（缺件键）：表单标红并保留已填内容。
// 类型层缺件先给清单，用户确认后再带 confirm 提交，仍可保存。

import { data } from 'react-router';

import { apiFetch, type ApiDispatch } from '../api';
import type { SessionStore } from '../session';

export const CLUE_REGISTER = 'clue.register';

export type ClueDomain = 'land' | 'mineral' | 'survey' | 'planning';

export const DOMAIN_LABEL: Record<ClueDomain, string> = {
  land: '土地',
  mineral: '矿产',
  survey: '测绘',
  planning: '规划',
};

/** 一项录入要件（后端声明的一项）。 */
export interface FormSchemaItem {
  readonly key: string;
  readonly label: string;
  readonly group: string;
  readonly required: boolean;
  readonly timing: string;
  readonly consequence: string;
  readonly condition?: string;
  readonly basis: readonly { readonly document: string; readonly documentName: string; readonly article: string }[];
  readonly basisNote?: string;
}

/** 叠加后的录入表单结构。来源与法域未选时为空串，只有公共层要件。 */
export interface FormSchema {
  readonly result: 'listed';
  readonly declarationVersion: string;
  readonly source: { readonly code: string; readonly name: string; readonly group: string };
  readonly domain: ClueDomain | '';
  readonly types: readonly { readonly code: string; readonly name: string }[];
  readonly groups: readonly { readonly name: string; readonly items: readonly FormSchemaItem[] }[];
  readonly items: readonly FormSchemaItem[];
}

/** 参照清单：来源编码与可选违法类型。 */
export interface ClueReference {
  readonly result: 'listed';
  readonly sources: readonly { readonly code: string; readonly name: string; readonly group: string }[];
  readonly types: readonly { readonly code: string; readonly name: string; readonly domain: ClueDomain }[];
}

/** 登记请求的表单内容。 */
export interface RegisterInput {
  readonly sourceCode: string;
  readonly domain: string;
  readonly types: readonly string[];
  readonly tags: readonly string[];
  readonly subjectUnknown: boolean;
  readonly anonymityConfirmed: boolean;
  readonly confirm: boolean;
  /** 要件取值：要件键 → 文本。 */
  readonly values: Readonly<Record<string, string>>;
  readonly attachments: readonly File[];
  readonly spatialSource: File | null;
}

/** 登记成功的响应体。 */
export interface RegisterBody {
  readonly result: 'registered';
  readonly id: string;
  readonly code: string;
  readonly status: string;
  readonly gaps: readonly { readonly key: string; readonly label: string }[];
  readonly hits: readonly {
    readonly otherClueId: string;
    readonly otherClueCode: string;
    readonly selfRatio: number;
    readonly otherRatio: number;
    readonly intersectionArea: number;
  }[];
}

/** 工作台「登记新线索」壳的友好地址；旧 /clue/register 也归到这里。 */
export const CLUE_REGISTER_PATH = '/workbench/register';

/** 登记壳内的步骤地址：保留既有 ?step= 续办语义。 */
export function registerStepPath(step: string | number, clueId = ''): string {
  const params = new URLSearchParams({ step: String(step) });
  if (clueId !== '') params.set('clue', clueId);
  return `${CLUE_REGISTER_PATH}?${params.toString()}`;
}

/** 从地址读登记初值：来源、法域与类型可分享；新办不预填法域。 */
export function registerInputFromQuery(
  search: URLSearchParams,
): Pick<RegisterInput, 'sourceCode' | 'domain' | 'types'> {
  return {
    sourceCode: search.get('sourceCode') ?? '',
    domain: search.get('domain') ?? '',
    types: (search.get('types') ?? '').split(',').filter((value) => value !== ''),
  };
}

export type RegisterResult =
  | { readonly ok: true; readonly status: number; readonly body: RegisterBody }
  | { readonly ok: false; readonly status: number; readonly rules: readonly string[] };

/**
 * 封闭取值：从要件名读出来（声明里写「（取值：A｜B）」的按取值渲染；问句按是否渲染）。
 * 读不出取值的按文本填。
 */
export function optionsOf(item: Pick<FormSchemaItem, 'label'>): string[] | null {
  const declared = /（取值：([^）]+)）/.exec(item.label);
  if (declared) {
    const options = (declared[1] as string)
      .split('｜')
      .map((value) => value.trim())
      .filter((value) => value !== '');
    return options.length > 0 ? options : null;
  }
  if (item.label.includes('是否')) return ['是', '否'];
  return null;
}

/** 缺件键是不是类型层的（类型层缺件不阻断登记，先给清单再确认）。 */
export function isTypeLayerKey(key: string): boolean {
  return key.startsWith('type.');
}

/** 阻断项与类型层缺件分开：阻断项标红，类型层缺件给清单。 */
export function splitRules(rules: readonly string[]): {
  readonly blocking: readonly string[];
  readonly typeGaps: readonly string[];
} {
  return {
    blocking: rules.filter((rule) => !isTypeLayerKey(rule)),
    typeGaps: rules.filter((rule) => isTypeLayerKey(rule)),
  };
}

/** 必填集合：与后端缺件判定同一份声明（前端只作展示，不另定必填口径）。 */
export function requiredKeys(items: readonly FormSchemaItem[]): string[] {
  return items.filter((item) => item.required).map((item) => item.key);
}

/** 取参照清单。 */
export async function loadReference(dispatch: ApiDispatch): Promise<ClueReference> {
  const response = await apiFetch(dispatch, '/api/clue/reference');
  if (!response.ok) throw data({ status: response.status }, response.status);
  return (await response.json()) as ClueReference;
}

/** 取叠加后的录入表单结构。 */
export async function loadFormSchema(
  dispatch: ApiDispatch,
  query: { readonly sourceCode: string; readonly domain: string; readonly types: readonly string[] },
): Promise<FormSchema> {
  const params = new URLSearchParams();
  params.set('sourceCode', query.sourceCode);
  params.set('domain', query.domain);
  if (query.types.length > 0) params.set('types', query.types.join(','));
  const response = await apiFetch(dispatch, `/api/clue/form-schema?${params.toString()}`);
  if (!response.ok) throw data({ status: response.status }, response.status);
  return (await response.json()) as FormSchema;
}

/** 参照清单的 loader。 */
export function clueReferenceLoader(store: SessionStore) {
  return async () => {
    const reference = loadReference(store.dispatch);
    reference.catch(() => undefined);
    return { reference };
  };
}

/**
 * 录入页的 loader。来源、法域与类型在地址里（换这三样即换叠加的要件），
 * 地址是唯一事实源，分享与收藏都带着它。参照清单先取回，表单首屏即出；
 * 来源或法域未选时服务端只出公共层，来源补充与违法类型按依赖显隐。
 */
export function clueRegisterLoader(store: SessionStore) {
  return async ({ request }: { request: Request }) => {
    const url = new URL(request.url);
    const sourceCode = url.searchParams.get('sourceCode') ?? '';
    const domain = url.searchParams.get('domain') ?? '';
    const types = (url.searchParams.get('types') ?? '').split(',').filter((value) => value !== '');
    // 表单要按声明渲染，进页就要有结果：参照与要件一起取回，不流式展开。
    const [reference, schema] = await Promise.all([
      loadReference(store.dispatch),
      loadFormSchema(store.dispatch, { sourceCode, domain, types }),
    ]);
    return { reference, schema };
  };
}

/** 提交登记：表单与全部文件一次提交。 */
export async function submitRegistration(
  dispatch: ApiDispatch,
  input: RegisterInput,
  idempotencyKey: string,
): Promise<RegisterResult> {
  const form = new FormData();
  form.set('sourceCode', input.sourceCode);
  form.set('domain', input.domain);
  if (input.types.length > 0) form.set('types', input.types.join(','));
  if (input.tags.length > 0) form.set('tags', input.tags.join(','));
  form.set('subjectUnknown', String(input.subjectUnknown));
  form.set('anonymityConfirmed', String(input.anonymityConfirmed));
  form.set('confirm', String(input.confirm));
  form.set('values', JSON.stringify(input.values));
  for (const attachment of input.attachments) {
    form.append('attachment', attachment, attachment.name);
  }
  if (input.spatialSource !== null) {
    form.append('spatial-source', input.spatialSource, input.spatialSource.name);
  }
  const response = await apiFetch(dispatch, '/api/clues', {
    method: 'POST',
    headers: { 'idempotency-key': idempotencyKey },
    body: form,
  });
  const body = (await response.json().catch(() => null)) as unknown;
  if (response.ok) {
    return { ok: true, status: response.status, body: body as RegisterBody };
  }
  const rules =
    typeof body === 'object' && body !== null && Array.isArray((body as { rules?: unknown }).rules)
      ? ((body as { rules: unknown[] }).rules.filter((rule): rule is string => typeof rule === 'string'))
      : [];
  return { ok: false, status: response.status, rules };
}

/** 新的幂等键：表单内容一变就换一枚（同一份报文的重复提交仍走同一枚）。 */
export function newIdempotencyKey(): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return random;
}
