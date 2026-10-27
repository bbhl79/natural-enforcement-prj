// 要件依据层级与 provisional 标记（#257）。
// 断言来自影响表（#257/6435298813）、265 组回填（#257/6435129338）、
// 缺口-Q33（#257/6435343695）与要件依据四项（#257/6435475490）。

import { describe, expect, it } from 'vitest';

import { DOCUMENTS } from '@natural-enforcement/geo-dict';

import {
  PUBLIC_LAYER_ITEMS,
  SOURCE_LAYER_GROUPS,
  TYPE_LAYER_ITEMS,
  type RequirementAuthority,
  type RequirementItem,
} from '../src/index.ts';
import { classifyFilingGaps } from '../src/filing/index.ts';

const AUTHORITIES: readonly RequirementAuthority[] = ['law', 'regulation', 'normative', 'internal', 'system'];

const AUTHORITY_BY_HIERARCHY: Readonly<Record<string, RequirementAuthority>> = {
  法律: 'law',
  司法解释: 'law',
  行政法规: 'regulation',
  部门规章: 'regulation',
  省级地方性法规: 'regulation',
  设区的市地方性法规: 'regulation',
  地方政府规章: 'regulation',
  部门规范性文件: 'normative',
  地方政府规范性文件: 'normative',
};

const RANK: Readonly<Record<RequirementAuthority, number>> = {
  law: 5,
  regulation: 4,
  normative: 3,
  internal: 2,
  system: 1,
};

function allItems(): RequirementItem[] {
  return [
    ...PUBLIC_LAYER_ITEMS,
    ...SOURCE_LAYER_GROUPS.flatMap((group) => group.items),
    ...TYPE_LAYER_ITEMS,
  ];
}

function byKey(key: string): RequirementItem {
  const found = allItems().find((entry) => entry.key === key);
  if (!found) throw new Error(`缺少要件键 ${key}`);
  return found;
}

function docSet(item: RequirementItem): string {
  return [...new Set(item.basis.map((entry) => entry.document))].sort().join('|');
}

function highestAuthority(item: RequirementItem): RequirementAuthority | null {
  const byCode = new Map<string, string>(
    DOCUMENTS.map((document) => [document.code, document.hierarchyLevel]),
  );
  let best: RequirementAuthority | null = null;
  for (const document of item.basis) {
    const level = byCode.get(document.document);
    const authority = level === undefined ? undefined : AUTHORITY_BY_HIERARCHY[level];
    if (!authority) throw new Error(`文书 ${document.document} 缺少五档映射`);
    if (best === null || RANK[authority] > RANK[best]) best = authority;
  }
  return best;
}

describe('要件依据层级（#257）', () => {
  it('1042 项均有五档 authority', () => {
    const items = allItems();
    expect(items).toHaveLength(1042);
    for (const item of items) {
      expect(AUTHORITIES).toContain(item.authority);
    }
  });

  it('有条文的项层级等于依据文书的最高档（265 组逐组回填的等价口径）', () => {
    for (const item of allItems()) {
      if (item.basis.length === 0) continue;
      expect({ key: item.key, authority: item.authority }).toEqual({
        key: item.key,
        authority: highestAuthority(item),
      });
    }
  });

  it('无条文项按缺口依据评论落 internal 或 system', () => {
    const expected: Readonly<Record<string, RequirementAuthority>> = {
      'clue.finder': 'internal',
      'clue.patrol_no': 'internal',
      'clue.assign_doc_no': 'internal',
      'clue.assign_org': 'internal',
      'clue.transfer_doc_no': 'internal',
      'clue.transfer_org': 'internal',
      'clue.reporter_anonymous': 'system',
      'clue.verifiable_basis': 'internal',
      'clue.opinion_source': 'internal',
      'clue.opinion_published_at': 'system',
      'clue.campaign_no': 'internal',
      'clue.satellite_batch': 'system',
      'clue.satellite_plot': 'system',
      'clue.reporter_name': 'normative',
      'clue.reporter_contact': 'internal',
      'clue.opinion_ref': 'internal',
      'clue.location': 'system',
      'clue.materials': 'internal',
      'clue.tags': 'internal',
      'type.land_transfer_collective.pilot_area': 'internal',
    };
    for (const item of allItems()) {
      if (item.basis.length > 0) continue;
      expect({ key: item.key, authority: item.authority }).toEqual({
        key: item.key,
        authority: expected[item.key],
      });
    }
  });

  it('G020 的 10 键降为警告，clue.patrol_no 的条件必填不变', () => {
    const keys = [
      'clue.finder',
      'clue.patrol_no',
      'clue.assign_doc_no',
      'clue.assign_org',
      'clue.transfer_doc_no',
      'clue.transfer_org',
      'clue.reporter_anonymous',
      'clue.verifiable_basis',
      'clue.opinion_source',
      'clue.opinion_published_at',
    ];
    for (const key of keys) {
      const item = byKey(key);
      expect(item.consequence).toBe('警告');
      expect(['internal', 'system']).toContain(item.authority);
    }
    const patrol = byKey('clue.patrol_no');
    expect(patrol.required).toBe(true);
    expect(patrol.condition).toBe('来源选 16 日常巡查时');
  });
});

