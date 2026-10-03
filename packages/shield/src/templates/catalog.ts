/** D3 §4 已点名的 templateId。分模板隔离见 isolation.ts。 */
export const TEMPLATE_IDS = [
  "invest.notice",
  "invest.hearing_notice",
  "invest.hearing_session_notice",
  "invest.hearing_minutes",
  "invest.hearing_report",
  "invest.investigation_report",
  "invest.decision_approval",
  "invest.decision",
  "invest.no_penalty",
  "invest.legal_review",
  "invest.collective",
  "collab.xfer_police",
  "collab.xfer_discipline",
  "collab.delivery_receipt",
  "collab.delivery_address_confirm",
  "gov.supervision_opinion",
  "exec.urge",
  "exec.court_enforce_apply",
  "case.filing_approval",
] as const;

export type TemplateId = (typeof TEMPLATE_IDS)[number];
