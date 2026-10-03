/** D3 §3.2 材料类型。 */
export const MATERIAL_TYPES = [
  "CASE_DOC",
  "CASE_EVIDENCE",
  "CASE_REPORT",
  "CASE_DELIVERY",
  "SUPERVISION_OPINION",
  "SUPERVISION_WORK",
  "EXTERNAL_SCAN",
  "EXPORT_PACK",
] as const;

export type MaterialType = (typeof MATERIAL_TYPES)[number];