describe('缺口-Q33：4 组 137 键标 provisional，仍阻断', () => {
  const groupSets = [
    { docSet: 'doc_002', count: 129 },
    { docSet: 'doc_002|doc_028', count: 6 },
    { docSet: 'doc_002|doc_038', count: 1 },
    { docSet: 'doc_002|doc_069', count: 1 },
  ];

  it.each(groupSets)('$docSet：$count 键，provisional 且注记规程位阶', ({ docSet: set, count }) => {
    const rows = allItems().filter(
      (item) => item.consequence === '阻断' && docSet(item) === set && item.authority === 'normative',
    );
    expect(rows).toHaveLength(count);
    for (const item of rows) {
      expect(item.provisional).toBe(true);
      expect(item.basisNote).toContain('待法制确认规程位阶');
      expect(classifyFilingGaps([item]).blocks.map((entry) => entry.key)).toEqual([item.key]);
    }
  });

  it('4 组合计 137 键', () => {
    const total = groupSets.reduce((sum, group) => sum + group.count, 0);
    expect(total).toBe(137);
  });
});

describe('缺口-Q33：14 键降为警告，不阻断', () => {
  it('3 组 13 键＋clue.location 共 14 键', () => {
    const g020 = [
      'clue.finder',
      'clue.patrol_no',
      'clue.assign_doc_no',
      'clue.assign_org',
      'clue.transfer_doc_no',
      'clue.transfer_org',
      'clue.reporter_anonymous',
      'clue.verifiable_basis',
      'clue.opinion_source',
      'clue.opinion_published_at',
    ].map(byKey);
    const g100 = TYPE_LAYER_ITEMS.filter(
      (item) => docSet(item) === 'doc_028|doc_029' && item.consequence === '警告',
    );
    const g173 = TYPE_LAYER_ITEMS.filter(
      (item) => docSet(item) === 'doc_025|doc_028' && item.consequence === '警告',
    );
    const location = byKey('clue.location');
    expect(g100).toHaveLength(2);
    expect(g173).toHaveLength(1);
    expect(location.consequence).toBe('警告');

    const items = [...g020, ...g100, ...g173, location];
    expect(items).toHaveLength(14);
    for (const item of items) expect(item.consequence).toBe('警告');
    const out = classifyFilingGaps(items);
    expect(out.blocks).toEqual([]);
    expect(out.warnings).toHaveLength(14);
  });
});

describe('要件依据四项（#257/6435475490）', () => {
  it('G194 保持警告并标 provisional', () => {
    const item = byKey('type.land_approve_without_authority.criminal_referral_check');
    expect(item.consequence).toBe('警告');
    expect(item.authority).toBe('law');
    expect(item.provisional).toBe(true);
    expect(item.basisNote).toContain('待法制确认');
  });

  it('doc_044／045／047 查不到的键保持非阻断并标 provisional', () => {
    const keys = [
      'type.survey_secret_geo_info_no_register.management_system',
      'type.survey_secret_geo_info_no_register.license_record',
      'type.survey_custodian_refuse_provide.secret_approval',
    ];
    for (const key of keys) {
      const item = byKey(key);
      expect(item.provisional).toBe(true);
      expect(item.consequence).not.toBe('阻断');
    }
  });
});