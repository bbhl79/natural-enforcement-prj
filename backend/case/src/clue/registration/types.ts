// 线索登记的领域类型（#211；ADR 0018「一份声明，两个用途」）。
// 本目录是纯规则：要件叠加后的缺件判定、几何解析、附件真实内容校验、幂等摘要。
// 不碰数据库、不碰存储、不碰 HTTP：形状一律由纯函数给出，装配在启动包（ADR 0004）。

import type { Domain, RequirementConsequence, RequirementTiming } from '../requirements/types.ts';

/** 表单取值：要件键 → 文本取值。缺键即没填。 */
export type ClueFormValues = Readonly<Record<string, string>>;

/** 要件层。类型层要件键以 `type.` 开头（ADR 0020）。 */
export type ClueLayer = 'public' | 'source' | 'type';

/** 一项缺件。 */
export interface ClueGap {
  /** 要件键。 */
  readonly key: string;
  /** 中文要件名（界面显示名）。 */
  readonly label: string;
  /** 层。 */
  readonly layer: ClueLayer;
  /** 是否必填。 */
  readonly required: boolean;
  /** 必填时机。 */
  readonly timing: RequirementTiming;
  /** 缺件后果。 */
  readonly consequence: RequirementConsequence;
}

/**
 * 缺件判定结果。
 * - blocking：公共层与来源层的阻断项缺失 → 阻断登记（400 non-compliant + 失败留痕）。
 * - typeGaps：类型层缺件 → 不阻断登记，确认后保存为常驻事实（缺件清单落库）。
 */
export interface ClueGapAssessment {
  readonly blocking: readonly ClueGap[];
  readonly typeGaps: readonly ClueGap[];
}

/** 登记用的法域。 */
export type { Domain };
