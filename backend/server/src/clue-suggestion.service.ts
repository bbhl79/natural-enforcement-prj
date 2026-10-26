// 辖区建议（#214；规格 C 节「辖区建议」、ADR 0021、GLOSSARY「辖区对应」）。
//
// 建议由服务端现算、不自动派：面状逐面与街道镇边界相交后按街道、机构汇总，
// 返回全部候选、占比与街道明细（按占比降序）；点状按包含点位的街道建议。
// 跨区（候选机构分属不同区级机构）给出「分割重传或择一」提示。
// 街道边界服务或辖区对应未就绪（含服务不可用）时返回空建议，不拦手工分派——
// 对应验收保持受阻：服务地址尚未就绪、辖区对应表业务方尚未交付（当前 0 行）。
//
// 辖区对应只存「街道编码 → 机构」：街道边界服务返回的要素标识即街道编码，
// 经 geo_dict_jurisdiction（只追加表，取最新有效版）映射到机构。

import { Inject, Injectable } from '@nestjs/common';

import {
  STREET_BOUNDARY_PORT,
  type ClueDispatchContext,
  type StreetBoundaryPort,
} from '@natural-enforcement/case';
import {
  IDENTITY_STORE,
  type IdentityStore,
  type OrgUnitRow,
} from '@natural-enforcement/identity';
import type { JurisdictionRow } from '@natural-enforcement/geo-dict';

/** 注入令牌：辖区对应查询（街道编码 → 机构），装配在 persistence.module.ts。 */
export const JURISDICTION_LOOKUP = Symbol('JURISDICTION_LOOKUP');

/** 辖区对应查询端口。 */
export interface JurisdictionLookup {
  findByStreetCodes(codes: readonly string[]): Promise<JurisdictionRow[]>;
}

/** 一个街道的明细。 */
export interface SuggestionStreet {
  readonly streetCode: string;
  readonly streetName: string;
  /** 该街道与线索的相交面积（平方米；点状为 0）。 */
  readonly area: number;
  /** 逐面明细（面状）：该街道与线索各面的相交面积；点状为空数组。 */
  readonly faces: readonly { readonly partIndex: number; readonly area: number }[];
}

/** 一个候选机构（辖区建议按机构汇总）。 */
export interface AreaSuggestion {
  readonly orgUnitId: string;
  readonly orgName: string;
  /** 该机构辖区与线索的相交面积合计（平方米；点状为 0）。 */
  readonly area: number;
  /** 占本线索图斑总面积的比例（0..1；点状为 1）。 */
  readonly ratio: number;
  readonly streets: readonly SuggestionStreet[];
}

/** 辖区建议视图。 */
export interface AreaSuggestionView {
  readonly result: 'listed';
  readonly clueId: string;
  readonly code: string;
  readonly kind: 'face' | 'point';
  /** 全部候选，按占比降序。 */
  readonly suggestions: readonly AreaSuggestion[];
  /** 候选机构分属不同区级机构：给「分割重传或择一」提示。 */
  readonly crossDistrict: boolean;
  /** 跨区提示文案；不跨区即 null。 */
  readonly hint: string | null;
  /**
   * 空建议的原因词（连字符小写）：服务未配置/不可用/超时/返回不合规，
   * 或辖区对应未就绪；正常算出建议即 null。
   */
  readonly unavailableReason: string | null;
}

/** 空建议。 */
const NO_SUGGESTION = (clueId: string, code: string, kind: 'face' | 'point', reason: string | null): AreaSuggestionView => ({
  result: 'listed',
  clueId,
  code,
  kind,
  suggestions: [],
  crossDistrict: false,
  hint: null,
  unavailableReason: reason,
});

@Injectable()
export class ClueSuggestionService {
  constructor(
    @Inject(STREET_BOUNDARY_PORT) private readonly street: StreetBoundaryPort,
    @Inject(JURISDICTION_LOOKUP) private readonly jurisdictions: JurisdictionLookup,
    @Inject(IDENTITY_STORE) private readonly identity: IdentityStore,
  ) {}

  /** 现算辖区建议（不含授权；调用方负责 clue.read 授权）。 */
  async buildFor(context: ClueDispatchContext): Promise<AreaSuggestionView> {
    if (context.parts.length === 0) return NO_SUGGESTION(context.clueId, context.code, context.kind, null);
    const outcome = await this.street.query({
      clueId: context.clueId,
      kind: context.kind,
      parts: context.parts.map((part) => ({
        partId: part.partId,
        partIndex: part.partIndex,
        geojson: part.geojson,
      })),
    });
    if (!outcome.ok) return NO_SUGGESTION(context.clueId, context.code, context.kind, outcome.reason);
    // 面状只取相交面积 > 0 的街道；点状返回的街道即包含点位的街道。
    const features =
      context.kind === 'face' ? outcome.features.filter((item) => item.overlapArea > 0) : outcome.features;
    if (features.length === 0) return NO_SUGGESTION(context.clueId, context.code, context.kind, null);
    const rows = await this.jurisdictions.findByStreetCodes(features.map((item) => item.streetCode));
    if (rows.length === 0) {
      // 辖区对应未就绪（当前 0 行）：空建议，不拦手工分派。
      return NO_SUGGESTION(context.clueId, context.code, context.kind, 'jurisdiction-not-ready');
    }
    return this.aggregate(context, features, rows);
  }

