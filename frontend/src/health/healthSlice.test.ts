import { describe, expect, it } from 'vitest';

import reducer, { fetchHealthSnapshot, type HealthSnapshot } from './healthSlice';

const snapshot: HealthSnapshot = {
  generatedAt: '2026-10-10T16:00:00+08:00',
  checks: [
    { id: 'containers', label: '容器存活', status: 'ok', detail: '全部容器运行中' },
    { id: 'db', label: '数据库连通', status: 'ok', detail: '数据库可连通' },
    { id: 'queue', label: '队列连通', status: 'fail', detail: '队列不可连通' },
    { id: 'frontend', label: '前端可访问', status: 'ok', detail: '面板可访问' },
  ],
};

describe('healthSlice', () => {
  it('初始状态为 idle：无快照、无错误', () => {
    const state = reducer(undefined, { type: '@@init' });
    expect(state.loadState).toBe('idle');
    expect(state.snapshot).toBeNull();
    expect(state.error).toBeNull();
  });

  it('快照读取成功：进入 succeeded 并保存快照（含红项也视为读取成功）', () => {
    const state = reducer(undefined, fetchHealthSnapshot.fulfilled(snapshot, 'req-1'));
    expect(state.loadState).toBe('succeeded');
    expect(state.snapshot).toEqual(snapshot);
    expect(state.error).toBeNull();
  });

  it('快照读取失败：进入 failed 并保留错误信息', () => {
    const state = reducer(
      undefined,
      fetchHealthSnapshot.rejected(new Error('HTTP 404'), 'req-2', undefined, 'HTTP 404'),
    );
    expect(state.loadState).toBe('failed');
    expect(state.snapshot).toBeNull();
    expect(state.error).toBe('HTTP 404');
  });

  it('重新读取时清除上一次错误', () => {
    const failed = reducer(
      undefined,
      fetchHealthSnapshot.rejected(new Error('HTTP 404'), 'req-2', undefined, 'HTTP 404'),
    );
    const loading = reducer(failed, fetchHealthSnapshot.pending('req-3'));
    expect(loading.loadState).toBe('loading');
    expect(loading.error).toBeNull();
  });
});
