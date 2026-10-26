// 分派决定的领域规则单测（#214；规格 B/D 节）。
// 默认不派／已知晓／举报必派、未结案命中口径，以及街道镇边界查询端口的契约校验。
import { describe, expect, it } from 'vitest';

import {
  CLUE_DISPATCH_RULE_CODES,
  DECIDE_FROM_STATUS,
  ORG_ASSIGN_FROM_STATUSES,
  PEOPLE_ASSIGN_FROM_STATUS,
  STREET_UNAVAILABLE_REASONS,
  createStreetBoundaryPort,
  decideDispatch,
  isOpenHit,
  planOrgAssign,
} from '../src/clue/dispatch/index.ts';

describe('分派决定规则', () => {
  it('默认不派：非举报选「不派」进 held', () => {
    expect(
      decideDispatch({ complaint: false, openHitCount: 2, decision: 'hold', acknowledged: false }),
    ).toEqual({ ok: true, nextStatus: 'held' });
  });

  it('已知晓：存在未结案命中时须 acknowledged 才能派', () => {
    expect(
      decideDispatch({ complaint: false, openHitCount: 1, decision: 'dispatch', acknowledged: false }),
    ).toEqual({ ok: false, rule: 'ack-required' });
    expect(
      decideDispatch({ complaint: false, openHitCount: 1, decision: 'dispatch', acknowledged: true }),
    ).toEqual({ ok: true, nextStatus: 'in_pool' });
  });

  it('全部对方已结案：不用已知晓可直接派出', () => {
    expect(
      decideDispatch({ complaint: false, openHitCount: 0, decision: 'dispatch', acknowledged: false }),
    ).toEqual({ ok: true, nextStatus: 'in_pool' });
  });

  it('举报必派：群众举报只能派、不能选不派', () => {
    expect(
      decideDispatch({ complaint: true, openHitCount: 1, decision: 'hold', acknowledged: false }),
    ).toEqual({ ok: false, rule: 'complaint-must-dispatch' });
    expect(
      decideDispatch({ complaint: true, openHitCount: 1, decision: 'dispatch', acknowledged: false }),
    ).toEqual({ ok: true, nextStatus: 'in_pool' });
  });

  it('未结案口径：结案与移送退出比对，已立案仍算未结案', () => {
    expect(isOpenHit('in_pool')).toBe(true);
    expect(isOpenHit('pending_decision')).toBe(true);
    expect(isOpenHit('org_assigned')).toBe(true);
    expect(isOpenHit('handler_assigned')).toBe(true);
    expect(isOpenHit('held')).toBe(true);
    expect(isOpenHit('filed')).toBe(true);
    expect(isOpenHit('closed')).toBe(false);
    expect(isOpenHit('transferred_out')).toBe(false);
  });

  it('状态门槛与规则码封闭', () => {
    expect(DECIDE_FROM_STATUS).toBe('pending_decision');
    expect(ORG_ASSIGN_FROM_STATUSES).toEqual(['in_pool', 'org_assigned', 'handler_assigned']);
    expect(PEOPLE_ASSIGN_FROM_STATUS).toBe('org_assigned');
    expect(CLUE_DISPATCH_RULE_CODES).toContain('complaint-must-dispatch');
    expect(CLUE_DISPATCH_RULE_CODES).toContain('ack-required');
    expect(CLUE_DISPATCH_RULE_CODES).toContain('missing-reassign-reason');
  });
});

describe('派机构分流（#228：换机构一律经报请指定管辖）', () => {
  const required = { ok: false, reason: 'designation-required', nextAction: 'clue.designate.request' };

  it('待分派池首次分派照旧', () => {
    expect(planOrgAssign({ status: 'in_pool', currentOrgId: null, targetOrgId: 'o-b', designate: false })).toEqual({
      ok: true,
      kind: 'initial',
      orgUnitId: 'o-b',
    });
  });

  it('已分派、designate=false、目标是另一机构：designation-required，出路是报请', () => {
    for (const status of ['org_assigned', 'handler_assigned']) {
      expect(planOrgAssign({ status, currentOrgId: 'o-a', targetOrgId: 'o-b', designate: false })).toEqual(required);
      expect(planOrgAssign({ status, currentOrgId: null, targetOrgId: 'o-b', designate: false })).toEqual(required);
    }
  });

  it('已分派、目标等于当前承办机构：同机构重新分派', () => {
    expect(planOrgAssign({ status: 'handler_assigned', currentOrgId: 'o-a', targetOrgId: 'o-a', designate: false })).toEqual({
      ok: true,
      kind: 'reassign',
      orgUnitId: 'o-a',
    });
  });

  it('designate=true 指定管辖照旧（含上级主动指定）', () => {
    for (const status of ['in_pool', 'org_assigned', 'handler_assigned']) {
      expect(planOrgAssign({ status, currentOrgId: 'o-a', targetOrgId: 'o-b', designate: true })).toEqual({
        ok: true,
        kind: 'designate',
        orgUnitId: 'o-b',
      });
    }
  });

  it('结构断言：任何输入下 reassign 去向写入的机构都等于当前承办机构', () => {
    const orgs = [null, 'o-a', 'o-b'];
    let reassigns = 0;
    for (const status of [...ORG_ASSIGN_FROM_STATUSES, 'pending_decision', 'held']) {
      for (const currentOrgId of orgs) {
        for (const targetOrgId of ['o-a', 'o-b']) {
          for (const designate of [false, true]) {
            const plan = planOrgAssign({ status, currentOrgId, targetOrgId, designate });
            if (plan.ok && plan.kind === 'reassign') {
              reassigns += 1;
              expect(plan.orgUnitId).toBe(currentOrgId);
            }
            if (!designate && currentOrgId !== targetOrgId && (status === 'org_assigned' || status === 'handler_assigned')) {
              expect(plan).toEqual(required);
            }
          }
        }
      }
    }
    expect(reassigns).toBeGreaterThan(0);
  });
});

describe('街道镇边界查询端口', () => {
  const part = { partId: 'p1', partIndex: 0, geojson: '{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]}' };

  it('服务未配置：给原因词，不抛错', async () => {
    const port = createStreetBoundaryPort({ serviceUrl: undefined });
    const outcome = await port.query({ clueId: 'c1', kind: 'face', parts: [part] });
    expect(outcome).toEqual({ ok: false, reason: STREET_UNAVAILABLE_REASONS.notConfigured });
  });

  it('返回要素：要素标识即街道编码，逐面归组', async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          type: 'FeatureCollection',
          features: [
            {
              id: 'S-TH',
              properties: { intersection: { type: 'Polygon' }, overlap_area: 123.5 },
            },
          ],
        }),
        { status: 200 },
      )) as typeof fetch;
    const port = createStreetBoundaryPort({ serviceUrl: 'https://layers.example', fetchImpl });
    const outcome = await port.query({ clueId: 'c1', kind: 'face', parts: [part] });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.features).toHaveLength(1);
      expect(outcome.features[0]?.streetCode).toBe('S-TH');
      expect(outcome.features[0]?.partIndex).toBe(0);
      expect(outcome.features[0]?.overlapArea).toBe(123.5);
    }
  });

  it('返回不合规（缺必填项）：给原因词', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ type: 'FeatureCollection', features: [{ properties: {} }] }), {
        status: 200,
      })) as typeof fetch;
    const port = createStreetBoundaryPort({ serviceUrl: 'https://layers.example', fetchImpl });
    const outcome = await port.query({ clueId: 'c1', kind: 'point', parts: [part] });
    expect(outcome).toEqual({ ok: false, reason: STREET_UNAVAILABLE_REASONS.invalidResponse });
  });
});
