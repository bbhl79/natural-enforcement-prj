// #243 卷宗必需材料：Q25 事件推导、G4 豁免依据、Q27 送达 A/B、完整性结论。
import { describe, expect, it } from 'vitest';

import {
  DOSSIER_ALWAYS_REQUIRED_ITEMS,
  DOSSIER_DELIVERY_ITEM,
  DOSSIER_EXEMPTIONS,
  DOSSIER_EXEMPTIONS_RULE_ID,
  DOSSIER_EXEMPTIONS_VERSION,
  DOSSIER_MATERIALS,
  DOSSIER_MATERIALS_RULE_ID,
  DOSSIER_MATERIALS_VERSION,
  DOSSIER_REVIEW_REQUIRED_ITEMS,
  deliveryEvidenceSatisfied,
  dossierEventsOf,
  evaluateDossierCompleteness,
  effectiveExemptions,
  readDeliveryEvidence,
  requiredDossierItems,
  type DossierMaterialFact,
} from '../src/dossier/index.ts';

function requirement(overrides: Partial<Parameters<typeof requiredDossierItems>[0]> = {}) {
  return requiredDossierItems({
    reachedReview: false,
    reachedDelivery: false,
    terminationClosed: false,
    jurisdictionTransfer: false,
    ...overrides,
  });
}

function material(itemCode: number, overrides: Partial<DossierMaterialFact> = {}): DossierMaterialFact {
  return { itemCode, current: true, evidenceJson: null, ...overrides };
}

