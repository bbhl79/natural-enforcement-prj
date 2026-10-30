// #270 决定（E09／T23）纯规则：决定正文、文书类型、署名盖章、Q24 提示、X05／X06／X16。
import { describe, expect, it } from 'vitest';

import {
  DECISION_FINE_BASE_RULE_KEY,
  DECISION_ISSUER_NAME,
  decisionDocumentTypeOf,
  deriveDecisionKind,
  deriveDecisionSignature,
  fineBaseHint,
  fineBaseMissing,
  hasFine,
  missingEvidenceRefs,
  readDecisionContent,
  readFrozenViolations,
  x05Guard,
  x06Guard,
  x16Guard,
} from '../src/decision/index.ts';

function frozen(violations: unknown[]): unknown {
  return { violations };
}

describe('#270 决定正文', () => {
  it('默认不责令改正、不引用证据；证据引用去重去空', () => {
    expect(readDecisionContent({})).toEqual({
      ok: true,
      content: { correctionOrdered: false, evidenceRefs: [], note: null },
    });
    expect(
      readDecisionContent({ correctionOrdered: true, evidenceRefs: ['M1', ' M1 ', '', 'M2'], note: ' 说明 ' }),
    ).toEqual({
      ok: true,
      content: { correctionOrdered: true, evidenceRefs: ['M1', 'M2'], note: '说明' },
    });
  });

  it('正文形态不合规返回 400', () => {
    expect(readDecisionContent(null)).toMatchObject({ ok: false, hit: { httpStatus: 400, reason: 'invalid-content' } });
    expect(readDecisionContent({ correctionOrdered: 'yes' })).toMatchObject({ ok: false, hit: { reason: 'invalid-content' } });
    expect(readDecisionContent({ evidenceRefs: [1] })).toMatchObject({ ok: false, hit: { reason: 'invalid-evidence' } });
  });
});

describe('#270 冻结拟决定事实', () => {
  it('出口：任一条处罚即处罚决定，否则不予处罚', () => {
    const facts = readFrozenViolations(
      frozen([
        { kind: 'penalty', penaltyCodes: ['fine'], fineAmount: 1000, fineBases: ['基准'] },
        { kind: 'no-penalty' },
      ]),
    );
    expect(deriveDecisionKind(facts)).toBe('penalty');
    expect(hasFine(facts)).toBe(true);
    expect(fineBaseMissing(facts)).toBe(false);
    expect(deriveDecisionKind(readFrozenViolations(frozen([{ kind: 'no-penalty' }])))).toBe('no-penalty');
  });

  it('Q24：罚款金额或基数缺失时提示，不阻断', () => {
    const facts = readFrozenViolations(
      frozen([{ kind: 'penalty', penaltyCodes: ['fine'], fineAmount: null, fineBases: [] }]),
    );
    expect(fineBaseMissing(facts)).toBe(true);
    expect(fineBaseHint()).toMatchObject({
      level: 'hint',
      ruleKey: DECISION_FINE_BASE_RULE_KEY,
    });
  });

  it('摘要不合规按空事实处理', () => {
    expect(readFrozenViolations(null)).toEqual([]);
    expect(readFrozenViolations({ violations: 'x' })).toEqual([]);
    expect(readFrozenViolations({ violations: [{ kind: 'penalty' }] })).toEqual([
      { kind: 'penalty', penaltyCodes: [], fineAmount: null, fineBases: [] },
    ]);
  });
});

describe('#270 文书类型与署名盖章', () => {
  it('责令改正与罚款一起作出的写进处罚决定书；只责令改正的用责令改正通知书', () => {
    expect(decisionDocumentTypeOf({ kind: 'penalty', correctionOrdered: true, hasFine: true })).toBe('penalty-decision');
    expect(decisionDocumentTypeOf({ kind: 'penalty', correctionOrdered: true, hasFine: false })).toBe('order-correction-notice');
    expect(decisionDocumentTypeOf({ kind: 'penalty', correctionOrdered: false, hasFine: false })).toBe('penalty-decision');
    expect(decisionDocumentTypeOf({ kind: 'no-penalty', correctionOrdered: false, hasFine: false })).toBe('no-penalty-decision');
  });

  it('市局本级盖市局印章；区分局盖执法监督专用章；自然资源所用章待定', () => {
    expect(deriveDecisionSignature({ level: 'city', handlingOrgName: '自然执法总队' })).toEqual({
      issuer: DECISION_ISSUER_NAME,
      sealText: `${DECISION_ISSUER_NAME}印章`,
      sealPending: false,
      note: null,
    });
    expect(
      deriveDecisionSignature({ level: 'district', handlingOrgName: '广州市规划和自然资源局第一区分局' }),
    ).toMatchObject({
      issuer: DECISION_ISSUER_NAME,
      sealText: `${DECISION_ISSUER_NAME}执法监督专用章（第一区分局）`,
      sealPending: false,
    });
    expect(deriveDecisionSignature({ level: 'station', handlingOrgName: '甲区执法所' })).toMatchObject({
      sealPending: true,
      sealText: null,
      note: '自然资源所用章待定',
    });
  });
});

describe('#270 X05／X06／X16', () => {
  it('X05：拟处罚但告知书未送达阻断（law）', () => {
    const hit = x05Guard({ kind: 'penalty', noticeServed: false });
    expect(hit).toMatchObject({ level: 'block', code: 'X05', authority: 'law' });
    expect(x05Guard({ kind: 'penalty', noticeServed: true })).toBeNull();
    expect(x05Guard({ kind: 'no-penalty', noticeServed: false })).toBeNull();
  });

  it('X06：告知期限未满阻断（regulation）；期满、书面放弃或不适用时不阻断', () => {
    expect(
      x06Guard({ kind: 'penalty', noticeServed: true, window: 'open', waiverRecorded: false }),
    ).toMatchObject({ level: 'block', code: 'X06', authority: 'regulation' });
    expect(
      x06Guard({ kind: 'penalty', noticeServed: true, window: 'manual', waiverRecorded: false }),
    ).toMatchObject({ code: 'X06' });
    expect(x06Guard({ kind: 'penalty', noticeServed: true, window: 'closed', waiverRecorded: false })).toBeNull();
    expect(x06Guard({ kind: 'penalty', noticeServed: true, window: 'open', waiverRecorded: true })).toBeNull();
    expect(x06Guard({ kind: 'no-penalty', noticeServed: true, window: 'open', waiverRecorded: false })).toBeNull();
  });

  it('X16：引用未入卷或经回避认定无效的证据阻断（system＋userLock）', () => {
    const missing = missingEvidenceRefs({
      evidenceRefs: ['D1', 'M1', 'M2', 'X'],
      inDossierIds: ['D1'],
      materialIds: ['M1', 'M2'],
      invalidMaterialIds: ['M2'],
    });
    expect(missing).toEqual(['M2', 'X']);
    const hit = x16Guard(missing);
    expect(hit).toMatchObject({ level: 'block', code: 'X16', authority: 'system', userLock: '#111 L4' });
    expect(x16Guard([])).toBeNull();
  });
});