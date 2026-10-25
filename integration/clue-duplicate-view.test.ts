// #212 比对视图与实名查阅——接口层用例（块 4）。
// 断言打在克隆库上：命中按对方线索分组（双方面 ID、双方比例、交集面积、dup_computed_at）、
// 点状说明、举报必派决定契约、匿名对称脱敏（双向同口径）、reporter-read 明文唯一出口
// （no-store、查阅留痕只记事实）、403／404 的失败口径。
import { describe, expect, it } from 'vitest';

import {
  COMPLAINT_VALUES,
  cookieOf,
  point,
  polygon,
  rect,
  register,
  setupClueSuite,
  suite,
  trailOf,
  deniedTrail,
} from './duplicate-helpers';

setupClueSuite();

/** 疑似重复比对视图。 */
interface DuplicatesResponseBody {
  readonly result?: string;
  readonly code?: string;
  readonly spatialKind?: string;
  readonly pointNotice?: string | null;
  readonly status?: string;
  readonly dupComputedAt?: string | null;
  readonly decision?: {
    readonly requiresDecision: boolean;
    readonly mustDispatch: boolean;
    readonly allowHold: boolean;
    readonly defaultHold: boolean;
    readonly requireAcknowledge: boolean;
    readonly ruleCodes: string[];
  };
  readonly groups?: {
    readonly otherClueId: string;
    readonly otherClueCode: string;
    readonly otherStatus: string;
    readonly otherStatusLabel: string;
    readonly anonymous: boolean;
    readonly otherRegisteredAt: string;
    readonly otherLocation: string | null;
    readonly otherReporterName: string | null;
    readonly otherReporterContact: string | null;
    readonly faces: {
      readonly partId: string;
      readonly partIndex: number;
      readonly otherPartId: string;
      readonly otherPartIndex: number;
      readonly selfRatio: number;
      readonly otherRatio: number;
      readonly intersectionArea: number;
      readonly selfGeojson: string | null;
      readonly otherGeojson: string | null;
    }[];
  }[];
}

async function duplicates(
  clueId: string,
  code = 'P-CLERK-A',
): Promise<{ status: number; body: DuplicatesResponseBody }> {
  const response = await fetch(`${suite.baseUrl}/api/clues/${clueId}/duplicates`, {
    headers: { cookie: await cookieOf(code) },
  });
  return { status: response.status, body: (await response.json()) as DuplicatesResponseBody };
}

/** 实名查阅。 */
interface ReporterReadResponseBody {
  readonly result?: string;
  readonly code?: string;
  readonly reporterName?: string | null;
  readonly reporterContact?: string | null;
}

async function reporterRead(
  clueId: string,
  code = 'P-CLERK-A',
): Promise<{ status: number; headers: Headers; body: ReporterReadResponseBody }> {
  const response = await fetch(`${suite.baseUrl}/api/clues/${clueId}/reporter-read`, {
    method: 'POST',
    headers: { cookie: await cookieOf(code) },
  });
  return {
    status: response.status,
    headers: response.headers,
    body: (await response.json()) as ReporterReadResponseBody,
  };
}

