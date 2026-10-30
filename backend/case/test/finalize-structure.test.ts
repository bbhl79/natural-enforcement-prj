// #243 结构探针：T27 只由定型服务落库；定型记录与呈批历史只追加；
// 版本化材料清单是唯一来源。
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  DOSSIER_MATERIALS_RULE_ID,
  DOSSIER_MATERIALS_VERSION,
  DOSSIER_REVIEW_REQUIRED_ITEMS,
} from '../src/dossier/index.ts';
import { X12_WHITELIST, findTransition } from '../src/state-machine/index.ts';

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), 'utf8');
}

describe('#243 定型结构探针', () => {
  const service = source('../../server/src/case-finalize.service.ts');
  const stateService = source('../../server/src/case-state.service.ts');

  it('T27 已启用并登记在 X12 白名单', () => {
    expect(findTransition('T27')).toMatchObject({
      enabled: true,
      guard: 'dossier',
      to: { kind: 'main', status: 'finalized' },
    });
    expect(X12_WHITELIST.filter((item) => item.kind === 'transition').map((item) => item.id)).toEqual(['T27']);
  });

  it('T27 只由定型服务在批准事务里调用；通用入口拒绝直接套用', () => {
    expect(service).toContain("const FINALIZE_TRANSITION = 'T27'");
    expect(stateService).toMatch(/PROCEDURE_TRANSITIONS = new Set\(\[[\s\S]*'T27'/);
    expect(service).not.toContain("transitionId: 'T27'");
  });

  it('卷宗材料清单带规则编号与版本，且与 #244 共用同一出口', () => {
    expect(DOSSIER_MATERIALS_RULE_ID).toBe('cfg.rule.dossier-materials.v1');
    expect(DOSSIER_MATERIALS_VERSION).not.toBe('');
    expect([...DOSSIER_REVIEW_REQUIRED_ITEMS]).toEqual([5, 6, 7, 9]);
    const entry = source('../src/index.ts');
    expect(entry).toContain('requiredDossierItems');
    expect(entry).toContain('DOSSIER_MATERIALS_RULE_ID');
  });

  it('库层对材料、版本、步骤与定型记录只追加', () => {
    const migration = source('../../prisma/migrations/20261030150000_issue243_case_finalize/migration.sql');
    for (const table of [
      'case_dossier_material',
      'case_finalize_approval_version',
      'case_finalize_approval_step',
      'case_finalize',
    ]) {
      expect(migration).toContain(`BEFORE UPDATE OR DELETE ON ${table}`);
    }
    expect(migration).toContain('BEFORE UPDATE OR DELETE ON case_finalize_approval');
    expect(migration).toContain('case_finalize_approval_open_uq');
  });
});