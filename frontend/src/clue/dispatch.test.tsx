// 分派决定与两步分派的前端测试（#214；规格 B/D 节、交互锁）。
// 测的是可见行为：命中按对方线索分组、「占本线索 x.x%／占对方 y.y%」保留 1 位小数且
// 达标一方加粗、默认不派／已知晓／举报必派的按钮口径、辖区建议与空建议提示、
// 工作台三环节步骤条带线索上下文续办不丢线索。

import { configureStore } from '@reduxjs/toolkit';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import reducer from '../login/loginSlice';
import { renderRoute } from '../test-utils';
import { AssignOrgPanel, AssignPeoplePanel, DecidePanel, HitGroups, SuggestionList } from './ClueDispatchPanel';
import { dispatchFailureText } from './ClueDispatchSection';
import {
  dispatchStatusLabel,
  hitQualified,
  hitRatioText,
  muText,
  type DispatchView,
  type SuggestionView,
} from './dispatch';

function suggestion(overrides: Partial<SuggestionView> = {}): SuggestionView {
  return {
    result: 'listed',
    clueId: 'clue-1',
    code: 'CL0000000002',
    kind: 'face',
    suggestions: [],
    crossDistrict: false,
    hint: null,
    unavailableReason: 'service-not-configured',
    ...overrides,
  };
}

function view(overrides: Partial<DispatchView> = {}): DispatchView {
  return {
    result: 'dispatch-view',
    clueId: 'clue-1',
    code: 'CL0000000002',
    status: 'pending_decision',
    domain: 'land',
    sourceCode: '16',
    sourceName: '日常巡查',
    complaint: false,
    dupComputedAt: '2026-10-25T01:00:00.000Z',
    hitGroups: [
      {
        otherClueId: 'clue-0',
        otherClueCode: 'CL0000000001',
        otherStatus: 'in_pool',
        open: true,
        pairs: [
          { partId: 'p1', partIndex: 0, otherPartId: 'op1', selfRatio: 0.7, otherRatio: 0.2, intersectionArea: 5000 },
          { partId: 'p2', partIndex: 1, otherPartId: 'op2', selfRatio: 0.3, otherRatio: 0.65, intersectionArea: 3000 },
        ],
      },
    ],
    assignment: null,
    handlers: [],
    candidates: [
      { personnelId: 'p-h1', code: 'P01', name: '承办甲' },
      { personnelId: 'p-h2', code: 'P02', name: '承办乙' },
    ],
    suggestion: suggestion(),
    mayDecide: true,
    mayAssignOrg: false,
    mayReassignOrg: false,
    mayAssignPeople: false,
    ...overrides,
  };
}

describe('分派决定步（step3）', () => {
  it('命中按对方线索分组：1 位小数、达标一方加粗、可打开对比', () => {
    const html = renderToStaticMarkup(<HitGroups view={view()} />);
    expect(html).toContain('与 CL0000000001 重复');
    expect(html).toContain('对方未结案');
    // 本线索第 1 面：占本线索 70.0% 达标加粗，占对方 20.0% 不加粗。
    expect(html).toContain('<b class="hit-strong">70.0%</b>');
    expect(html).toContain('20.0%');
    // 本线索第 2 面：占对方 65.0% 达标加粗，占本线索 30.0% 不加粗。
    expect(html).toContain('<b class="hit-strong">65.0%</b>');
    expect(html.match(/hit-strong/g)?.length).toBe(2);
    expect(html).toContain('对比');
    // 亩换算：5000 平方米 = 7.5 亩。
    expect(html).toContain('7.5 亩');
  });

  it('默认不派：存在未结案命中给「不派」与「已知晓并派出」', () => {
    const html = renderToStaticMarkup(
      <DecidePanel view={view()} busy={false} failure={null} onDecide={() => undefined} />,
    );
    expect(html).toContain('decide-hold');
    expect(html).toContain('已知晓并派出');
    expect(html).toContain('默认不派');
  });

  it('举报必派：只能派、不能选不派，重合信息仍展示', () => {
    const html = renderToStaticMarkup(
      <DecidePanel view={view({ complaint: true })} busy={false} failure={null} onDecide={() => undefined} />,
    );
    expect(html).not.toContain('decide-hold');
    expect(html).toContain('decide-dispatch');
    expect(html).toContain('只能派、不能选不派');
    expect(html).toContain('CL0000000001');
  });

  it('全部对方已结案：可直接派出，但仍由人完成决定', () => {
    const html = renderToStaticMarkup(
      <DecidePanel
        view={view({
          hitGroups: view().hitGroups.map((group) => ({ ...group, open: false, otherStatus: 'closed' })),
        })}
        busy={false}
        failure={null}
        onDecide={() => undefined}
      />,
    );
    expect(html).toContain('全部对方已结案，可直接派出');
    expect(html).not.toContain('已知晓并派出');
    expect(html).toContain('decide-dispatch');
  });
});

