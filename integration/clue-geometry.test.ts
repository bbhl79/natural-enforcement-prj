// #212 重绘与命中集替换——接口层用例（真实 PostGIS，块 2）。
// 断言打在克隆库上：重绘整体替换命中集（零命中清空）、related-redraw 为双方完整重算
// 且不递归改状态、留痕 detail 含前后命中摘要、权限与状态限制（403／409／400 留痕＋业务行不变）。
import { describe, expect, it } from 'vitest';

import {
  cookieOf,
  hitRows,
  partGeojsons,
  polygon,
  rect,
  register,
  setStatus,
  setupClueSuite,
  suite,
  trailOf,
  deniedTrail,
} from './duplicate-helpers';

setupClueSuite();

/** 绘斑重绘。 */
interface RedrawResponseBody {
  readonly result?: string;
  readonly status?: string;
  readonly partCount?: number;
  readonly dupComputedAt?: string;
  readonly hits?: {
    readonly otherClueId: string;
    readonly otherClueCode: string;
    readonly partIndex: number;
    readonly otherPartIndex: number;
    readonly selfRatio: number;
    readonly otherRatio: number;
    readonly intersectionArea: number;
  }[];
  readonly rules?: string[];
  readonly reason?: string;
}

async function redraw(
  clueId: string,
  geojson: string,
  code = 'P-CLERK-A',
): Promise<{ status: number; body: RedrawResponseBody }> {
  const response = await fetch(`${suite.baseUrl}/api/clues/${clueId}/geometry`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await cookieOf(code) },
    body: JSON.stringify({ srid: 4326, geojson }),
  });
  return { status: response.status, body: (await response.json()) as RedrawResponseBody };
}

