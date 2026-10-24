// 线索中心的地址契约（#207 H 节路由契约、#209 执行票）。
// 视图、关键词、筛选、日期与分页都进 URL；前端只认本文件里的参数名。
// 抽屉与列表分开命名：抽屉用 clue 与 tab，列表用 view。

export const CLUE_VIEW_KEY = 'view';
export const CLUE_KEYWORD_KEY = 'q';
export const CLUE_CLUE_KEY = 'clue';
export const CLUE_TAB_KEY = 'tab';

/** 六维筛选的参数名（法域、来源、辖区／承办机构、环节状态、内业核查状态、缺件状态）。 */
export const CLUE_FILTER_KEYS = ['domain', 'source', 'org', 'status', 'check', 'gap'] as const;

/** 登记日的起止参数名。 */
export const CLUE_FROM_KEY = 'from';
export const CLUE_TO_KEY = 'to';
export const CLUE_PAGE_KEY = 'page';
export const CLUE_SIZE_KEY = 'size';

/** 线索中心视图（与 /clue?view= 对应）。 */
export const CLUE_VIEWS = [
  { id: 'all', label: '全部线索' },
  { id: 'assign', label: '待分派 / 已分派' },
  { id: 'held', label: '不派线索（可撤回不派）' },
  { id: 'remind', label: '旧线索结案提醒' },
] as const;

export type ClueViewId = (typeof CLUE_VIEWS)[number]['id'];

export const CLUE_VIEW_IDS: readonly string[] = CLUE_VIEWS.map((view) => view.id);

export function clueViewLabel(view: string): string {
  return CLUE_VIEWS.find((item) => item.id === view)?.label ?? CLUE_VIEWS[0].label;
}

/** 切换视图时保留的参数：关键词、筛选、日期与每页条数。页码随视图回到第一页。 */
export const CLUE_PRESERVED_KEYS: readonly string[] = [
  CLUE_KEYWORD_KEY,
  ...CLUE_FILTER_KEYS,
  CLUE_FROM_KEY,
  CLUE_TO_KEY,
  CLUE_SIZE_KEY,
];

export interface ClueUrlState {
  /** 视图键位：all｜assign｜held｜remind。 */
  view: string;
  /** 关键词，空串表示没有。 */
  keyword: string;
  /** 抽屉线索编号，空串表示没有抽屉。 */
  clue: string;
  /** 抽屉页签键位，空串表示没有抽屉。 */
  tab: string;
  /** 六维筛选，值空串表示该项没有筛选。 */
  filters: Record<string, string>;
  /** 登记日起。 */
  from: string;
  /** 登记日止。 */
  to: string;
  /** 页码。 */
  page: string;
  /** 每页条数。 */
  size: string;
}

export function readClueUrlState(search: string): ClueUrlState {
  const params = new URLSearchParams(search);
  const filters: Record<string, string> = {};
  for (const key of CLUE_FILTER_KEYS) filters[key] = params.get(key) ?? '';
  return {
    view: params.get(CLUE_VIEW_KEY) ?? '',
    keyword: params.get(CLUE_KEYWORD_KEY) ?? '',
    clue: params.get(CLUE_CLUE_KEY) ?? '',
    tab: params.get(CLUE_TAB_KEY) ?? '',
    filters,
    from: params.get(CLUE_FROM_KEY) ?? '',
    to: params.get(CLUE_TO_KEY) ?? '',
    page: params.get(CLUE_PAGE_KEY) ?? '',
    size: params.get(CLUE_SIZE_KEY) ?? '',
  };
}

/**
 * 在切换视图时保留关键词、筛选、日期与每页条数。
 * 目标地址自带同名参数时以目标地址为准。
 */
export function withPreservedQuery(target: string, search: string): string {
  const [base, query] = target.split('?');
  const params = new URLSearchParams(query ?? '');
  const current = new URLSearchParams(search);
  for (const key of CLUE_PRESERVED_KEYS) {
    if (params.has(key)) continue;
    const value = current.get(key);
    if (value) params.set(key, value);
  }
  const merged = params.toString();
  return merged ? `${base}?${merged}` : base;
}