describe('辖区建议（不自动派）', () => {
  it('全部候选按占比降序、街道明细与跨区提示', () => {
    const html = renderToStaticMarkup(
      <SuggestionList
        view={view({
          suggestion: suggestion({
            unavailableReason: null,
            crossDistrict: true,
            hint: '线索跨区：可由各区按街道分割重传，或择一机构办理。',
            suggestions: [
              {
                orgUnitId: 'org-a',
                orgName: '甲所',
                area: 8000,
                ratio: 0.8,
                streets: [
                  {
                    streetCode: 'S-TH',
                    streetName: '天河街道',
                    area: 8000,
                    faces: [
                      { partIndex: 0, area: 6000 },
                      { partIndex: 1, area: 2000 },
                    ],
                  },
                ],
              },
              {
                orgUnitId: 'org-b',
                orgName: '乙区',
                area: 2000,
                ratio: 0.2,
                streets: [{ streetCode: 'S-YB', streetName: '乙区街道', area: 2000, faces: [] }],
              },
            ],
          }),
        })}
      />,
    );
    expect(html).toContain('甲所');
    expect(html).toContain('80.0%');
    expect(html).toContain('乙区');
    expect(html).toContain('20.0%');
    // 街道明细：逐面归组（6000 平方米 = 9.0 亩，2000 平方米 = 3.0 亩）。
    expect(html).toContain('天河街道');
    expect(html).toContain('第 1 面 9.0 亩');
    expect(html).toContain('第 2 面 3.0 亩');
    expect(html).toContain('分割重传');
  });

  it('服务不可用：空建议提示，不拦手工分派', () => {
    const html = renderToStaticMarkup(<SuggestionList view={view()} />);
    expect(html).toContain('暂无辖区建议');
    expect(html).toContain('可手工选择机构分派');
  });
});

describe('两步分派面板', () => {
  it('首次派机构不渲染理由输入；重新分派渲染理由必填输入', () => {
    const initial = renderToStaticMarkup(
      <AssignOrgPanel
        view={view({
          status: 'in_pool',
          mayAssignOrg: true,
          suggestion: suggestion({
            unavailableReason: null,
            suggestions: [
              {
                orgUnitId: 'org-a',
                orgName: '甲所',
                area: 8000,
                ratio: 0.8,
                streets: [],
              },
            ],
          }),
        })}
        orgOptions={[
          { orgUnitId: 'org-a', name: '甲所' },
          { orgUnitId: 'org-b', name: '乙区' },
        ]}
        reassigning={false}
        busy={false}
        failure={null}
        onAssign={() => undefined}
      />,
    );
    expect(initial).not.toContain('id="dispatch-reason"');
    expect(initial).toContain('甲所（辖区建议）');

    const reassign = renderToStaticMarkup(
      <AssignOrgPanel
        view={view({ status: 'org_assigned' })}
        orgOptions={[{ orgUnitId: 'org-b', name: '乙区' }]}
        reassigning
        busy={false}
        failure={null}
        onAssign={() => undefined}
      />,
    );
    expect(reassign).toContain('id="dispatch-reason"');
    expect(reassign).toContain('重新分派');
  });

  it('派主办／协办：主办必选、协办多选，候选不含已选主办', () => {
    const html = renderToStaticMarkup(
      <AssignPeoplePanel view={view()} busy={false} failure={null} onAssign={() => undefined} />,
    );
    expect(html).toContain('dispatch-main');
    expect(html).toContain('承办甲');
    expect(html).toContain('承办乙');
    expect(html).toContain('assign-people');
  });
});

