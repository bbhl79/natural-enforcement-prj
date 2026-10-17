import { describe, expect, it } from 'vitest';
import type { AuditTrailRecord } from '@natural-enforcement/audit';

import { auditExportFilename, parseAuditFilter } from './audit-browse.service.ts';
import { auditRowCells, describeAuditRow, shanghaiMinute, type AuditRowView } from './audit-labels.ts';
import { buildXlsx } from './xlsx.ts';

// 2026-10-17 09:48（Asia/Shanghai）
const NOW = new Date('2026-10-17T01:48:00.000Z');

function record(overrides: Partial<AuditTrailRecord>): AuditTrailRecord {
  const orgUnitId = overrides.orgUnitId === undefined ? 'org-ld' : overrides.orgUnitId;
  return {
    anchorOrgUnitId: orgUnitId,
    targetOrgUnitBasis: null,
    id: 'r1',
    createdAt: NOW,
    action: 'account.unlocked',
    outcome: 'succeeded',
    reason: null,
    actorCode: 'TH0102',
    subjectCode: 'TH0331',
    orgUnitId: 'org-ld',
    orgUnitName: '龙洞自然资源所',
    opcode: null,
    resourceType: null,
    resourceId: null,
    itemCount: null,
    ...overrides,
  };
}

describe('#126 筛选条件', () => {
  it('缺省为昨天到今天（Asia/Shanghai），全部类别、全部结果', () => {
    expect(parseAuditFilter({}, NOW)).toEqual({
      from: '2026-10-16', to: '2026-10-17', category: null, actorCode: null, outcome: null,
    });
    // UTC 16:00 已是上海的次日
    expect(parseAuditFilter({}, new Date('2026-10-17T16:00:00.000Z'))?.to).toBe('2026-10-18');
  });

  it('不合法的日期、起晚于止、表外类别与结果一律不合法', () => {
    for (const input of [
      { from: '2026-10-18', to: '2026-10-17' },
      { from: '2026-02-30' },
      { from: '20261016' },
      { from: 20261016 },
      { category: 'all' },
      { outcome: 'ok' },
      { actorCode: 7 },
    ]) {
      expect(parseAuditFilter(input, NOW), JSON.stringify(input)).toBeNull();
    }
  });

  it('工号去掉首尾空白，空串视为不筛', () => {
    expect(parseAuditFilter({ actorCode: ' TH0102 ' }, NOW)?.actorCode).toBe('TH0102');
    expect(parseAuditFilter({ actorCode: '  ' }, NOW)?.actorCode).toBeNull();
  });

  it('导出文件名「管理台留痕_起止日期.xlsx」', () => {
    expect(auditExportFilename({ from: '2026-10-16', to: '2026-10-17' })).toBe('管理台留痕_20261016-20261017.xlsx');
  });
});

