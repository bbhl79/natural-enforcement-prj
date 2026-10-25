// #212 疑似重复比对——逐面计算与比对范围（真实 PostGIS，块 1＋块 3）。
// 断言打在克隆库上：逐面双向比例与 ≥60% 命中、整体合并不算、全部命中面对保存、
// 点状不做空间重合判定、filed 参与比对、closed／transferred_out 退出比对、
// 对方被撞只打标记不改状态、举报来源经决定步。
import { beforeEach, describe, expect, it } from 'vitest';

import {
  COMPLAINT_VALUES,
  hitRows,
  multipolygon,
  point,
  polygon,
  rect,
  register,
  setStatus,
  setupClueSuite,
  suite,
} from './duplicate-helpers';

setupClueSuite();

beforeEach(() => {
  suite.storage.writes.length = 0;
});

describe('#212 逐面计算', () => {
  it('双向比例：占本线索 50.0%／占对方 100.0%，任一方达标即命中，后登的进待分派决定', async () => {
    const first = await register({ spatial: polygon(rect(113.10, 23.40, 113.20, 23.50)) });
    expect(first.status).toBe(201);
    expect(first.body.status).toBe('in_pool');

    // 对方面完全落在本面西侧一半内：交集=本面×对方面＝对方面积，
    // 占本线索（后登小面）100%，占对方（先登大面）50%。
    const second = await register({ spatial: polygon(rect(113.10, 23.40, 113.15, 23.50)) });
    expect(second.status).toBe(201);
    expect(second.body.status).toBe('pending_decision');
    const hits = second.body.hits ?? [];
    expect(hits).toHaveLength(1);
    expect(hits[0]?.otherClueCode).toBe(first.body.code);
    expect(hits[0]?.selfRatio).toBeCloseTo(1, 5);
    expect(hits[0]?.otherRatio).toBeCloseTo(0.5, 1);
    expect(hits[0]?.intersectionArea).toBeGreaterThan(0);

    const rows = await hitRows(second.body.id ?? '');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.other_clue_id).toBe(first.body.id);
    // 反向行：对方视角比例对调（占本线索=50%，占对方=100%）。
    const reverse = await hitRows(first.body.id ?? '');
    expect(reverse).toHaveLength(1);
    expect(reverse[0]?.other_clue_id).toBe(second.body.id);
    expect(reverse[0]?.self_ratio).toBeCloseTo(0.5, 1);
    expect(reverse[0]?.other_ratio).toBeCloseTo(1, 5);
  });

  it('全部命中面对保存：本线索两个面分别命中同一对方，不只留最大一对', async () => {
    const other = await register({ spatial: polygon(rect(113.30, 23.40, 113.50, 23.50)) });
    expect(other.status).toBe(201);
    const mine = await register({
      spatial: multipolygon([rect(113.30, 23.40, 113.40, 23.50), rect(113.40, 23.40, 113.50, 23.50)]),
    });
    expect(mine.status).toBe(201);
    const hits = mine.body.hits ?? [];
    expect(hits).toHaveLength(2);
    expect(hits.every((hit) => hit.otherClueCode === other.body.code)).toBe(true);
    for (const hit of hits) {
      expect(hit.selfRatio).toBeCloseTo(1, 5);
      expect(hit.otherRatio).toBeCloseTo(0.5, 1);
    }
    const rows = await hitRows(mine.body.id ?? '');
    expect(rows).toHaveLength(2);
    // 对方视角也是两行。
    expect(await hitRows(other.body.id ?? '')).toHaveLength(2);
  });

  it('整体重合不算：两面各重合 50%，合并 100% 也不命中，进待分派池', async () => {
    const whole = await register({ spatial: polygon(rect(113.60, 23.40, 113.70, 23.50)) });
    expect(whole.status).toBe(201);
    const split = await register({
      spatial: multipolygon([rect(113.55, 23.40, 113.65, 23.50), rect(113.65, 23.40, 113.75, 23.50)]),
    });
    expect(split.status).toBe(201);
    expect(split.body.status).toBe('in_pool');
    expect(split.body.hits ?? []).toEqual([]);
    expect(await hitRows(split.body.id ?? '')).toHaveLength(0);
  });

  it('点状不做空间重合判定：点落在面内注册点状线索不命中；面覆盖已登记点也不命中', async () => {
    const face = await register({ spatial: polygon(rect(113.80, 23.40, 113.90, 23.50)) });
    expect(face.status).toBe(201);

    const onPoint = await register({
      domain: 'survey',
      spatial: point(113.85, 23.45),
    });
    expect(onPoint.status).toBe(201);
    expect(onPoint.body.status).toBe('in_pool');
    expect(onPoint.body.hits ?? []).toEqual([]);

    // 另起一处：先登记孤点，再登记覆盖该点的面：面与点之间不生成命中。
    const lonePoint = await register({
      domain: 'survey',
      spatial: point(115.00, 23.45),
    });
    expect(lonePoint.status).toBe(201);
    const overPoint = await register({ spatial: polygon(rect(114.99, 23.44, 115.01, 23.46)) });
    expect(overPoint.status).toBe(201);
    expect(overPoint.body.hits ?? []).toEqual([]);
    expect(await hitRows(lonePoint.body.id ?? '')).toHaveLength(0);
  });
});

