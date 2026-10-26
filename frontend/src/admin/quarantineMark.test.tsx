// 涉密误传标记入口的前端测试（管理台机构详情）。
// 测的是可见行为：只有根机构系统管理员在本人根机构详情里看到入口；两项必填才可提交；
// 提交调用隔离接口；失败文案。
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ApiDispatch } from '../api';
import { QuarantineMarkView } from './QuarantineMarkPanel';
import type { OrgTreeData, OrgUnit } from './orgTree';
import { QUARANTINE_MARK, canMarkQuarantine, markQuarantine, quarantineMarkFailureText } from './quarantineMark';

function unit(id: string, parentId: string | null, level: OrgUnit['level']): OrgUnit {
  return { id, code: id, name: id, level, parentId, deactivatedAt: null, activePersonnel: 1, names: [] };
}

const CITY = unit('city', null, 'city');
const DISTRICT = unit('district', 'city', 'district');
const STATION = unit('station', 'district', 'station');
const ROOT_TREE: OrgTreeData = { rootId: 'city', orgUnits: [CITY, DISTRICT, STATION] };
// 部门系统管理员的树：树根是本人任职的区分局，它有上级。
const DEPT_TREE: OrgTreeData = { rootId: 'district', orgUnits: [DISTRICT, STATION] };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('涉密误传标记入口可见性', () => {
  it('根机构系统管理员在本人根机构详情里可见', () => {
    expect(canMarkQuarantine([QUARANTINE_MARK], ROOT_TREE, CITY)).toBe(true);
  });

  it('选中下级机构时不可见', () => {
    expect(canMarkQuarantine([QUARANTINE_MARK], ROOT_TREE, DISTRICT)).toBe(false);
    expect(canMarkQuarantine([QUARANTINE_MARK], ROOT_TREE, STATION)).toBe(false);
  });

  it('部门系统管理员（树根有上级）不可见', () => {
    expect(canMarkQuarantine([QUARANTINE_MARK], DEPT_TREE, DISTRICT)).toBe(false);
  });

  it('会话没有标记码时不可见', () => {
    expect(canMarkQuarantine(['org.unit.register', 'org.tree.read'], ROOT_TREE, CITY)).toBe(false);
  });
});

describe('涉密误传标记面板', () => {
  it('显示材料编号、简述与按钮；未填时按钮禁用；说明原文件保留', () => {
    const html = renderToStaticMarkup(
      <QuarantineMarkView busy={false} failure={null} notice={null} onMark={() => undefined} />,
    );
    expect(html).toContain('涉密误传标记');
    expect(html).toContain('材料编号');
    expect(html).toContain('简述');
    expect(html).toContain('标记涉密误传');
    expect(html).toContain('原文件仍保留，系统不删除');
    expect(html).toMatch(/data-role="quarantine-mark-submit"[^>]*disabled/);
  });

  it('失败与结果横幅', () => {
    const html = renderToStaticMarkup(
      <QuarantineMarkView busy={false} failure="你没有权限执行这个操作。" notice="已标记" onMark={() => undefined} />,
    );
    expect(html).toContain('data-role="failure"');
    expect(html).toContain('你没有权限执行这个操作。');
    expect(html).toContain('data-role="notice"');
  });

  it('失败文案', () => {
    expect(quarantineMarkFailureText(403, { reason: 'scope-denied' })).toContain('不属于你任职的根机构');
    expect(quarantineMarkFailureText(403, { reason: 'permission-denied' })).toContain('没有权限');
    expect(quarantineMarkFailureText(400, { result: 'non-compliant', reason: 'missing-summary' })).toContain('简述');
    expect(quarantineMarkFailureText(404, { result: 'not-found' })).toContain('找不到');
    expect(quarantineMarkFailureText(409, { result: 'invalid-state', reason: 'already-quarantined' })).toContain('已标记');
    expect(quarantineMarkFailureText(500, null)).toContain('重试');
  });
});

describe('标记提交调用隔离接口', () => {
  const dispatch = vi.fn(async () => undefined) as unknown as ApiDispatch;

  it('POST 材料隔离接口并带简述', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(new Response(JSON.stringify({ result: 'quarantined' }), { status: 200 }));
    });
    const result = await markQuarantine(dispatch, { materialId: 'M/1', summary: '误传图纸' });
    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('/api/storage/materials/M%2F1/quarantine');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ summary: '误传图纸' });
  });

  it('重复标记回 409 时给出已标记文案', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        new Response(JSON.stringify({ result: 'invalid-state', reason: 'already-quarantined' }), { status: 409 }),
      ),
    );
    const result = await markQuarantine(dispatch, { materialId: 'M1', summary: '误传' });
    expect(result).toEqual({ ok: false, message: '该材料已标记为涉密误传，无须重复标记。' });
  });
});