describe('#126 留痕展示文字（P8）', () => {
  it('时间按 Asia/Shanghai 到分钟', () => {
    expect(shanghaiMinute(NOW)).toBe('2026-10-17 09:48');
  });

  it('解锁成功、被拒的解锁、未对上人员的登录失败、结束会话', () => {
    expect(auditRowCells(describeAuditRow(record({})))).toEqual([
      '2026-10-17 09:48', 'TH0102', '解锁', '人员 TH0331', '龙洞自然资源所', '成功',
    ]);
    const denied = describeAuditRow(
      record({
        action: 'authz.denied', outcome: 'failed', reason: 'scope-denied', actorCode: 'HZ0101', subjectCode: null,
        opcode: 'personnel.locked.release', resourceType: 'personnel', resourceId: 'p-331',
      }),
      { personnelCodes: new Map([['p-331', 'TH0331']]), orgNames: new Map() },
    );
    expect(denied).toMatchObject({ operation: '解锁', object: '人员 TH0331', result: '被拒绝：超出数据范围', tone: 'red' });
    const unknown = describeAuditRow(record({
      action: 'login.failed', outcome: 'failed', reason: 'unknown-identifier', actorCode: null, subjectCode: null,
      orgUnitId: null, orgUnitName: null,
    }));
    expect(auditRowCells(unknown)).toEqual(['2026-10-17 09:48', '—', '登录', '未对上人员', '无所属机构', '失败：未对上人员']);
    expect(unknown.anchored).toBe(false);
    const ended = describeAuditRow(record({ action: 'session.ended', reason: 'idle-timeout', subjectCode: 'TH0201' }));
    expect(ended).toMatchObject({ operation: '结束会话', result: '空闲超过 30 分钟', tone: 'gray' });
  });

  it('查阅与导出留痕自身、人员导出', () => {
    expect(describeAuditRow(record({ action: 'audit.exported', subjectCode: null, itemCount: 46 }))).toMatchObject({
      operation: '导出管理台留痕', object: '管理台留痕', result: '成功',
    });
    expect(describeAuditRow(record({
      action: 'personnel.exported', subjectCode: null, resourceType: 'org-unit', resourceId: 'org-ld',
    }))).toMatchObject({ operation: '导出人员', object: '龙洞自然资源所' });
  });

  it('拒绝行的「所属机构」是目标机构，「对象」按资源标识取机构名（#105；ADR 0011 修正）', () => {
    const crossDistrict = record({
      action: 'authz.denied', outcome: 'failed', reason: 'scope-denied', actorCode: 'TH0102', subjectCode: null,
      opcode: 'audit.admin.read', resourceType: 'org-unit', resourceId: 'org-hz',
      anchorOrgUnitId: 'org-hz', targetOrgUnitBasis: 'object',
    });
    expect(describeAuditRow(crossDistrict, { personnelCodes: new Map(), orgNames: new Map([['org-hz', '海珠区分局']]) }))
      .toMatchObject({ operation: '查阅管理台留痕', object: '海珠区分局', orgName: '海珠区分局', anchored: true });
    // 查不到名称时不拿操作者的机构名冒充
    expect(describeAuditRow(crossDistrict)).toMatchObject({ object: '机构', orgName: '', anchored: true });
  });

  it('对象机构解析不出、按操作者机构兜底的拒绝行，所属机构是操作者的任职机构', () => {
    const fallback = record({
      action: 'authz.denied', outcome: 'failed', reason: 'scope-denied', actorCode: 'TH0102', subjectCode: null,
      opcode: 'audit.admin.read', resourceType: 'org-unit', resourceId: 'no-such-org',
      anchorOrgUnitId: 'org-ld', targetOrgUnitBasis: 'actor-fallback',
    });
    expect(describeAuditRow(fallback)).toMatchObject({ object: '机构', orgName: '龙洞自然资源所', anchored: true });
  });
});

describe('#126 可见文字不出现工程码（SCREENS.md:8；P8 动作原文只放 data-action）', () => {
  /** 页面与导出共用的可见文字：表格六格。 */
  const visible = (view: AuditRowView) => auditRowCells(view).join('|');
  const codes = ['clue.read', 'future.thing.done', 'mystery-reason', 'odd-denial', 'authz.denied', 'login.failed'];

  it('对照表里没有的拒绝码、动作和原因，一律用中文通用说法兜底', () => {
    const rows = [
      record({ action: 'authz.denied', outcome: 'failed', reason: 'odd-denial', subjectCode: null, opcode: 'clue.read' }),
      record({ action: 'authz.denied', outcome: 'failed', reason: null, subjectCode: null, opcode: null }),
      record({ action: 'future.thing.done', outcome: 'failed', reason: 'mystery-reason', subjectCode: null }),
      record({ action: 'future.thing.done', outcome: 'succeeded', subjectCode: null }),
      record({ action: 'login.failed', outcome: 'failed', reason: 'mystery-reason', subjectCode: 'TH0331' }),
      record({ action: 'session.ended', reason: 'mystery-reason', subjectCode: 'TH0331' }),
    ].map((item) => describeAuditRow(item));
    expect(rows.map((row) => [row.operation, row.result])).toEqual([
      ['其他操作', '被拒绝'],
      ['其他操作', '被拒绝'],
      ['其他操作', '失败'],
      ['其他操作', '成功'],
      ['登录', '失败'],
      ['结束会话', '结束会话'],
    ]);
    for (const row of rows) {
      for (const code of codes) expect(visible(row), code).not.toContain(code);
    }
  });
});

describe('#126 xlsx 写出', () => {
  it('是 ZIP（PK 开头），含工作簿与工作表，文字经 XML 转义', () => {
    const file = buildXlsx('管理台留痕', [['时间', '对象'], ['2026-10-17 09:48', '人员 <A&B>']]);
    expect(file.subarray(0, 2).toString('latin1')).toBe('PK');
    const text = file.toString('utf8');
    expect(text).toContain('xl/worksheets/sheet1.xml');
    expect(text).toContain('<sheet name="管理台留痕"');
    expect(text).toContain('人员 &lt;A&amp;B&gt;');
    expect(text).toContain('<c r="B2" t="inlineStr">');
  });

  it('同样的内容产物逐字节相同', () => {
    const rows = [['a', 'b'], ['c', 'd']];
    expect(buildXlsx('s', rows).equals(buildXlsx('s', rows))).toBe(true);
  });
});
