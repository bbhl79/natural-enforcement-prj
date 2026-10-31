// 分派决定与两步分派的前端测试（#214；规格 B/D 节、交互锁）。
// 测的是可见行为：命中按对方线索分组、「占本线索 x.x%／占对方 y.y%」保留 1 位小数且
// 达标一方加粗、默认不派／已知晓／举报必派的按钮口径、辖区建议与空建议提示、
// 工作台三环节步骤条带线索上下文续办不丢线索。

import { configureStore } from '@reduxjs/toolkit';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import reducer from '../login/loginSlice';
import { renderRoute } from '../test-utils';
import {
  AssignOrgPanel,
  AssignPeoplePanel,
  ClueDispatchBody,
  DecidePanel,
  HitGroups,
  SuggestionList,
  TransferPanel,
} from './ClueDispatchPanel';
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
    mayTransfer: false,
    mayRecordOther: false,
    designation: null,
    mayRequestDesignation: false,
    mayReviewDesignation: false,
    designationLocked: false,
    typeCodes: [],
    hasCaseByCasePlanningType: false,
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

describe('监督身份分派只读', () => {
  const noop = () => undefined;
  const body = (overrides: Partial<DispatchView> = {}) =>
    renderToStaticMarkup(
      <ClueDispatchBody
        view={view({
          status: 'in_pool',
          mayDecide: false,
          mayAssignOrg: false,
          mayTransfer: false,
    mayRecordOther: false,
          mayRequestDesignation: false,
          ...overrides,
        })}
        orgOptions={[{ orgUnitId: 'org-a', name: '甲所' }]}
        busy={false}
        failure={null}
        onDecide={noop}
        onAssignOrg={noop}
        onAssignPeople={noop}
        onTransfer={noop}
        onDesignateRequest={noop}
        onDesignateReject={noop}
        supervisorReadonly
      />,
    );

  it('待分派面板仍展示，派机构、报请与移送全部禁用并说明原因', () => {
    const html = body();
    expect(html).toContain('data-role="assign-readonly"');
    expect(html).toContain('监督身份只读，不可分派');
    expect(html).toContain('data-role="assign-org-panel"');
    expect(html).toContain('data-role="transfer-panel"');
    expect(html).toContain('data-role="designate-request-panel"');
    expect(html).toMatch(/data-role="assign-org"[^>]*disabled|disabled[^>]*data-role="assign-org"/);
    expect(html).toMatch(/data-role="transfer-submit"[^>]*disabled|disabled[^>]*data-role="transfer-submit"/);
    expect(html).toMatch(/data-role="designate-request"[^>]*disabled|disabled[^>]*data-role="designate-request"/);
    expect(html).not.toContain('待分派池的线索由本机构内勤派出');
  });

  it('待分派决定的派与不派一并禁用', () => {
    const html = body({ status: 'pending_decision', mayDecide: false });
    expect(html).toContain('data-role="decide-panel"');
    expect(html).toMatch(/data-role="decide-hold"[^>]*disabled|disabled[^>]*data-role="decide-hold"/);
    expect(html).toMatch(/data-role="decide-dispatch"[^>]*disabled|disabled[^>]*data-role="decide-dispatch"/);
    expect(html).toContain('监督身份只读，不可分派');
    // 决定步不在服务端报请／移送状态里。
    expect(html).not.toContain('data-role="designate-request-panel"');
    expect(html).not.toContain('data-role="transfer-panel"');
  });

  it('已派机构与已派承办人仍展示报请和移送，写控件禁用', () => {
    const assignment = { orgUnitId: 'o1', orgName: '天河区分局', kind: 'initial', designate: false };
    const disabled = (html: string, attr: string) => {
      const tag = html.match(new RegExp(`<[^>]*${attr}[^>]*>`))?.[0] ?? '';
      expect(tag).toContain('disabled');
    };
    for (const status of ['org_assigned', 'handler_assigned'] as const) {
      const html = body({ status, assignment });
      expect(html).toContain('data-role="assign-readonly"');
      expect(html).toContain('监督身份只读，不可分派');
      expect(html).toContain('data-role="designate-request-panel"');
      expect(html).toContain('data-role="transfer-panel"');
      disabled(html, 'id="designate-reason"');
      disabled(html, 'id="designate-proposed"');
      disabled(html, 'data-role="designate-request"');
      disabled(html, 'id="transfer-org"');
      disabled(html, 'id="transfer-doc-no"');
      disabled(html, 'id="transfer-letter-date"');
      disabled(html, 'id="transfer-reason"');
      disabled(html, 'data-role="transfer-attachments"');
      disabled(html, 'data-role="transfer-submit"');
    }
  });

  it('已有进行中的报请时不展示报请入口，移送面板仍只读可见', () => {
    const html = body({
      status: 'org_assigned',
      assignment: { orgUnitId: 'o1', orgName: '天河区分局', kind: 'initial', designate: false },
      designation: {
        requestId: 'r1',
        requestingOrgId: 'org-a',
        requestingOrgName: '第一执法支队',
        proposedOrgId: null,
        proposedOrgName: null,
        reviewerOrgId: 'org-hq',
        reviewerOrgName: '自然执法总队',
        reason: '该地不属本级管辖',
        createdAt: '2026-10-25T01:00:00.000Z',
      },
    });
    expect(html).not.toContain('data-role="designate-request-panel"');
    expect(html).toContain('data-role="designate-review-panel"');
    expect(html).toContain('data-role="transfer-panel"');
    expect(html).toMatch(/data-role="transfer-submit"[^>]*disabled|disabled[^>]*data-role="transfer-submit"/);
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

  it('已分派后重新分派不提供改机构：只剩当前承办机构，并引导报请指定管辖（#228）', () => {
    const assignment = { orgUnitId: 'o1', orgName: '天河区分局', kind: 'initial', designate: false };
    const html = renderToStaticMarkup(
      <AssignOrgPanel
        view={view({ status: 'org_assigned', assignment, mayReassignOrg: true })}
        orgOptions={[
          { orgUnitId: 'o1', name: '天河区分局' },
          { orgUnitId: 'o2', name: '越秀区分局' },
        ]}
        reassigning
        busy={false}
        failure={null}
        onAssign={() => undefined}
      />,
    );
    expect(html).not.toContain('越秀区分局');
    expect(html).toContain('天河区分局');
    expect(html).toContain('data-role="reassign-designation-guide"');
    expect(html).toContain('报请指定管辖');
    expect(html).toMatch(/id="dispatch-org"[^>]*disabled|disabled[^>]*id="dispatch-org"/);

    // 受理报请时默认勾选指定管辖：可选其他机构。
    const reviewing = renderToStaticMarkup(
      <AssignOrgPanel
        view={view({ status: 'org_assigned', assignment })}
        orgOptions={[
          { orgUnitId: 'o1', name: '天河区分局' },
          { orgUnitId: 'o2', name: '越秀区分局' },
        ]}
        reassigning
        busy={false}
        failure={null}
        onAssign={() => undefined}
        designateByDefault
      />,
    );
    expect(reviewing).toContain('越秀区分局');
    expect(reviewing).not.toContain('reassign-designation-guide');
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

describe('工作台登记分区（#214 续办）', () => {
  it('ws-existing-context：step3 带线索上下文打开，分派办理容器已挂载', async () => {
    serve({
      '/api/clues/clue-1/dispatch': [200, JSON.parse(JSON.stringify(view()))],
      '/api/org-units': TREE,
    });
    const { html } = await renderRoute(fresh(), '/workbench?step=3&clue=clue-1');
    // 静态渲染不执行 useEffect：分派办理容器已挂载（取数中）。
    expect(html).toContain('aria-busy="true"');
    // 登记分区不渲染开单前步骤条。
    expect(html).not.toContain('aria-label="线索办理步骤"');
  });

  it('step3 不带线索：提示打开线索，可回到登记新线索', async () => {
    serve({});
    const { html } = await renderRoute(fresh(), '/workbench?step=3');
    expect(html).toContain('打开一条线索后开始分派决定');
    expect(html).toContain('/workbench/register?step=1');
  });

  it('step2 带线索：续办内业核查的容器已挂载，不开单前步骤条', async () => {
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
    expect(html).not.toContain('aria-label="线索办理步骤"');
  });
});

describe('移送（自然资源部门以外机关）', () => {
  it('移送面板：标签用「移送（自然资源部门以外机关）」、必填项与选填附件、发函日期默认北京当日提示', () => {
    const html = renderToStaticMarkup(<TransferPanel busy={false} failure={null} onTransfer={() => undefined} />);
    expect(html).toContain('移送（自然资源部门以外机关）');
    expect(html).not.toContain('系统内移送');
    expect(html).toContain('移送机关');
    expect(html).toContain('文书编号');
    expect(html).toContain('发函日期');
    expect(html).toContain('留空默认北京当日');
    expect(html).toContain('原因');
    expect(html).toContain('data-role="transfer-attachments"');
    expect(html).toContain('multiple');
    expect(html).toContain('选填 0..n 件');
    // 必填未填：登记按钮禁用。
    expect(html).toMatch(/data-role="transfer-submit"[^>]*disabled/);
  });

  it('办理面板：有移送权限时在待分派池、已派机构、已派承办人都出现移送；无权限不出现', () => {
    const render = (overrides: Partial<DispatchView>) =>
      renderToStaticMarkup(
        <ClueDispatchBody
          view={view(overrides)}
          orgOptions={[]}
          busy={false}
          failure={null}
          onDecide={() => undefined}
          onAssignOrg={() => undefined}
          onAssignPeople={() => undefined}
          onTransfer={() => undefined}
          onDesignateRequest={() => undefined}
          onDesignateReject={() => undefined}
        />,
      );
    const assignment = { orgUnitId: 'o1', orgName: '天河区分局', kind: 'initial', designate: false };
    expect(render({ status: 'in_pool', mayDecide: false, mayAssignOrg: true, mayTransfer: true })).toContain(
      'data-role="transfer-panel"',
    );
    expect(
      render({ status: 'org_assigned', mayDecide: false, assignment, mayTransfer: true }),
    ).toContain('data-role="transfer-panel"');
    expect(
      render({ status: 'handler_assigned', mayDecide: false, assignment, mayTransfer: true }),
    ).toContain('data-role="transfer-panel"');
    expect(render({ status: 'in_pool', mayDecide: false, mayAssignOrg: true, mayTransfer: false })).not.toContain(
      'data-role="transfer-panel"',
    );
  });

  it('失败文案：必填缺失、发函日期、附件、报请期间的锁', () => {
    expect(dispatchFailureText({ result: 'non-compliant', rules: ['missing-disposition-fields'] })).toContain('必填');
    expect(dispatchFailureText({ result: 'non-compliant', rules: ['invalid-letter-date'] })).toContain('发函日期');
    expect(dispatchFailureText({ result: 'non-compliant', rules: ['attachment-content-mismatch'] })).toContain('附件');
    expect(dispatchFailureText({ result: 'invalid-state', reason: 'designation-pending' })).toContain('报请');
  });

  it('已移送状态标签', () => {
    expect(dispatchStatusLabel('transferred_out')).toBe('已移送');
  });
});

describe('报请指定管辖与指定锁', () => {
  const designation = {
    requestId: 'r1',
    requestingOrgId: 'org-a',
    requestingOrgName: '第一执法支队',
    proposedOrgId: 'org-b',
    proposedOrgName: '第二执法支队',
    reviewerOrgId: 'org-hq',
    reviewerOrgName: '自然执法总队',
    reason: '该地不属本级管辖',
    createdAt: '2026-10-25T01:00:00.000Z',
  };
  const noop = () => undefined;
  const body = (overrides: Partial<DispatchView>) =>
    renderToStaticMarkup(
      <ClueDispatchBody
        view={view({ status: 'in_pool', mayDecide: false, ...overrides })}
        orgOptions={[{ orgUnitId: 'org-b', name: '第二执法支队' }]}
        busy={false}
        failure={null}
        onDecide={noop}
        onAssignOrg={noop}
        onAssignPeople={noop}
        onTransfer={noop}
        onDesignateRequest={noop}
        onDesignateReject={noop}
      />,
    );

  it('本级内勤可见报请入口：理由必填、拟归属机构选填', () => {
    const html = body({ mayRequestDesignation: true });
    expect(html).toContain('designate-request-panel');
    expect(html).toContain('报请理由');
    expect(html).toContain('拟归属机构');
  });

  it('受理人看到报请事项与驳回入口', () => {
    const html = body({ designation, mayReviewDesignation: true });
    expect(html).toContain('designate-review-panel');
    expect(html).toContain('designate-reject');
    expect(html).toContain('该地不属本级管辖');
  });

  it('被报请锁拦下的下级看到锁提示，没有驳回入口', () => {
    const html = body({ designation, designationLocked: true });
    expect(html).toContain('designation-lock');
    expect(html).toContain('报请期间不能分派、重新分派或移送');
    expect(html).not.toContain('designate-reject"');
  });

  it('指定锁的失败文案', () => {
    expect(dispatchFailureText({ result: 'invalid-state', reason: 'designation-pending' })).toContain('报请指定管辖');
    expect(dispatchFailureText({ result: 'invalid-state', reason: 'designated-lock' })).toContain('已指定管辖');
    expect(
      dispatchFailureText({ result: 'invalid-state', reason: 'designation-required', nextAction: 'clue.designate.request' }),
    ).toContain('报请指定管辖');
    expect(dispatchFailureText({ result: 'non-compliant', rules: ['missing-reject-reason'] })).toContain('驳回');
  });
});

describe('个案判断规划类主体冲突待定（#207 P7）', () => {
  it('存在个案判断项时显示主体冲突待定横幅与方向选择、依据必填', () => {
    const html = renderToStaticMarkup(
      <DecidePanel
        view={view({ hasCaseByCasePlanningType: true, typeCodes: ['planning_build_without_permit'] })}
        busy={false}
        failure={null}
        onDecide={() => undefined}
      />,
    );
    expect(html).toContain('主体冲突待定');
    expect(html).toContain('本系统办理');
    expect(html).toContain('移送系统外');
    expect(html).toContain('data-role="conflict-basis"');
    expect(html).toContain('依据（必填）');
    // 未选方向未填依据：派出按钮禁用。
    expect(html).toMatch(/data-role="decide-dispatch"[^>]*disabled/);
  });

  it('举报必派时不出现主体冲突待定选项（举报只能派、不走个案判断出口）', () => {
    const html = renderToStaticMarkup(
      <DecidePanel
        view={view({ complaint: true, hasCaseByCasePlanningType: true, typeCodes: ['planning_build_without_permit'] })}
        busy={false}
        failure={null}
        onDecide={() => undefined}
      />,
    );
    expect(html).not.toContain('主体冲突待定');
    expect(html).not.toContain('本系统办理');
    expect(html).not.toContain('移送系统外');
  });

  it('无个案判断项不出现主体冲突待定UI', () => {
    const html = renderToStaticMarkup(
      <DecidePanel view={view()} busy={false} failure={null} onDecide={() => undefined} />,
    );
    expect(html).not.toContain('主体冲突待定');
  });

  it('缺失冲突解决参数的失败文案', () => {
    expect(dispatchFailureText({ result: 'non-compliant', rules: ['missing-conflict-resolution'] })).toContain('主体冲突待定');
    expect(dispatchFailureText({ result: 'non-compliant', rules: ['missing-conflict-resolution'] })).toContain('办理方向');
    expect(dispatchFailureText({ result: 'non-compliant', rules: ['missing-conflict-basis'] })).toContain('依据');
  });
});


describe('其他处置（#229）', () => {
  const assignment = {
    orgUnitId: 'o1',
    orgName: '甲',
    kind: 'assign',
    designate: false,
  };

  it('有 mayRecordOther 时在已派承办人展示其他面板', () => {
    const html = renderToStaticMarkup(
      <ClueDispatchBody
        view={view({ status: 'handler_assigned', mayDecide: false, mayRecordOther: true, assignment })}
        orgOptions={[]}
        busy={false}
        failure={null}
        onDecide={() => undefined}
        onAssignOrg={() => undefined}
        onAssignPeople={() => undefined}
        onTransfer={() => undefined}
        onDesignateRequest={() => undefined}
        onDesignateReject={() => undefined}
      />,
    );
    expect(html).toContain('其他（行政处理事项，系统外办理）');
    expect(html).toContain('登记其他');
  });

  it('无 mayRecordOther 不展示其他面板', () => {
    const html = renderToStaticMarkup(
      <ClueDispatchBody
        view={view({ status: 'handler_assigned', mayDecide: false, mayRecordOther: false, assignment })}
        orgOptions={[]}
        busy={false}
        failure={null}
        onDecide={() => undefined}
        onAssignOrg={() => undefined}
        onAssignPeople={() => undefined}
        onTransfer={() => undefined}
        onDesignateRequest={() => undefined}
        onDesignateReject={() => undefined}
      />,
    );
    expect(html).not.toContain('data-role="other-disposition-panel"');
  });
});