describe('分派办理的纯函数', () => {
  it('比例文本保留 1 位小数，达标线 60%', () => {
    expect(hitRatioText(0.7)).toBe('70.0%');
    expect(hitRatioText(0.234)).toBe('23.4%');
    expect(hitQualified(0.6)).toBe(true);
    expect(hitQualified(0.5999)).toBe(false);
  });

  it('亩换算：1 亩 = 2000/3 平方米', () => {
    expect(muText(5000)).toBe('7.5 亩');
    expect(muText(2000 / 3)).toBe('1.0 亩');
  });

  it('状态标签用 GLOSSARY 词', () => {
    expect(dispatchStatusLabel('pending_decision')).toBe('待分派决定');
    expect(dispatchStatusLabel('in_pool')).toBe('待分派');
    expect(dispatchStatusLabel('org_assigned')).toBe('已派机构');
    expect(dispatchStatusLabel('handler_assigned')).toBe('已派承办人');
    expect(dispatchStatusLabel('held')).toBe('不派');
  });

  it('失败原因各有说法', () => {
    expect(dispatchFailureText({ result: 'non-compliant', rules: ['ack-required'] })).toContain('已知晓');
    expect(dispatchFailureText({ result: 'non-compliant', rules: ['complaint-must-dispatch'] })).toContain('只能派');
    expect(dispatchFailureText({ result: 'non-compliant', rules: ['missing-reassign-reason'] })).toContain('理由');
    expect(dispatchFailureText({ result: 'concurrent-change' })).toContain('已被他人变更');
    expect(dispatchFailureText({ result: 'invalid-state', reason: 'designated-lock' })).toContain('指定管辖');
  });
});

type Json = Record<string, unknown>;

const INTAKE = ['clue.read', 'org.tree.read', 'clue.org.assign', 'clue.handler.assign', 'clue.dispatch.decide'];

const TREE: [number, Json] = [200, { result: 'listed', rootId: 'hq', orgUnits: [{ id: 'hq', name: '总队' }] }];

function serve(routes: Record<string, [number, Json]>) {
  vi.stubGlobal('fetch', (url: string) => {
    if (url === '/api/auth/session') {
      return Promise.resolve(
        new Response(
          JSON.stringify({ result: 'authenticated', name: '何静', code: 'TH0102', orgName: '天河区分局', roles: ['内勤'], opcodes: INTAKE }),
          { status: 200 },
        ),
      );
    }
    const [status, body] = routes[url] ?? [404, {}];
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  });
}

const fresh = () => configureStore({ reducer: { login: reducer } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('工作台三环节步骤条（#214）', () => {
  it('ws-existing-context：step3 带线索上下文打开，环节切换不丢线索', async () => {
    serve({
      '/api/clues/clue-1/dispatch': [200, view()],
      '/api/org-units': TREE,
    });
    const { html } = await renderRoute(fresh(), '/workbench?step=3&clue=clue-1');
    // 静态渲染不执行 useEffect：分派办理容器已挂载（取数中），步骤条完整。
    expect(html).toContain('aria-busy="true"');
    // 环节切换保留线索上下文（HTML 属性里 & 转义为 &amp;）。
    expect(html).toContain('step=1&amp;clue=clue-1');
    expect(html).toContain('step=2&amp;clue=clue-1');
  });

  it('step3 不带线索：提示打开线索，不丢步骤条', async () => {
    serve({});
    const { html } = await renderRoute(fresh(), '/workbench?step=3');
    expect(html).toContain('打开一条线索后开始分派决定');
    expect(html).toContain('/workbench?step=1');
  });

  it('step2 带线索：续办内业核查的容器已挂载，环节切换不丢线索', async () => {
    serve({
      '/api/clues/clue-1/verification': [
        200,
        {
          result: 'listed',
          clueId: 'clue-1',
          code: 'CL0000000002',
          domain: 'land',
          required: true,
          verificationStatus: 'failed',
          verificationStatusLabel: '没跑成',
          clueStatus: 'pending_decision',
          canRetry: true,
          retryBlockedReason: null,
          current: null,
          runs: [],
          artifacts: null,
        },
      ],
    });
    const { html } = await renderRoute(fresh(), '/workbench?step=2&clue=clue-1');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('step=3&amp;clue=clue-1');
  });
});
