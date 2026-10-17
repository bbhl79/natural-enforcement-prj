import { Inject, Injectable } from '@nestjs/common';
import { rejected, type AuditEntry } from '@natural-enforcement/audit';
import {
  CredentialService,
  PersonnelProfileService,
  isAccessDenied,
  type ActorRef,
  type CertStatus,
  type DenyReason,
  type PersonnelPost,
  type RegisterPersonnelProfileInput,
  type RegisterRuleCode,
} from '@natural-enforcement/identity';

import { CLOCK, type Clock } from './clock.ts';
import { UNIT_OF_WORK, type UnitOfWork } from './unit-of-work.ts';

type Denial = { status: 403; body: { reason: DenyReason } };
type NonCompliant = { status: 400; body: { result: 'non-compliant'; rules: RegisterRuleCode[] } };

/** 人员列表的一行（接口形状）。不含手机号和执法证号。 */
export interface PersonnelListView {
  id: string;
  code: string;
  name: string;
  orgUnitId: string | null;
  orgName: string | null;
  roles: string[];
  certStatus: CertStatus;
  deactivatedAt: string | null;
}

export type PersonnelListOutcome =
  | {
    status: 200;
    body: {
      result: 'listed';
      rootId: string;
      orgUnits: Array<{ id: string; name: string; parentId: string | null; deactivatedAt: string | null }>;
      personnel: PersonnelListView[];
    };
  }
  | Denial;

/** 人员卡片（接口形状）。手机号完整返回，界面默认遮挡。 */
export interface PersonnelCardView {
  id: string;
  code: string;
  name: string;
  mobilePhone: string | null;
  orgUnitId: string | null;
  orgName: string | null;
  roles: string[];
  posts: PersonnelPost[];
  passwordChangedAt: string | null;
  deactivatedAt: string | null;
  cert: { no: string | null; expiresOn: string | null; status: CertStatus };
}

export type PersonnelCardOutcome =
  | { status: 200; body: { result: 'viewed'; personnel: PersonnelCardView } }
  | { status: 404; body: { result: 'not-found' } }
  | Denial;

export type RegisterPersonnelOutcome =
  | { status: 200; body: { result: 'registered'; personnel: { id: string; code: string; name: string; orgUnitId: string } } }
  | NonCompliant
  | { status: 409; body: { result: 'invalid-state' } }
  | { status: 409; body: { result: 'already-exists'; conflict: 'personnel-code' | 'mobile-phone' } }
  | Denial;

function denial(error: unknown): { outcome: Denial; entry: AuditEntry | null } {
  if (!isAccessDenied(error)) throw error;
  return { outcome: { status: 403, body: { reason: error.reason } }, entry: error.denial };
}

const isoOrNull = (value: Date | null): string | null => value?.toISOString() ?? null;

/** 日历日（UTC 午夜）写成 YYYY-MM-DD。 */
const dayOrNull = (value: Date | null): string | null => value?.toISOString().slice(0, 10) ?? null;

/**
 * 管理台人员（#128）：列表、卡片、登记。
 * 卡片和登记在交互式事务里完成，业务行与留痕同成同败（#119）；
 * 被拒绝的动作经 rejected(...) 回滚，拒绝留痕在回滚后另起事务写入。
 */
@Injectable()
export class PersonnelProfilesService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly profiles: PersonnelProfileService,
    private readonly credentials: CredentialService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async list(actor: ActorRef): Promise<PersonnelListOutcome> {
    try {
      const list = await this.profiles.listPersonnel(actor, this.clock.now());
      return {
        status: 200,
        body: {
          result: 'listed',
          rootId: list.rootId,
          orgUnits: list.orgUnits.map((unit) => ({ ...unit, deactivatedAt: isoOrNull(unit.deactivatedAt) })),
          personnel: list.personnel.map((row) => ({ ...row, deactivatedAt: isoOrNull(row.deactivatedAt) })),
        },
      };
    } catch (error) {
      return denial(error).outcome;
    }
  }

  async card(actor: ActorRef, personnelId: string, sourceIp: string | null): Promise<PersonnelCardOutcome> {
    return this.uow.run<PersonnelCardOutcome>(async (tx) => {
      try {
        const read = await this.profiles.readProfile(actor, personnelId, tx, tx.audit, sourceIp, this.clock.now());
        if (read.result === 'not-found') return { status: 404, body: { result: 'not-found' } };
        const { profile } = read;
        return {
          status: 200,
          body: {
            result: 'viewed',
            personnel: {
              ...profile,
              passwordChangedAt: isoOrNull(profile.passwordChangedAt),
              deactivatedAt: isoOrNull(profile.deactivatedAt),
              cert: { ...profile.cert, expiresOn: dayOrNull(profile.cert.expiresOn) },
            },
          },
        };
      } catch (error) {
        const { outcome, entry } = denial(error);
        return entry ? rejected<PersonnelCardOutcome>(outcome, entry) : outcome;
      }
    });
  }

  async register(
    actor: ActorRef,
    input: RegisterPersonnelProfileInput,
    sourceIp: string | null,
  ): Promise<RegisterPersonnelOutcome> {
    // 第一步：判断能否登记。不合规、越权、机构已停用时直接返回，不散列。
    const checked = await this.uow.run<RegisterPersonnelOutcome | { ready: true }>(async (tx) => {
      try {
        const screened = await this.profiles.screenRegistration(actor, input, tx, sourceIp);
        if (screened.result === 'non-compliant') {
          return { status: 400, body: { result: 'non-compliant', rules: screened.rules } };
        }
        if (screened.result === 'invalid-state') {
          return rejected<RegisterPersonnelOutcome>({ status: 409, body: { result: 'invalid-state' } }, screened.failure);
        }
        return { ready: true };
      } catch (error) {
        const { outcome, entry } = denial(error);
        return entry ? rejected<RegisterPersonnelOutcome>(outcome, entry) : outcome;
      }
    });
    if (!('ready' in checked)) return checked;
    // 口令散列在事务之外计算（#119）。
    const passwordHash = await this.credentials.hashPassword(input.initialPassword);
    // 第二步：重新判断后写入。人员、名称版本、任职、人员—角色、岗位标记与留痕同一事务。
    return this.uow.run<RegisterPersonnelOutcome>(async (tx) => {
      try {
        const outcome = await this.profiles.registerPersonnel(actor, input, passwordHash, tx, tx.audit, sourceIp);
        if (outcome.result === 'non-compliant') {
          return { status: 400, body: { result: 'non-compliant', rules: outcome.rules } };
        }
        if (outcome.result === 'invalid-state') {
          return rejected<RegisterPersonnelOutcome>({ status: 409, body: { result: 'invalid-state' } }, outcome.failure);
        }
        if (outcome.result === 'already-exists') {
          return rejected<RegisterPersonnelOutcome>(
            { status: 409, body: { result: 'already-exists', conflict: outcome.conflict } },
            outcome.failure,
          );
        }
        return { status: 200, body: { result: 'registered', personnel: outcome.personnel } };
      } catch (error) {
        const { outcome, entry } = denial(error);
        return entry ? rejected<RegisterPersonnelOutcome>(outcome, entry) : outcome;
      }
    });
  }
}
