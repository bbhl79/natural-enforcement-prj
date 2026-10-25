// 停用机构池重新指定的前端测试（#216；规格 D 节、截图键 admin-org-pool-reassign）。
// 测的是可见行为：清单与状态文案、理由与接收机构必填才可提交、失败文案。
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { PoolReassignView } from './PoolReassignPanel';
import { poolReassignFailureText, poolStatusLabel, type PoolClue } from './poolReassign';

const clues: PoolClue[] = [
  { clueId: 'c1', code: 'CL0000000001', status: 'in_pool', domain: 'land', registeredAt: '2026-10-25T01:00:00.000Z' },
  { clueId: 'c2', code: 'CL0000000002', status: 'pending_decision', domain: 'land', registeredAt: '2026-10-25T02:00:00.000Z' },
  { clueId: 'c3', code: 'CL0000000003', status: 'held', domain: 'mineral', registeredAt: '2026-10-25T03:00:00.000Z' },
];

describe('停用机构池重新指定', () => {
  it('列出未派出线索与状态；接收机构与理由未填时重新指定按钮禁用', () => {
    const html = renderToStaticMarkup(
      <PoolReassignView
        orgName="石牌自然资源所"
        clues={clues}
        targets={[{ id: 'o2', name: '天河区分局' }]}
        busy={false}
        failure={null}
        notice={null}
        onReassign={() => undefined}
      />,
    );
    expect(html).toContain('石牌自然资源所已停用');
    expect(html).toContain('CL0000000001');
    expect(html).toContain('待分派决定');
    expect(html).toContain('不派');
    expect(html).toContain('天河区分局');
    expect(html).toContain('理由必填并留痕');
    expect(html).toContain('不构成指定管辖');
    expect(html).toMatch(/data-role="pool-reassign-submit"[^>]*disabled/);
  });

  it('池里没有未派出线索时给空提示', () => {
    const html = renderToStaticMarkup(
      <PoolReassignView
        orgName="石牌自然资源所"
        clues={[]}
        targets={[]}
        busy={false}
        failure={null}
        notice={null}
        onReassign={() => undefined}
      />,
    );
    expect(html).toContain('没有未派出的线索');
  });

  it('失败文案与状态文案', () => {
    expect(poolReassignFailureText(403, { reason: 'permission-denied' })).toContain('没有权限');
    expect(poolReassignFailureText(400, { result: 'non-compliant', rules: ['missing-reassign-reason'] })).toContain('理由');
    expect(poolReassignFailureText(409, { result: 'invalid-state', reason: 'org-unit-deactivated' })).toContain('已停用');
    expect(poolReassignFailureText(409, { result: 'concurrent-change', reason: 'concurrent-change' })).toContain('刷新');
    expect(poolStatusLabel('held')).toBe('不派');
  });
});
