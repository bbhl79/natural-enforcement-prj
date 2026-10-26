// 结案提醒生成特性开关单测（#207 P2）。
// filedReminderEnabled 默认关：kind='case' 不调用存储、不生成提醒。
// filedReminderEnabled=true：kind='case' 正常生成。
// no-case 与 transfer 不受开关影响。
import { describe, expect, it, vi } from 'vitest';

import { generateClosureReminders } from '../src/clue/closure/index.ts';
import type { ClueStore } from '../src/persistence/clue-store.ts';

function mockStore(returnEmpty = false): ClueStore {
  if (returnEmpty) {
    return {
      listClosureReminderTargets: vi.fn(async () => []),
      insertClosureReminders: vi.fn(async () => {}),
    } as unknown as ClueStore;
  }
  return {
    listClosureReminderTargets: vi.fn(async () => [
      { clueId: 'held-1', otherClueId: 'closed-1' },
      { clueId: 'held-2', otherClueId: 'closed-1' },
    ]),
    insertClosureReminders: vi.fn(async () => {}),
  } as unknown as ClueStore;
}

describe('filedReminderEnabled 特性开关（#207 P2）', () => {
  it('默认关：kind=case 不调用存储、返回空数组', async () => {
    const store = mockStore();
    const result = await generateClosureReminders(store, {
      closedClueId: 'closed-1',
      kind: 'case',
      createdAt: new Date(),
      newId: () => 'rem-1',
    });
    expect(result).toHaveLength(0);
    expect(store.listClosureReminderTargets).not.toHaveBeenCalled();
  });

  it('显式关：kind=case 不调用存储、返回空数组', async () => {
    const store = mockStore();
    const result = await generateClosureReminders(store, {
      closedClueId: 'closed-1',
      kind: 'case',
      createdAt: new Date(),
      newId: () => 'rem-1',
      filedReminderEnabled: false,
    });
    expect(result).toHaveLength(0);
    expect(store.listClosureReminderTargets).not.toHaveBeenCalled();
  });

  it('开关打开：kind=case 正常生成提醒', async () => {
    const store = mockStore();
    const result = await generateClosureReminders(store, {
      closedClueId: 'closed-1',
      kind: 'case',
      createdAt: new Date(),
      newId: () => 'rem-1',
      filedReminderEnabled: true,
    });
    expect(result).toHaveLength(2);
    expect(store.listClosureReminderTargets).toHaveBeenCalledWith('closed-1');
    expect(store.insertClosureReminders).toHaveBeenCalled();
  });

  it('开关打开但无命中：返回空数组', async () => {
    const store = mockStore(true);
    const result = await generateClosureReminders(store, {
      closedClueId: 'closed-1',
      kind: 'case',
      createdAt: new Date(),
      newId: () => 'rem-1',
      filedReminderEnabled: true,
    });
    expect(result).toHaveLength(0);
  });

  it('no-case 不受开关影响：默认也正常生成', async () => {
    const store = mockStore();
    const result = await generateClosureReminders(store, {
      closedClueId: 'closed-1',
      kind: 'no-case',
      createdAt: new Date(),
      newId: () => 'rem-1',
    });
    expect(result).toHaveLength(2);
    expect(store.listClosureReminderTargets).toHaveBeenCalled();
  });

  it('transfer 不受开关影响：默认也正常生成', async () => {
    const store = mockStore();
    const result = await generateClosureReminders(store, {
      closedClueId: 'closed-1',
      kind: 'transfer',
      createdAt: new Date(),
      newId: () => 'rem-1',
    });
    expect(result).toHaveLength(2);
    expect(store.listClosureReminderTargets).toHaveBeenCalled();
  });
});