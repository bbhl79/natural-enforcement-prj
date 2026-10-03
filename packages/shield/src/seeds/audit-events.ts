/** D3 §11 eventType。只留键。 */
export const AUDIT_EVENT_TYPES = [
  "assign.changed",
  "dossier.ingest",
  "invest.decide",
  "cfg.changed",
  "copilot.level_change",
  "copilot.block_denied",
  "authz.denied",
] as const;

export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];
