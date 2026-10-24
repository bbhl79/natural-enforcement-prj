// 线索中心的地址契约（#207 H 节路由契约、#209 执行票）。
// 视图、抽屉页签、筛选、关键词、日期与分页都可入 URL；抽屉与列表分开命名。
import { describe, expect, it } from 'vitest';

import {
  CLUE_CLUE_KEY,
  CLUE_FILTER_KEYS,
  CLUE_KEYWORD_KEY,
  CLUE_TAB_KEY,
  CLUE_VIEW_KEY,
  CLUE_VIEWS,
  clueViewLabel,
  readClueUrlState,
  withPreservedQuery,
} from './clueUrl';

describe('线索中心的地址参数', () => {
  it('视图、关键词、抽屉与页签分开命名', () => {
    expect(CLUE_VIEW_KEY).toBe('view');
    expect(CLUE_KEYWORD_KEY).toBe('q');
    expect(CLUE_CLUE_KEY).toBe('clue');
    expect(CLUE_TAB_KEY).toBe('tab');
    expect(CLUE_VIEW_KEY).not.toBe(CLUE_CLUE_KEY);
  });

  it('四个视图的键位与文案固定', () => {
    expect(CLUE_VIEWS.map((view) => view.id)).toEqual(['all', 'assign', 'held', 'remind']);
    expect(clueViewLabel('assign')).toBe('待分派 / 已分派');
    // 未知视图回落到第一个视图。
    expect(clueViewLabel('nope')).toBe('全部线索');
  });

  it('视图、关键词、筛选、日期与分页都能从地址读回', () => {
    const search = '?view=held&q=%E7%BA%A2%E7%BA%BF&domain=land&source=report&org=hz&status=pool&check=done&gap=yes&from=2026-01-01&to=2026-02-01&page=3&size=50';
    const state = readClueUrlState(search);
    expect(state.view).toBe('held');
    expect(state.keyword).toBe('红线');
    expect(state.filters).toEqual({ domain: 'land', source: 'report', org: 'hz', status: 'pool', check: 'done', gap: 'yes' });
    expect(state.from).toBe('2026-01-01');
    expect(state.to).toBe('2026-02-01');
    expect(state.page).toBe('3');
    expect(state.size).toBe('50');
  });

  it('地址不带参数时各字段为空串', () => {
    const state = readClueUrlState('');
    expect(state.view).toBe('');
    expect(state.keyword).toBe('');
    expect(state.clue).toBe('');
    expect(state.tab).toBe('');
    expect(state.from).toBe('');
    expect(state.page).toBe('');
    for (const key of CLUE_FILTER_KEYS) expect(state.filters[key]).toBe('');
  });

  it('切换视图时保留关键词、筛选、日期与每页条数，页码回到第一页', () => {
    const search = '?view=all&q=%E7%BA%A2%E7%BA%BF&domain=land&from=2026-01-01&to=2026-02-01&page=3&size=50';
    const next = withPreservedQuery('/clue?view=held', search);
    const params = new URLSearchParams(next.split('?')[1]);
    expect(params.get('view')).toBe('held');
    expect(params.get('q')).toBe('红线');
    expect(params.get('domain')).toBe('land');
    expect(params.get('from')).toBe('2026-01-01');
    expect(params.get('to')).toBe('2026-02-01');
    expect(params.get('size')).toBe('50');
    expect(params.get('page')).toBeNull();
  });

  it('目标地址自带的同名参数以目标地址为准', () => {
    const next = withPreservedQuery('/clue?view=held&q=%E7%BB%BF%E5%B7%9E', '?view=all&q=%E7%BA%A2%E7%BA%BF');
    const params = new URLSearchParams(next.split('?')[1]);
    expect(params.get('view')).toBe('held');
    expect(params.get('q')).toBe('绿州');
  });

  it('没有要保留的参数时不带查询串', () => {
    expect(withPreservedQuery('/clue?view=all', '')).toBe('/clue?view=all');
  });
});