  /** 按街道、机构汇总（面状逐面明细；占比 = 机构辖区相交面积 ÷ 图斑总面积）。 */
  private async aggregate(
    context: ClueDispatchContext,
    features: readonly {
      streetCode: string;
      partId: string;
      partIndex: number;
      overlapArea: number;
    }[],
    rows: readonly JurisdictionRow[],
  ): Promise<AreaSuggestionView> {
    const jurisdictionByCode = new Map(rows.map((row) => [row.code, row]));
    const streetAreas = new Map<string, { area: number; faces: Map<number, number> }>();
    for (const feature of features) {
      const entry = streetAreas.get(feature.streetCode) ?? { area: 0, faces: new Map<number, number>() };
      entry.area += feature.overlapArea;
      entry.faces.set(feature.partIndex, (entry.faces.get(feature.partIndex) ?? 0) + feature.overlapArea);
      streetAreas.set(feature.streetCode, entry);
    }
    // 按机构汇总：一个机构可辖多个街道。
    const orgGroups = new Map<string, { row: JurisdictionRow; streets: string[]; area: number }>();
    for (const [streetCode, entry] of streetAreas) {
      const jurisdiction = jurisdictionByCode.get(streetCode);
      if (!jurisdiction) continue; // 辖区对应未覆盖该街道：跳过，不虚构机构。
      const group = orgGroups.get(jurisdiction.orgCode) ?? { row: jurisdiction, streets: [], area: 0 };
      group.streets.push(streetCode);
      group.area += entry.area;
      orgGroups.set(jurisdiction.orgCode, group);
    }
    if (orgGroups.size === 0) {
      return NO_SUGGESTION(context.clueId, context.code, context.kind, 'jurisdiction-not-ready');
    }
    // 机构编码 → 机构行（辖区对应只存机构编码弱引用；展示与分派以机构行准）。
    const orgs = await this.resolveOrgs([...orgGroups.keys()]);
    const suggestions: AreaSuggestion[] = [];
    for (const [orgCode, group] of orgGroups) {
      const org = orgs.get(orgCode);
      if (!org || org.deactivatedAt !== null) continue; // 停用机构不作候选。
      const streets: SuggestionStreet[] = [];
      for (const streetCode of group.streets) {
        const entry = streetAreas.get(streetCode);
        const jurisdiction = jurisdictionByCode.get(streetCode);
        if (!entry || !jurisdiction) continue;
        streets.push({
          streetCode,
          streetName: jurisdiction.name,
          area: entry.area,
          faces: [...entry.faces.entries()]
            .map(([partIndex, area]) => ({ partIndex, area }))
            .sort((left, right) => left.partIndex - right.partIndex),
        });
      }
      streets.sort((left, right) => right.area - left.area);
      if (streets.length === 0) continue;
      const ratio =
        context.kind === 'point' ? 1 : context.totalArea > 0 ? group.area / context.totalArea : 0;
      suggestions.push({
        orgUnitId: org.id,
        orgName: org.name,
        area: group.area,
        ratio,
        streets,
      });
    }
    // 占比降序。
    suggestions.sort((left, right) => right.ratio - left.ratio);
    const crossDistrict = await this.spansDistricts(suggestions.map((item) => item.orgUnitId));
    return {
      result: 'listed',
      clueId: context.clueId,
      code: context.code,
      kind: context.kind,
      suggestions,
      crossDistrict,
      hint: crossDistrict ? '线索跨区：可由各区按街道分割重传，或择一机构办理。' : null,
      unavailableReason: null,
    };
  }

  /** 机构编码 → 机构行（不含下级）。 */
  private async resolveOrgs(orgCodes: readonly string[]): Promise<Map<string, OrgUnitRow>> {
    const rootId = await this.identity.findRootOrgUnitId();
    if (rootId === null) return new Map();
    const all = await this.identity.listOrgUnitSubtree(rootId);
    const byCode = new Map(all.map((org) => [org.code, org]));
    return new Map(orgCodes.map((code) => [code, byCode.get(code)] as const).filter((entry): entry is readonly [string, OrgUnitRow] => entry[1] !== undefined));
  }

  /** 候选机构是否分属不同区级机构（区级 = 机构行 level 'district' 的祖先）。 */
  private async spansDistricts(orgUnitIds: readonly string[]): Promise<boolean> {
    if (orgUnitIds.length <= 1) return false;
    const districts = new Set<string>();
    for (const orgUnitId of orgUnitIds) {
      const path = await this.identity.findOrgUnitPathToRoot(orgUnitId);
      // 根链自根向叶排列，末位是机构自身；取链上最深的区级祖先（即最近的区）。
      let nearest: string | null = null;
      for (const id of path) {
        const org = await this.identity.findOrgUnitById(id);
        if (org?.level === 'district') nearest = id;
      }
      if (nearest !== null) districts.add(nearest);
    }
    return districts.size > 1;
  }
}
