// 退回事实（#238）。只读人员停用与当前任职。
// 不读机构停用，不放宽机构层「有未办结案件不让停用」。

import {
  legalReviewAttributionOrgId,
  type HandlerAvailability,
  type LegalReviewOrgFact,
  type ReceiverCandidate,
} from '@natural-enforcement/case';
import {
  isOrgUnitLevel,
  type AccessControlService,
  type IdentityStore,
  type OrgUnitRow,
} from '@natural-enforcement/identity';

export interface NamedHandler {
  readonly personnelId: string;
  readonly role: string;
}

function asHandlerRole(role: string): 'main' | 'assist' | null {
  if (role === 'main' || role === 'assist') return role;
  return null;
}

async function personFacts(
  identity: IdentityStore,
  personnelId: string,
  handlingOrgId: string,
): Promise<{ readonly deactivated: boolean; readonly transferredAway: boolean; readonly assignedOrgId: string | null } | null> {
  const person = await identity.findPersonnelById(personnelId);
  if (!person) return null;
  const assignment = await identity.findCurrentAssignment(personnelId);
  return {
    deactivated: person.deactivatedAt != null,
    transferredAway: assignment == null || assignment.orgUnitId !== handlingOrgId,
    assignedOrgId: assignment?.orgUnitId ?? null,
  };
}

/** 主办、协办是否停用或调离。缺人记为不可用，但不凭空补一条。 */
export async function loadHandlerAvailability(
  identity: IdentityStore,
  handlingOrgId: string,
  handlers: readonly NamedHandler[],
): Promise<HandlerAvailability[]> {
  const rows: HandlerAvailability[] = [];
  for (const handler of handlers) {
    const role = asHandlerRole(handler.role);
    if (!role) continue;
    const facts = await personFacts(identity, handler.personnelId, handlingOrgId);
    rows.push({
      personnelId: handler.personnelId,
      role,
      deactivated: facts?.deactivated ?? true,
      transferredAway: facts?.transferredAway ?? true,
    });
  }
  return rows;
}

function asOrgFact(row: OrgUnitRow | null): LegalReviewOrgFact | null {
  if (!row || !isOrgUnitLevel(row.level)) return null;
  return { id: row.id, level: row.level, parentId: row.parentId };
}

/** 承办机构的法制审核归属。机构缺失或所的上级不是区时为空。 */
async function attributionOrgId(identity: IdentityStore, handlingOrgId: string): Promise<string | null> {
  const handling = asOrgFact(await identity.findOrgUnitById(handlingOrgId));
  if (!handling) return null;
  const parent = handling.parentId ? asOrgFact(await identity.findOrgUnitById(handling.parentId)) : null;
  return legalReviewAttributionOrgId(handling, parent);
}

/** 接收人候选。人员不存在时返回 null。 */
export async function loadReceiverCandidate(
  identity: IdentityStore,
  access: AccessControlService,
  handlingOrgId: string,
  personnelId: string,
  handlers: readonly NamedHandler[],
): Promise<ReceiverCandidate | null> {
  const facts = await personFacts(identity, personnelId, handlingOrgId);
  if (!facts) return null;
  const roles = await identity.listActiveRoleNames(personnelId);
  const matched = handlers.find((handler) => handler.personnelId === personnelId);
  const scope = await access.listDataScopeOrgUnitIds(personnelId);
  const attributionId = await attributionOrgId(identity, handlingOrgId);
  return {
    personnelId,
    roles,
    handlerRole: matched ? asHandlerRole(matched.role) : null,
    deactivated: facts.deactivated,
    transferredAway: facts.transferredAway,
    orgCoversCase: scope.includes(handlingOrgId),
    legalReviewAttributed:
      attributionId !== null && facts.assignedOrgId === attributionId && !facts.deactivated,
    clerkOfHandlingOrg: roles.includes('内勤') && facts.assignedOrgId === handlingOrgId && !facts.deactivated,
  };
}