describe('#212 重绘与命中集替换', () => {
  it('重绘挪走：命中集整体清空、状态回待分派池、留痕 detail 含前后摘要与 related-redraw', async () => {
    const peer = await register({ spatial: polygon(rect(116.00, 23.40, 116.10, 23.50)) });
    const mine = await register({ spatial: polygon(rect(116.00, 23.40, 116.10, 23.50)) });
    expect(mine.body.status).toBe('pending_decision');
    expect(await hitRows(peer.body.id ?? '')).toHaveLength(1);

    const redrawn = await redraw(mine.body.id ?? '', polygon(rect(116.20, 23.40, 116.30, 23.50)));
    expect(redrawn.status).toBe(200);
    expect(redrawn.body.result).toBe('redrawn');
    expect(redrawn.body.status).toBe('in_pool');
    expect(redrawn.body.hits ?? []).toEqual([]);
    expect(redrawn.body.dupComputedAt).toBeTruthy();

    // 本线索命中清空；对方反向标记也在 related-redraw 里清掉。
    expect(await hitRows(mine.body.id ?? '')).toHaveLength(0);
    expect(await hitRows(peer.body.id ?? '')).toHaveLength(0);
    const row = await suite.cloned.prisma.clue.findUnique({ where: { id: mine.body.id } });
    expect(row?.status).toBe('in_pool');
    expect((await partGeojsons(mine.body.id ?? '')).length).toBeGreaterThan(0);

    const trail = await trailOf('clue.geometry-updated', mine.body.id);
    expect(trail).toHaveLength(1);
    expect(trail[0]?.outcome).toBe('succeeded');
    const detail = JSON.parse(trail[0]?.detail ?? '{}') as {
      code?: string;
      partCount?: number;
      previousStatus?: string;
      nextStatus?: string;
      trigger?: string;
      before?: { otherClueCode: string }[];
      after?: unknown[];
      relatedRedraw?: { otherClueCode: string; before: unknown[]; after: unknown[] }[];
    };
    expect(detail.code).toBe(mine.body.code);
    expect(detail.partCount).toBe(1);
    expect(detail.previousStatus).toBe('pending_decision');
    expect(detail.nextStatus).toBe('in_pool');
    expect(detail.trigger).toBe('redraw');
    expect(detail.before?.map((hit) => hit.otherClueCode)).toEqual([peer.body.code]);
    expect(detail.after).toEqual([]);
    expect(detail.relatedRedraw?.map((item) => item.otherClueCode)).toEqual([peer.body.code]);
    expect(detail.relatedRedraw?.[0]?.before).toHaveLength(1);
    expect(detail.relatedRedraw?.[0]?.after).toEqual([]);
  });

  it('重绘撞上新对方：进待分派决定，对方只加标记不改状态', async () => {
    const peer = await register({ spatial: polygon(rect(116.40, 23.40, 116.50, 23.50)) });
    const mine = await register({ spatial: polygon(rect(116.60, 23.40, 116.70, 23.50)) });
    expect(mine.body.status).toBe('in_pool');

    const redrawn = await redraw(mine.body.id ?? '', polygon(rect(116.40, 23.40, 116.50, 23.50)));
    expect(redrawn.status).toBe(200);
    expect(redrawn.body.status).toBe('pending_decision');
    expect(redrawn.body.hits ?? []).toHaveLength(1);
    expect((redrawn.body.hits ?? [])[0]?.otherClueCode).toBe(peer.body.code);

    const reverse = await hitRows(peer.body.id ?? '');
    expect(reverse).toHaveLength(1);
    const row = await suite.cloned.prisma.clue.findUnique({ where: { id: peer.body.id } });
    expect(row?.status).toBe('in_pool');
  });

  it('对方在待分派决定不因命中消失自动解除（related-redraw 不递归改状态）', async () => {
    const moving = await register({ spatial: polygon(rect(116.80, 23.40, 116.90, 23.50)) });
    const steady = await register({ spatial: polygon(rect(116.80, 23.40, 116.90, 23.50)) });
    expect(steady.body.status).toBe('pending_decision');

    const redrawn = await redraw(moving.body.id ?? '', polygon(rect(117.00, 23.40, 117.10, 23.50)));
    expect(redrawn.status).toBe(200);
    expect(await hitRows(steady.body.id ?? '')).toHaveLength(0);
    const row = await suite.cloned.prisma.clue.findUnique({ where: { id: steady.body.id } });
    expect(row?.status).toBe('pending_decision');
  });

  it('非录入人重绘：403，authz.denied 留痕存在，几何部件不变', async () => {
    const mine = await register({ spatial: polygon(rect(117.20, 23.40, 117.30, 23.50)) });
    const before = await partGeojsons(mine.body.id ?? '');
    const denied = await redraw(
      mine.body.id ?? '',
      polygon(rect(117.40, 23.40, 117.50, 23.50)),
      'P-CLERK-B',
    );
    expect(denied.status).toBe(403);
    expect(await deniedTrail(mine.body.id ?? '')).toHaveLength(1);
    expect(await partGeojsons(mine.body.id ?? '')).toEqual(before);
    expect(await hitRows(mine.body.id ?? '')).toHaveLength(0);
  });

  it('不在待分派决定／待分派池：409 invalid-state，失败留痕，几何部件不变', async () => {
    const mine = await register({ spatial: polygon(rect(117.60, 23.40, 117.70, 23.50)) });
    await setStatus(mine.body.id ?? '', 'org_assigned');
    const before = await partGeojsons(mine.body.id ?? '');
    const redrawn = await redraw(mine.body.id ?? '', polygon(rect(117.80, 23.40, 117.90, 23.50)));
    expect(redrawn.status).toBe(409);
    expect(redrawn.body.result).toBe('invalid-state');
    const failed = await trailOf('clue.geometry-updated', mine.body.id);
    expect(failed.filter((row) => row.outcome === 'failed')).toHaveLength(1);
    expect(failed[0]?.reason).toBe('invalid-state');
    expect(await partGeojsons(mine.body.id ?? '')).toEqual(before);
  });

  it('已派机构：409 invalid-state，失败留痕，几何部件不变', async () => {
    const mine = await register({ spatial: polygon(rect(118.00, 23.40, 118.10, 23.50)) });
    const deptA = await suite.cloned.prisma.orgUnit.findFirst({ where: { code: 'ORG-DEPT-A' } });
    await suite.cloned.prisma.clueAssignment.create({
      data: {
        id: `assign-${mine.body.id}`,
        clueId: mine.body.id ?? '',
        orgUnitId: deptA?.id ?? '',
        kind: 'initial',
        assignedBy: 'P-CLERK-A',
      },
    });
    const redrawn = await redraw(mine.body.id ?? '', polygon(rect(118.20, 23.40, 118.30, 23.50)));
    expect(redrawn.status).toBe(409);
    expect((await trailOf('clue.geometry-updated', mine.body.id)).filter((row) => row.outcome === 'failed'))
      .toHaveLength(1);
    expect((await partGeojsons(mine.body.id ?? '')).length).toBe(1);
  });

  it('活动核查：409 invalid-state，失败留痕，几何部件不变', async () => {
    const mine = await register({ spatial: polygon(rect(118.40, 23.40, 118.50, 23.50)) });
    await suite.cloned.prisma.clue.update({
      where: { id: mine.body.id },
      data: { verificationStatus: 'running' },
    });
    const redrawn = await redraw(mine.body.id ?? '', polygon(rect(118.60, 23.40, 118.70, 23.50)));
    expect(redrawn.status).toBe(409);
    expect((await trailOf('clue.geometry-updated', mine.body.id)).filter((row) => row.outcome === 'failed'))
      .toHaveLength(1);
  });

  it('几何不合规：400 non-compliant，失败留痕 invalid-geometry，几何部件不变', async () => {
    const mine = await register({ spatial: polygon(rect(118.80, 23.40, 118.90, 23.50)) });
    const before = await partGeojsons(mine.body.id ?? '');
    const redrawn = await redraw(
      mine.body.id ?? '',
      JSON.stringify({ type: 'Point', coordinates: [118.85, 23.45] }),
    );
    expect(redrawn.status).toBe(400);
    expect(redrawn.body.result).toBe('non-compliant');
    expect(redrawn.body.rules ?? []).toContain('spatial-geometry-type-rejected');
    const failed = await trailOf('clue.geometry-updated', mine.body.id);
    expect(failed.filter((row) => row.outcome === 'failed')).toHaveLength(1);
    expect(failed[0]?.reason).toBe('invalid-geometry');
    expect(await partGeojsons(mine.body.id ?? '')).toEqual(before);
  });
});
