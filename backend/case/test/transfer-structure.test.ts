// #242 结构红探针：移送只有一条落库路径，不直送对方待分派池；
// 外部退回不进 #238 退回列表；移送记载与回证在库层只追加。
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { findTransition, X12_WHITELIST } from '../src/state-machine/index.ts';

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), 'utf8');
}

describe('#242 结构探针', () => {
  const service = source('../../server/src/case-transfer.service.ts');
  const controller = source('../../server/src/case-transfer.controller.ts');

  it('移送服务不写线索待分派池、不改线索段', () => {
    for (const text of [service, controller]) {
      expect(text).not.toMatch(/CLUE_STORE|clues\.|assignOrg|dispatchToPool|clue\.dispatch/);
    }
  });

  it('外部退回另立记录：移送服务不写 #238 退回表', () => {
    expect(service).not.toContain('appendCaseReturn');
    expect(service).not.toContain('CaseReturn');
  });

  it('T30 分支由服务层解析，不直连分支边当单一边调用', () => {
    expect(findTransition('T30')?.to.kind).toBe('branch');
    expect(service).toContain('criminalOutletLanding');
    expect(service).toContain('buildTransitionEffects');
    expect(service).not.toMatch(/operation:\s*\{\s*kind:\s*'transition',\s*transitionId:\s*'T30'/);
  });

  it('T29 只用于涉刑与党纪政务；管辖移送不调用迁移', () => {
    expect(service).toContain("transitionId: 'T29'");
    expect(service).toContain("content.kind !== 'jurisdiction'");
  });

  it('结案后补传回证走 X12 白名单第 2 项', () => {
    expect(X12_WHITELIST.map((item) => item.id)).toContain('post-close-receipt');
    expect(service).toContain("kind: 'post-close-receipt'");
  });

  it('库层对移送记载、附件回证与外部决定只追加', () => {
    const migration = source(
      '../../prisma/migrations/20261029230000_issue242_case_transfer/migration.sql',
    );
    for (const table of ['case_transfer', 'case_transfer_file', 'case_criminal_decision']) {
      expect(migration).toContain(`BEFORE UPDATE OR DELETE ON ${table}`);
    }
  });
});