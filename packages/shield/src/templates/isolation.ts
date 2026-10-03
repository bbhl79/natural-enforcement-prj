import type { TemplateId } from "./catalog";

/** 硬隔离组。组内两个 templateId 不得混用。 */
export const TEMPLATE_ISOLATION_GROUPS = [
  ["invest.notice", "invest.hearing_notice"],
  ["collab.xfer_police", "collab.xfer_discipline"],
  ["gov.supervision_opinion", "invest.decision"],
  ["invest.decision", "invest.no_penalty"],
] as const satisfies readonly (readonly TemplateId[])[];

export function assertTemplateIsolation(a: TemplateId, b: TemplateId): void {
  if (a === b) {
    return;
  }
  for (const group of TEMPLATE_ISOLATION_GROUPS) {
    const ids: readonly string[] = group;
    if (ids.includes(a) && ids.includes(b)) {
      throw new Error(`分模板隔离：${a} 不得与 ${b} 混用`);
    }
  }
}
