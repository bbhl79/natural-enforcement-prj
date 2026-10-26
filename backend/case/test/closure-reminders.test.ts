// 结案提醒生成单测（#226）：kind=case 与 no-case／transfer／other 同口径恒生成。
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

describe('generateClosureReminders（#226 立案提醒恒生成）', () => {
  it('kind=case 必然生成提醒', async () => {
    const store = mockStore();
    const result = await generateClosureReminders(store, {
      closedClueId: 'closed-1',
      kind: 'case',
      createdAt: new Date(),
      newId: () => 'rem-1',
    });
    expect(result).toHaveLength(2);
    expect(store.listClosureReminderTargets).toHaveBeenCalledWith('closed-1');
    expect(store.insertClosureReminders).toHaveBeenCalled();
  });

  it('kind=case 无命中：返回空数组', async () => {
    const store = mockStore(true);
    const result = await generateClosureReminders(store, {
      closedClueId: 'closed-1',
      kind: 'case',
      createdAt: new Date(),
      newId: () => 'rem-1',
    });
    expect(result).toHaveLength(0);
  });

  it('no-case 正常生成', async () => {
    const store = mockStore();
    const result = await generateClosureReminders(store, {
      closedClueId: 'closed-1',
      kind: 'no-case',
      createdAt: new Date(),
      newId: () => 'rem-1',
    });
    expect(result).toHaveLength(2);
  });

  it('transfer 正常生成', async () => {
    const store = mockStore();
    const result = await generateClosureReminders(store, {
      closedClueId: 'closed-1',
      kind: 'transfer',
      createdAt: new Date(),
      newId: () => 'rem-1',
    });
    expect(result).toHaveLength(2);
  });
});
