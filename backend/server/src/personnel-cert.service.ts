import { Inject, Injectable } from '@nestjs/common';
import { rejected } from '@natural-enforcement/audit';
import {
  PersonnelCertService,
  isAccessDenied,
  type ActorRef,
  type CertRuleCode,
  type DenyReason,
  type UpdateCertInput,
} from '@natural-enforcement/identity';

import { UNIT_OF_WORK, type UnitOfWork } from './unit-of-work.ts';

type Denial = { status: 403; body: { reason: DenyReason } };

/**
 * 执法证登记的返回（#133）。返回体不回显证号：界面保存后重新取卡片。
 * 400 只在校验不过时出现，不写留痕；403 写 authz.denied（回滚后另起事务）。
 */
export type UpdateCertOutcome =
  | { status: 200; body: { result: 'updated' } }
  | { status: 404; body: { result: 'not-found' } }
  | { status: 400; body: { result: 'non-compliant'; rules: CertRuleCode[] } }
  | Denial;

/**
 * 管理台执法证（#133）：在人员卡片上逐条登记证号、有效期、证件状态。
 * 业务行与留痕在同一个交互式事务里完成（#119）；被拒绝的动作经 rejected(...) 回滚，
 * 拒绝留痕在回滚后另起事务写入。
 */
@Injectable()
export class PersonnelCertsService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly certs: PersonnelCertService,
  ) {}

  async update(
    actor: ActorRef,
    personnelId: string,
    input: UpdateCertInput,
    sourceIp: string | null,
  ): Promise<UpdateCertOutcome> {
    return this.uow.run<UpdateCertOutcome>(async (tx) => {
      try {
        const outcome = await this.certs.updateCert(actor, personnelId, input, tx, tx.audit, sourceIp);
        if (outcome.result === 'not-found') return { status: 404, body: { result: 'not-found' } };
        if (outcome.result === 'non-compliant') {
          return { status: 400, body: { result: 'non-compliant', rules: outcome.rules } };
        }
        return { status: 200, body: { result: 'updated' } };
      } catch (error) {
        if (!isAccessDenied(error)) throw error;
        const denial: Denial = { status: 403, body: { reason: error.reason } };
        return error.denial ? rejected<UpdateCertOutcome>(denial, error.denial) : denial;
      }
    });
  }
}
