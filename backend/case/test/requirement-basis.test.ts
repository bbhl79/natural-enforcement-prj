// 要件依据勘误的结构测试（#261）。
// 断言来自 #261 验收和 #261 评论 6435475943：不引用已废止文书，尚未施行的文书带施行日。
// 本票不改缺件后果。G194 改前已是警告，本测试把它锁在警告。

import { describe, expect, it } from 'vitest';

import { DOCUMENTS } from '@natural-enforcement/geo-dict';

import {
  CLUE_REQUIREMENT_DECLARATION_VERSION,
  PUBLIC_LAYER_ITEMS,
  SOURCE_LAYER_GROUPS,
  TYPE_LAYER_ITEMS,
  type RequirementItem,
} from '../src/index.ts';

function allItems(): RequirementItem[] {
  return [
    ...PUBLIC_LAYER_ITEMS,
    ...SOURCE_LAYER_GROUPS.flatMap((group) => group.items),
    ...TYPE_LAYER_ITEMS,
  ];
}

function item(key: string): RequirementItem {
  const found = TYPE_LAYER_ITEMS.find((entry) => entry.key === key);
  if (!found) throw new Error(`缺少要件键 ${key}`);
  return found;
}

function articles(key: string, document: string): string[] {
  return item(key)
    .basis.filter((entry) => entry.document === document)
    .map((entry) => entry.article);
}