describe('#212 比对视图与实名查阅', () => {
  it('比对视图：命中按对方线索分组，含双方面 ID、双方比例、交集面积与 dup_computed_at', async () => {
    const peer = await register({ spatial: polygon(rect(119.00, 23.40, 119.10, 23.50)) });
    const mine = await register({ spatial: polygon(rect(119.00, 23.40, 119.10, 23.50)) });
    expect(mine.body.status).toBe('pending_decision');

    const view = await duplicates(mine.body.id ?? '');
    expect(view.status).toBe(200);
    expect(view.body.result).toBe('listed');
    expect(view.body.spatialKind).toBe('face');
    expect(view.body.pointNotice).toBeNull();
    expect(view.body.dupComputedAt).toBeTruthy();
    expect(view.body.decision?.requiresDecision).toBe(true);
    expect(view.body.decision?.mustDispatch).toBe(false);
    expect(view.body.decision?.defaultHold).toBe(true);
    expect(view.body.decision?.requireAcknowledge).toBe(true);
    const groups = view.body.groups ?? [];
    expect(groups).toHaveLength(1);
    expect(groups[0]?.otherClueCode).toBe(peer.body.code);
    expect(groups[0]?.otherStatusLabel).toBe('待分派');
    expect(groups[0]?.anonymous).toBe(false);
    expect(groups[0]?.otherRegisteredAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(groups[0]?.faces).toHaveLength(1);
    const face = groups[0]?.faces[0];
    expect(face?.selfRatio).toBeCloseTo(1, 5);
    expect(face?.otherRatio).toBeCloseTo(1, 5);
    expect(face?.intersectionArea).toBeGreaterThan(0);
    expect(face?.partId).toBeTruthy();
    expect(face?.otherPartId).toBeTruthy();
    // 非匿名分组带双方面几何（图斑对比用）。
    expect(face?.selfGeojson).toContain('Polygon');
    expect(face?.otherGeojson).toContain('Polygon');
  });

  it('点状线索的比对视图：不做空间重合判定的说明，无命中分组', async () => {
    const pointClue = await register({ domain: 'survey', spatial: point(119.20, 23.45) });
    const view = await duplicates(pointClue.body.id ?? '');
    expect(view.status).toBe(200);
    expect(view.body.spatialKind).toBe('point');
    expect(view.body.pointNotice).toContain('不做空间重合判定');
    expect(view.body.groups ?? []).toEqual([]);
    expect(view.body.decision?.requiresDecision).toBe(false);
  });

  it('举报必派：决定契约 mustDispatch，规则码 complaint-must-dispatch', async () => {
    await register({ spatial: polygon(rect(119.30, 23.40, 119.40, 23.50)) });
    const complaint = await register({
      sourceCode: '301',
      values: COMPLAINT_VALUES,
      spatial: polygon(rect(119.30, 23.40, 119.40, 23.50)),
    });
    const view = await duplicates(complaint.body.id ?? '');
    expect(view.body.decision?.mustDispatch).toBe(true);
    expect(view.body.decision?.defaultHold).toBe(false);
    expect(view.body.decision?.ruleCodes).toEqual(['complaint-must-dispatch']);
  });

  it('举报类无命中：不经决定步', async () => {
    const lone = await register({
      sourceCode: '301',
      values: COMPLAINT_VALUES,
      spatial: polygon(rect(119.50, 23.40, 119.60, 23.50)),
    });
    const view = await duplicates(lone.body.id ?? '');
    expect(view.body.groups ?? []).toEqual([]);
    expect(view.body.decision?.requiresDecision).toBe(false);
    expect(view.body.decision?.mustDispatch).toBe(true);
  });

  it('匿名对称：任一方涉匿名，对方登记时间只到月、位置只到区、反映人默认脱敏（双向同口径）', async () => {
    const named = await register({
      sourceCode: '301',
      values: {
        ...COMPLAINT_VALUES,
        'clue.reporter_name': '李四',
        'clue.reporter_contact': '13712345678',
        'clue.location': '广州市天河区石牌街道某地块',
      },
      spatial: polygon(rect(119.70, 23.40, 119.80, 23.50)),
    });
    const anonymous = await register({
      sourceCode: '301',
      values: {
        ...COMPLAINT_VALUES,
        'clue.reporter_anonymous': '是',
        'clue.reporter_name': '王五',
        'clue.reporter_contact': '13687654321',
        'clue.location': '广州市白云区人和镇某地块',
      },
      spatial: polygon(rect(119.70, 23.40, 119.80, 23.50)),
    });
    expect(anonymous.body.status).toBe('pending_decision');

    // 匿名一侧看实名一侧：时间到月、位置到区、反映人脱敏、不带精确几何。
    const fromAnonymous = await duplicates(anonymous.body.id ?? '');
    const groupFromAnonymous = (fromAnonymous.body.groups ?? [])[0];
    expect(groupFromAnonymous?.anonymous).toBe(true);
    expect(groupFromAnonymous?.otherRegisteredAt).toMatch(/^\d{4}-\d{2}$/);
    expect(groupFromAnonymous?.otherLocation).toBe('广州市天河区');
    expect(groupFromAnonymous?.otherReporterName).toBe('李*');
    expect(groupFromAnonymous?.otherReporterContact).toBe('137****5678');
    expect(groupFromAnonymous?.faces[0]?.selfGeojson).toBeNull();
    expect(groupFromAnonymous?.faces[0]?.otherGeojson).toBeNull();

    // 实名一侧看匿名一侧：同口径（对称）。
    const fromNamed = await duplicates(named.body.id ?? '');
    const groupFromNamed = (fromNamed.body.groups ?? [])[0];
    expect(groupFromNamed?.anonymous).toBe(true);
    expect(groupFromNamed?.otherRegisteredAt).toMatch(/^\d{4}-\d{2}$/);
    expect(groupFromNamed?.otherLocation).toBe('广州市白云区');
    expect(groupFromNamed?.otherReporterName).toBe('王*');
    expect(groupFromNamed?.otherReporterContact).toBe('136****4321');
  });

  it('实名查阅：明文唯一出口，no-store，查阅留痕只记事实不记明文', async () => {
    const complaint = await register({
      sourceCode: '301',
      values: COMPLAINT_VALUES,
      spatial: polygon(rect(119.90, 23.40, 120.00, 23.50)),
    });
    const read = await reporterRead(complaint.body.id ?? '');
    expect(read.status).toBe(200);
    expect(read.body.result).toBe('read');
    expect(read.body.reporterName).toBe('张三');
    expect(read.body.reporterContact).toBe('13812345678');
    expect(read.headers.get('cache-control')).toBe('no-store');

    const trail = await trailOf('clue.reference-viewed', complaint.body.id);
    expect(trail).toHaveLength(1);
    expect(trail[0]?.outcome).toBe('succeeded');
    expect(trail[0]?.detail).toContain(complaint.body.code);
    expect(trail[0]?.detail).not.toContain('张三');
    expect(trail[0]?.detail).not.toContain('13812345678');
  });

  it('非举报类线索无反映人信息：实名查阅 404，不留查阅留痕', async () => {
    const patrol = await register({ spatial: polygon(rect(120.10, 23.40, 120.20, 23.50)) });
    const read = await reporterRead(patrol.body.id ?? '');
    expect(read.status).toBe(404);
    expect(await trailOf('clue.reference-viewed', patrol.body.id)).toHaveLength(0);
  });

  it('监督无实名查阅权限：403，authz.denied 存在，不留查阅留痕', async () => {
    const complaint = await register({
      sourceCode: '301',
      values: COMPLAINT_VALUES,
      spatial: polygon(rect(120.30, 23.40, 120.40, 23.50)),
    });
    const read = await reporterRead(complaint.body.id ?? '', 'P-SUPER-B');
    expect(read.status).toBe(403);
    expect(await deniedTrail(complaint.body.id ?? '')).toHaveLength(1);
    expect(await trailOf('clue.reference-viewed', complaint.body.id)).toHaveLength(0);
  });
});
