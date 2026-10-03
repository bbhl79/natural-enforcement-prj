import type { AuditEventType } from "../seeds/audit-events";

export interface AuditEvent {
  eventType: AuditEventType;
  actor: string;
}