describe('要件依据勘误（#261）', () => {
  it('声明版本升到 requirements-2026-10-27-01', () => {
    expect(CLUE_REQUIREMENT_DECLARATION_VERSION).toBe('requirements-2026-10-27-01');
  });

  it('声明不引用已废止文书', () => {
    const repealed = new Set<string>(
      DOCUMENTS.filter((document) => document.validityStatus === '已废止').map((document) => document.code),
    );
    expect(repealed.has('doc_052')).toBe(true);
    const hits: string[] = [];
    for (const entry of allItems()) {
      for (const basis of entry.basis) {
        if (repealed.has(basis.document)) hits.push(`${entry.key} ${basis.document}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('尚未施行的文书在文件表说明里带施行日', () => {
    const pending = DOCUMENTS.filter((document) => (document.note ?? '').includes('尚未施行'));
    expect(pending.map((document) => document.code).sort()).toEqual(['doc_021', 'doc_040']);
    for (const document of pending) {
      expect(document.note).toMatch(/2027-01-01/);
    }
  });

  it('doc_008 换成法释〔2023〕8号，doc_052 标已废止', () => {
    const doc008 = DOCUMENTS.find((document) => document.code === 'doc_008');
    const doc052 = DOCUMENTS.find((document) => document.code === 'doc_052');
    expect(doc008?.name).toContain('破坏森林资源');
    expect(doc008?.name).not.toContain('破坏林地资源');
    expect(doc008?.note).toContain('法释〔2023〕8号');
    expect(doc008?.validityStatus).toBe('现行有效');
    expect(doc052?.validityStatus).toBe('已废止');
    expect(doc052?.note).toContain('穗府办规〔2018〕12号');
  });

  it('doc_078 与 doc_013 写入现行文号', () => {
    const doc078 = DOCUMENTS.find((document) => document.code === 'doc_078');
    const doc013 = DOCUMENTS.find((document) => document.code === 'doc_013');
    expect(doc078?.note).toContain('自然资源部令第11号');
    expect(doc013?.note).toContain('自然资发〔2024〕273号');
    const citations = TYPE_LAYER_ITEMS.flatMap((entry) => entry.basis).filter(
      (basis) => basis.document === 'doc_078',
    );
    expect(citations).toHaveLength(116);
  });

  it('G194 保持警告，法释第1条标待法制确认并要求手工理由', () => {
    const key = 'type.land_approve_without_authority.criminal_referral_check';
    expect(item(key).consequence).toBe('警告');
    expect(articles(key, 'doc_008')).toEqual(['第 1 条']);
    expect(item(key).basisNote).toContain('待法制确认');
    expect(item(key).basisNote).toContain('手工理由');
    expect(item(key).basisNote).toContain('刑法第342条');
  });

  it('doc_079 删去第47条，第62条保留，拆开的条号写回第22条第2款和第3款', () => {
    for (const key of [
      'type.mineral_approve_explore_license.approval_defect',
      'type.mineral_approve_mining_license.approval_defect',
    ]) {
      expect(item(key).consequence).toBe('提示');
      expect(articles(key, 'doc_079')).toEqual(['第 62 条']);
      expect(item(key).basisNote).toContain('待法制确认');
      expect(item(key).basis.some((basis) => basis.article === '情形列举')).toBe(false);
    }
    for (const key of [
      'type.mineral_transfer_rights_resale.transfer_registered',
      'type.mineral_transfer_rights_unapproved.transfer_registered',
      'type.mineral_transfer_mining_by_contract.transfer_registered',
    ]) {
      expect(item(key).consequence).toBe('警告');
      expect(articles(key, 'doc_079')).toEqual(['第 22 条第 2 款', '第 22 条第 3 款']);
    }
    expect(item('type.mineral_explore_without_license_or_overstep.explore_situation').basisNote).toBe('与罚则分流');
    expect(item('type.mineral_mine_without_license.mine_situation').basisNote).toBe('与罚则分流');
    expect(item('type.mineral_explore_without_license_or_overstep.explore_situation').consequence).toBe('阻断');
    expect(item('type.mineral_mine_without_license.mine_situation').consequence).toBe('阻断');
  });

  it('规程错条号改为 8.4.2(5)⑥，九处空条号已删', () => {
    const moved = [
      'type.survey_result_not_submitted.qualification_cert_no',
      'type.survey_result_not_submitted.suspension_six_months',
      'type.survey_secret_geo_info_no_register.qualification_cert_no',
      'type.survey_quality_unqualified.qualification_cert_no',
    ];
    for (const key of moved) {
      expect(articles(key, 'doc_002')).toContain('8.4.2(5)⑥');
      expect(articles(key, 'doc_002')).not.toContain('8.4.1(5)⑥');
    }
    const emptied = [
      'type.land_approve_illegal_procedure.procedure_steps',
      'type.land_approve_illegal_procedure.compensation_agreement',
      'type.land_approve_illegal_procedure.compensation_payment_voucher',
      'type.land_illegal_supply.supply_mode',
      'type.land_illegal_supply.supply_policy_category',
      'type.land_permanent_farmland_nonfarm.correction_record',
      'type.survey_datum_coord_system_unapproved.criminal_referral_check',
      'type.survey_gnss_station_no_filing.criminal_referral_check',
      'type.survey_basic_project_nonstandard_datum.criminal_referral_check',
    ];
    for (const key of emptied) {
      expect(item(key).basis.some((basis) => basis.document === 'doc_002' && basis.article === '')).toBe(false);
    }
    expect(articles('type.land_illegal_supply.supply_policy_category', 'doc_013')).toEqual(['第二点']);
    expect(articles('type.land_illegal_supply.supply_policy_category', 'doc_012')).toEqual(['']);
  });

  it('地图条例与名城条例去掉不存在的款号', () => {
    expect(articles('type.survey_internet_map_service_unapproved.cross_dept_report', 'doc_030')).toContain('第 36 条');
    expect(articles('type.survey_internet_map_upload_prohibited.platform_duty', 'doc_030')).toEqual(['第 36 条']);
    expect(articles('type.survey_internet_map_upload_prohibited.cross_dept_report', 'doc_030')).toContain('第 36 条');
    for (const key of [
      'type.survey_internet_map_service_unapproved.cross_dept_report',
      'type.survey_internet_map_upload_prohibited.platform_duty',
      'type.survey_internet_map_upload_prohibited.cross_dept_report',
    ]) {
      expect(articles(key, 'doc_030').some((article) => article.includes('第 2 款'))).toBe(false);
      expect(item(key).consequence).toBe('提示');
    }
    expect(articles('type.planning_build_without_permit.build_stage', 'doc_068')).toContain('第 26 条');
    expect(articles('type.planning_build_without_permit.build_stage', 'doc_068')).not.toContain('第 26 条第 2 款');
    expect(articles('type.planning_temporary_build.build_stage', 'doc_068')).toEqual(['第 26 条']);
    expect(item('type.planning_build_without_permit.build_stage').consequence).toBe('警告');
    expect(item('type.planning_temporary_build.build_stage').consequence).toBe('警告');
  });

  it('查不到的键保持原后果并在 basisNote 标待法制确认', () => {
    const rows: Array<[string, string]> = [
      ['type.survey_secret_geo_info_no_register.license_record', '警告'],
      ['type.survey_secret_geo_info_no_register.management_system', '警告'],
      ['type.survey_custodian_damage_loss.custodian_designation', '警告'],
      ['type.survey_custodian_refuse_provide.custodian_designation', '提示'],
      ['type.survey_custodian_refuse_provide.secret_approval', '提示'],
      ['type.land_reclaim_obligation.agri_dept_opinion', '警告'],
    ];
    for (const [key, consequence] of rows) {
      expect(item(key).consequence).toBe(consequence);
      expect(item(key).basisNote).toContain('待法制确认');
    }
    expect(articles('type.survey_secret_geo_info_no_register.license_record', 'doc_045')).toEqual([]);
    expect(articles('type.survey_custodian_refuse_provide.secret_approval', 'doc_045')).toEqual([]);
    expect(articles('type.survey_secret_geo_info_no_register.management_system', 'doc_047')).toEqual([]);
    expect(articles('type.survey_custodian_damage_loss.custodian_designation', 'doc_052')).toEqual([]);
    expect(articles('type.survey_custodian_refuse_provide.custodian_designation', 'doc_052')).toEqual([]);
  });

  it('doc_021 与 doc_040 保留引用并标注 2027-01-01，阻断键不改后果', () => {
    expect(item('type.land_reclaim_obligation.agri_dept_opinion').basisNote).toContain('2027-01-01');
    const blocking = [
      'type.survey_result_not_submitted.acceptance_date',
      'type.survey_result_not_submitted.deadline_expiry',
      'type.survey_result_not_submitted.submission_content',
      'type.survey_result_not_submitted.is_basic_survey',
    ];
    for (const key of blocking) {
      expect(item(key).consequence).toBe('阻断');
      expect(item(key).basisNote).toContain('2027-01-01');
      expect(item(key).basisNote).toContain('尚未施行');
      expect(item(key).basis.some((basis) => basis.document === 'doc_040')).toBe(true);
    }
  });
});
