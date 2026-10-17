import { Inject, Injectable } from '@nestjs/common';
import { AUDIT_TRAIL_PORT, type AuditTrailPort } from '@natural-enforcement/audit';
import {
  AccessControlService,
  CredentialService,
  isAccessDenied,
  rejectedPasswordRules,
  type ActorRef,
  type DenyReason,
  type PasswordRuleCode,
} from '@natural-enforcement/identity';

import { AuthService } from './auth.service.ts';
import { CLOCK, type Clock } from './clock.ts';
import { LOGIN_DIRECTORY, type LoginDirectory } from './login-directory.ts';
import { REMEMBER_ME_STORE, type RememberMeStore } from './remember-me-store.ts';

const LOCKED_READ = 'personnel.locked.read';
const LOCKED_RELEASE = 'personnel.locked.release';
const PASSWORD_RESET = 'personnel.password.reset';

export type AdminDenial = { status: 403; body: { reason: DenyReason } };

export type ResetOutcome =
  | { status: 200; body: { result: 'reset' } }
  | { status: 400; body: { result: 'non-compliant'; rules: PasswordRuleCode[] } }
  | { status: 404; body: { result: 'not-found' } }
  | AdminDenial;

export type UnlockOutcome =
  | { status: 200; body: { result: 'unlocked' } }
  | { status: 404; body: { result: 'not-found' } }
  | AdminDenial;

export type LockedListOutcome = {
  status: number;
  body:
    | {
        result: 'listed';
        personnel: Array<{
          id: string;
          code: string;
          name: string;
          orgName: string | null;
          lockedUntil: string;
        }>;
      }
    | { reason: DenyReason };
};

@Injectable()
export class AdminService {
  constructor(
    @Inject(LOGIN_DIRECTORY) private readonly directory: LoginDirectory,
    @Inject(AUDIT_TRAIL_PORT) private readonly audit: AuditTrailPort,
    @Inject(REMEMBER_ME_STORE) private readonly remember: RememberMeStore,
    private readonly access: AccessControlService,
    private readonly credentials: CredentialService,
    private readonly auth: AuthService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async listLocked(actor: ActorRef): Promise<LockedListOutcome> {
    const account = await this.directory.findById(actor.personnelId);
    try {
      await this.access.authorize(actor, LOCKED_READ, account?.orgUnitId ?? '');
    } catch (error) {
      if (!isAccessDenied(error)) throw error;
      return { status: 403, body: { reason: error.reason } };
    }
    const scope = new Set(await this.access.listDataScopeOrgUnitIds(actor.personnelId));
    const atRoot = account?.orgUnitId != null && await this.directory.isRootOrg(account.orgUnitId);
    const rows = await this.directory.listLocked(this.clock.now());
    const personnel = rows
      .filter((row) => (row.orgUnitId == null ? atRoot : scope.has(row.orgUnitId)))
      .map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        orgName: row.orgName,
        lockedUntil: row.lockedUntil.toISOString(),
      }));
    return { status: 200, body: { result: 'listed', personnel } };
  }

  async unlock(actor: ActorRef, personnelId: string, sourceIp: string | null): Promise<UnlockOutcome> {
    const target = await this.directory.findById(personnelId);
    if (!target) return { status: 404, body: { result: 'not-found' } };
    const allowed = await this.allow(actor, LOCKED_RELEASE, target);
    if (allowed) return allowed;
    if (target.id === actor.personnelId) return this.denySelf(actor, LOCKED_RELEASE, target.id);
    const admin = await this.directory.findById(actor.personnelId);
    await this.directory.clearFailure(target.id);
    await this.audit.append({
      action: 'account.unlocked',
      actorId: actor.personnelId,
      actorCode: admin?.code ?? null,
      subjectPersonnelId: target.id,
      subjectCode: target.code,
      orgUnitId: target.orgUnitId,
      sourceIp,
    });
    return { status: 200, body: { result: 'unlocked' } };
  }

  async resetPassword(
    actor: ActorRef,
    personnelId: string,
    password: string,
    sourceIp: string | null,
  ): Promise<ResetOutcome> {
    const target = await this.directory.findById(personnelId);
    if (!target) return { status: 404, body: { result: 'not-found' } };
    const allowed = await this.allow(actor, PASSWORD_RESET, target);
    if (allowed) return allowed;
    if (target.id === actor.personnelId) return this.denySelf(actor, PASSWORD_RESET, target.id);
    const rules = rejectedPasswordRules({ password, personnelCode: target.code });
    if (rules.length > 0) return { status: 400, body: { result: 'non-compliant', rules } };
    const now = this.clock.now();
    const wasLocked = target.lockedUntil != null && now.getTime() < target.lockedUntil.getTime();
    const admin = await this.directory.findById(actor.personnelId);
    await this.directory.applyInitialPassword(target.id, await this.credentials.hashPassword(password));
    const parties = {
      actorId: actor.personnelId,
      actorCode: admin?.code ?? null,
      subjectPersonnelId: target.id,
      subjectCode: target.code,
      orgUnitId: target.orgUnitId,
      sourceIp,
    };
    await this.audit.append({ action: 'account.password-reset', ...parties });
    if (wasLocked) await this.audit.append({ action: 'account.unlocked', ...parties });
    await this.auth.endPersonnelSessions({
      personnelId: target.id,
      actorId: actor.personnelId,
      actorCode: admin?.code ?? '',
      sourceIp,
    });
    await this.remember.endActiveForPersonnel(target.id, now, 'admin-ended');
    return { status: 200, body: { result: 'reset' } };
  }

  private async denySelf(actor: ActorRef, opcode: string, targetId: string): Promise<AdminDenial> {
    const admin = await this.directory.findById(actor.personnelId);
    await this.audit.append({
      action: 'authz.denied',
      outcome: 'failed',
      actorId: actor.personnelId,
      actorCode: admin?.code ?? null,
      subjectPersonnelId: null,
      subjectCode: null,
      orgUnitId: admin?.orgUnitId ?? null,
      sourceIp: null,
      reason: 'permission-denied',
      opcode,
      resourceType: 'personnel',
      resourceId: targetId,
      previousValue: null,
    });
    return { status: 403, body: { reason: 'permission-denied' } };
  }

  /** 先按操作码和数据范围判断。通过且目标是本人时，调用方再拒绝。 */
  private async allow(
    actor: ActorRef,
    opcode: string,
    target: { id: string; orgUnitId: string | null },
  ): Promise<AdminDenial | null> {
    const targetOrg = target.orgUnitId ?? await this.directory.rootOrgId();
    if (!targetOrg) return { status: 403, body: { reason: 'scope-denied' } };
    try {
      await this.access.authorize(actor, opcode, targetOrg, {
        resourceType: 'personnel',
        resourceId: target.id,
      });
      return null;
    } catch (error) {
      if (!isAccessDenied(error)) throw error;
      return { status: 403, body: { reason: error.reason } };
    }
  }
}