describe('#212 比对范围与对方状态', () => {
  it('filed 仍算未结案，参与比对', async () => {
    const filed = await register({ spatial: polygon(rect(114.00, 23.40, 114.10, 23.50)) });
    expect(filed.status).toBe(201);
    await setStatus(filed.body.id ?? '', 'filed');
    const next = await register({ spatial: polygon(rect(114.00, 23.40, 114.10, 23.50)) });
    expect(next.body.status).toBe('pending_decision');
    expect(next.body.hits ?? []).toHaveLength(1);
    // 对方（已立案）也挂上疑似重复标记，状态不改。
    const reverse = await hitRows(filed.body.id ?? '');
    expect(reverse).toHaveLength(1);
    const row = await suite.cloned.prisma.clue.findUnique({ where: { id: filed.body.id } });
    expect(row?.status).toBe('filed');
  });

  it('closed 退出比对', async () => {
    const closed = await register({ spatial: polygon(rect(114.20, 23.40, 114.30, 23.50)) });
    await setStatus(closed.body.id ?? '', 'closed');
    const next = await register({ spatial: polygon(rect(114.20, 23.40, 114.30, 23.50)) });
    expect(next.body.status).toBe('in_pool');
    expect(next.body.hits ?? []).toEqual([]);
  });

  it('transferred_out 退出比对', async () => {
    const moved = await register({ spatial: polygon(rect(114.40, 23.40, 114.50, 23.50)) });
    await setStatus(moved.body.id ?? '', 'transferred_out');
    const next = await register({ spatial: polygon(rect(114.40, 23.40, 114.50, 23.50)) });
    expect(next.body.status).toBe('in_pool');
    expect(next.body.hits ?? []).toEqual([]);
  });

  it('对方在待分派池、已派机构、暂缓被撞上：只打疑似重复标记，不改对方状态', async () => {
    for (const [index, status] of ['in_pool', 'org_assigned', 'held'].entries()) {
      const west = 114.60 + index * 0.2;
      const peer = await register({ spatial: polygon(rect(west, 23.40, west + 0.1, 23.50)) });
      await setStatus(peer.body.id ?? '', status);
      const mine = await register({ spatial: polygon(rect(west, 23.40, west + 0.1, 23.50)) });
      expect(mine.body.status).toBe('pending_decision');
      expect(mine.body.hits ?? []).toHaveLength(1);
      const reverse = await hitRows(peer.body.id ?? '');
      expect(reverse).toHaveLength(1);
      expect(reverse[0]?.other_clue_id).toBe(mine.body.id);
      const row = await suite.cloned.prisma.clue.findUnique({ where: { id: peer.body.id } });
      expect(row?.status).toBe(status);
    }
  });

  it('群众举报来源的线索撞上既有线索：仍走决定步且登记成功', async () => {
    const existing = await register({ spatial: polygon(rect(115.20, 23.40, 115.30, 23.50)) });
    expect(existing.status).toBe(201);
    const complaint = await register({
      sourceCode: '301',
      values: COMPLAINT_VALUES,
      spatial: polygon(rect(115.20, 23.40, 115.30, 23.50)),
    });
    expect(complaint.status).toBe(201);
    expect(complaint.body.status).toBe('pending_decision');
    expect(complaint.body.hits ?? []).toHaveLength(1);
  });
});