describe('#243 版本化材料清单', () => {
  it('清单是规程 13.1 的 21 项，带规则编号与版本', () => {
    expect(DOSSIER_MATERIALS.map((item) => item.code)).toEqual(Array.from({ length: 21 }, (_, index) => index + 1));
    expect(DOSSIER_MATERIALS[3]?.name).toContain('立案');
    expect(DOSSIER_MATERIALS[18]?.name).toContain('结案呈批表');
    expect(DOSSIER_MATERIALS[19]?.name).toContain('送达回证');
    expect(DOSSIER_MATERIALS_RULE_ID).toBe('cfg.rule.dossier-materials.v1');
    expect(DOSSIER_MATERIALS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(DOSSIER_EXEMPTIONS_RULE_ID).toBe('cfg.rule.dossier-exemptions.v1');
    expect(DOSSIER_EXEMPTIONS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(DOSSIER_ALWAYS_REQUIRED_ITEMS).toEqual([1, 2, 4, 19]);
    expect(DOSSIER_REVIEW_REQUIRED_ITEMS).toEqual([5, 6, 7, 9]);
  });
});

describe('#243 Q25 必需项按事件推导', () => {
  it('每案必有 (1)(2)(4)(19)', () => {
    expect(requirement().requiredItems).toEqual([1, 2, 4, 19]);
    expect(requirement().exemptItems).toEqual([]);
    expect(requirement().deliveryRequired).toBe(false);
  });

  it('走到审理、决定的加 (5)(6)(7)(9)', () => {
    expect(requirement({ reachedReview: true }).requiredItems).toEqual([1, 2, 4, 5, 6, 7, 9, 19]);
  });

  it('进入送达环节后追加 (20)', () => {
    const result = requirement({ reachedReview: true, reachedDelivery: true });
    expect(result.requiredItems).toContain(DOSSIER_DELIVERY_ITEM);
    expect(result.deliveryRequired).toBe(true);
  });

  it('移送管辖、终止调查结案豁免 (5)(6)(7)(9)', () => {
    expect(requirement({ reachedReview: true, terminationClosed: true })).toMatchObject({
      requiredItems: [1, 2, 4, 19],
      exemptItems: [5, 6, 7, 9],
    });
    expect(requirement({ reachedReview: true, jurisdictionTransfer: true }).requiredItems).toEqual([1, 2, 4, 19]);
  });

  it('无依据的豁免项不生效', () => {
    const entries = [
      { itemCode: 5, basis: '规程 13.1' },
      { itemCode: 6, basis: '  ' },
      { itemCode: 7, basis: '' },
      { itemCode: 9, basis: '规程 13.1' },
    ];
    expect(effectiveExemptions(entries).map((entry) => entry.itemCode)).toEqual([5, 9]);
    expect(requirement({ reachedReview: true, terminationClosed: true, exemptions: entries })).toMatchObject({
      requiredItems: [1, 2, 4, 6, 7, 19],
      exemptItems: [5, 9],
    });
  });

  it('交付的豁免清单每项都写明依据', () => {
    for (const entry of DOSSIER_EXEMPTIONS) {
      expect(entry.basis.trim()).not.toBe('');
      expect(DOSSIER_REVIEW_REQUIRED_ITEMS).toContain(entry.itemCode);
    }
  });

  it('由环节实例判定审理与送达事件', () => {
    expect(dossierEventsOf(['E01', 'E02'])).toEqual({ reachedReview: false, reachedDelivery: false });
    expect(dossierEventsOf(['E02', 'E04'])).toEqual({ reachedReview: true, reachedDelivery: false });
    expect(dossierEventsOf(['E04', 'E10'])).toEqual({ reachedReview: true, reachedDelivery: true });
    expect(dossierEventsOf(['E02', 'X99'])).toEqual({ reachedReview: false, reachedDelivery: false });
  });
});

describe('#243 Q27 送达事项接受 A 或 B', () => {
  it('A＝送达回证', () => {
    expect(readDeliveryEvidence({ kind: 'receipt' })).toEqual({ kind: 'receipt' });
    expect(deliveryEvidenceSatisfied({ kind: 'receipt' })).toBe(true);
  });

  it('B＝公告送达的原因经过记录＋公告材料，缺一不可', () => {
    const notice = {
      kind: 'announcement',
      reasonRecord: '当事人下落不明，已公告送达',
      announcementMaterials: ['公告截图.pdf'],
    };
    expect(readDeliveryEvidence(notice)).toMatchObject({ kind: 'announcement' });
    expect(deliveryEvidenceSatisfied(notice)).toBe(true);
    expect(deliveryEvidenceSatisfied({ ...notice, reasonRecord: ' ' })).toBe(false);
    expect(deliveryEvidenceSatisfied({ ...notice, announcementMaterials: [] })).toBe(false);
    expect(deliveryEvidenceSatisfied({ kind: 'announcement', reasonRecord: 'x' })).toBe(false);
  });

  it('未知类型与非法正文不成立', () => {
    expect(deliveryEvidenceSatisfied(null)).toBe(false);
    expect(deliveryEvidenceSatisfied({ kind: 'other' })).toBe(false);
    expect(deliveryEvidenceSatisfied('receipt')).toBe(false);
  });
});

describe('#243 完整性结论', () => {
  it('材料齐全且回证齐全：结论完整', () => {
    const result = evaluateDossierCompleteness({
      requirement: requirement(),
      materials: [1, 2, 4, 19].map((code) => material(code)),
      receiptsComplete: true,
      missingReason: null,
    });
    expect(result.missingItems).toEqual([]);
    expect(result.receiptDeficient).toBe(false);
    expect(result.blocked).toBe(false);
    expect(result.conclusion).toBe('complete');
  });

  it('缺件未写理由：阻断，且结论不得落为完整', () => {
    const result = evaluateDossierCompleteness({
      requirement: requirement(),
      materials: [1, 2, 4].map((code) => material(code)),
      receiptsComplete: true,
      missingReason: null,
    });
    expect(result.missingItems).toEqual([19]);
    expect(result.reasonRequired).toBe(true);
    expect(result.blocked).toBe(true);
    expect(result.conclusion).toBe('approved-missing');
    expect(result.checklist.find((row) => row.itemCode === 19)?.missing).toBe(true);
  });

  it('缺件写了理由：不阻断，结论经批准缺项', () => {
    const result = evaluateDossierCompleteness({
      requirement: requirement(),
      materials: [1, 2, 4].map((code) => material(code)),
      receiptsComplete: true,
      missingReason: '结案呈批表线下留存',
    });
    expect(result.blocked).toBe(false);
    expect(result.conclusion).toBe('approved-missing');
  });

  it('移送回证缺失同样须写理由', () => {
    const result = evaluateDossierCompleteness({
      requirement: requirement(),
      materials: [1, 2, 4, 19].map((code) => material(code)),
      receiptsComplete: false,
      missingReason: null,
    });
    expect(result.receiptDeficient).toBe(true);
    expect(result.blocked).toBe(true);
  });

  it('非当前材料不计入当前卷宗', () => {
    const result = evaluateDossierCompleteness({
      requirement: requirement(),
      materials: [material(1), material(2), material(4), material(19, { current: false })],
      receiptsComplete: true,
      missingReason: null,
    });
    expect(result.missingItems).toEqual([19]);
    expect(result.checklist.find((row) => row.itemCode === 19)).toMatchObject({ present: false, current: false });
  });

  it('送达项按 Q27 校验证据：无效证据等同缺件', () => {
    const base = requirement({ reachedDelivery: true });
    const noEvidence = evaluateDossierCompleteness({
      requirement: base,
      materials: [material(1), material(2), material(4), material(19), material(20)],
      receiptsComplete: true,
      missingReason: null,
    });
    expect(noEvidence.missingItems).toEqual([20]);

    const announcement = evaluateDossierCompleteness({
      requirement: base,
      materials: [
        material(1),
        material(2),
        material(4),
        material(19),
        material(20, {
          evidenceJson: JSON.stringify({
            kind: 'announcement',
            reasonRecord: '下落不明',
            announcementMaterials: ['公告材料.pdf'],
          }),
        }),
      ],
      receiptsComplete: true,
      missingReason: null,
    });
    expect(announcement.missingItems).toEqual([]);
    expect(announcement.conclusion).toBe('complete');
  });
});