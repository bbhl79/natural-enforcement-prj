// seam⑥（spec #322 Q16）：出处纪律校验纯函数。
// 每条应然节点须带法规出处（法规标识 + 条款号）与角色依据；缺任一 → 待权威，只产决策票草案，
// 不进实现方向。本文件直接 import source-check.ts，不连库、不读写文件。
import { describe, expect, it } from 'vitest';

import {
  admittedNodeIds,
  checkNodeSources,
  type AssertedNode,
} from '../e2e/verify/harness/discover/source-check.ts';

const FULL_NODE: AssertedNode = {
  nodeId: 'filing',
  legalBasis: [
    { documentCode: 'doc_002', articleNo: '2.5' },
    { documentCode: 'doc_061', articleNo: '第 6 条' },
  ],
  roleBasis: ['经办', '行政审核', '行政审批'],
};

// spec #322 Q16 seam⑥：缺法规出处或角色依据的节点标待权威，只产决策票。
describe('seam⑥：出处纪律校验（无出处标待权威、只产决策票）', () => {
  it('法规出处与角色依据齐备 → ok，不产决策票', () => {
    const [result] = checkNodeSources([FULL_NODE]);

    expect(result).toEqual({
      nodeId: 'filing',
      verdict: 'ok',
      reason: expect.stringContaining('法规出处'),
      decisionTicket: null,
    });
  });

  it('无法规出处 → 待权威，reason 指明缺法规出处，决策票草案带 needs-triage', () => {
    const [result] = checkNodeSources([{ ...FULL_NODE, legalBasis: [] }]);

    expect(result.verdict).toBe('pending-authority');
    expect(result.reason).toContain('待权威');
    expect(result.reason).toContain('法规出处');
    expect(result.decisionTicket).toEqual({
      title: expect.stringContaining('filing'),
      labels: ['needs-triage'],
      body: expect.stringContaining('待权威'),
    });
  });

  it('缺角色依据 → 待权威，reason 指明缺角色依据', () => {
    const [result] = checkNodeSources([{ ...FULL_NODE, roleBasis: [] }]);

    expect(result.verdict).toBe('pending-authority');
    expect(result.reason).toContain('角色依据');
    expect(result.decisionTicket?.labels).toEqual(['needs-triage']);
  });

  it('法规出处缺条款号（空白串）→ 待权威，reason 指明条款号', () => {
    const [result] = checkNodeSources([
      { ...FULL_NODE, legalBasis: [{ documentCode: 'doc_002', articleNo: '  ' }] },
    ]);

    expect(result.verdict).toBe('pending-authority');
    expect(result.reason).toContain('条款号');
    expect(result.reason).toContain('第 1 条');
  });

  it('法规出处缺法规标识（文件编号与法规名都空）→ 待权威，reason 指明法规标识', () => {
    const [result] = checkNodeSources([
      { ...FULL_NODE, legalBasis: [{ documentCode: '', documentName: ' ', articleNo: '2.5' }] },
    ]);

    expect(result.verdict).toBe('pending-authority');
    expect(result.reason).toContain('法规标识');
  });

  it('只填法规名 + 条款号（无文件编号）→ ok，对齐反馈模板「法规名 + 条款号」', () => {
    const [result] = checkNodeSources([
      {
        ...FULL_NODE,
        legalBasis: [{ documentName: '自然资源行政处罚办法', articleNo: '第 6 条' }],
      },
    ]);

    expect(result.verdict).toBe('ok');
    expect(result.decisionTicket).toBeNull();
  });

  it('多条法规出处第 2 条缺条款号 → reason 指明第 2 条', () => {
    const [result] = checkNodeSources([
      {
        ...FULL_NODE,
        legalBasis: [
          { documentCode: 'doc_002', articleNo: '2.5' },
          { documentCode: 'doc_061', articleNo: '' },
        ],
      },
    ]);

    expect(result.verdict).toBe('pending-authority');
    expect(result.reason).toContain('第 2 条');
    expect(result.reason).toContain('条款号');
  });

  it('角色依据出现空白项 → 待权威，reason 指明第 2 项', () => {
    const [result] = checkNodeSources([{ ...FULL_NODE, roleBasis: ['经办', ' '] }]);

    expect(result.verdict).toBe('pending-authority');
    expect(result.reason).toContain('角色依据第 2 项');
  });

  it('法规出处与角色依据同时缺 → reason 同时列出两项', () => {
    const [result] = checkNodeSources([{ nodeId: 'collective' }]);

    expect(result.verdict).toBe('pending-authority');
    expect(result.reason).toContain('法规出处');
    expect(result.reason).toContain('角色依据');
  });

  it('混合节点：admittedNodeIds 只含出处齐备节点，待权威节点不进实现方向', () => {
    const results = checkNodeSources([
      FULL_NODE,
      { nodeId: 'collective', legalBasis: [], roleBasis: ['法制审核'] },
    ]);

    expect(results.map((result) => result.verdict)).toEqual(['ok', 'pending-authority']);
    expect(admittedNodeIds(results)).toEqual(['filing']);
  });

  it('空输入 → 空结果', () => {
    expect(checkNodeSources([])).toEqual([]);
  });
});
