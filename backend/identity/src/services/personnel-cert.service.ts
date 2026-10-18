// 执法证登记（#105「执法证（#85）」，#133）。
// 授权经 AccessControlService 按操作码判断：personnel.cert.update，只给系统管理。
// 判定顺序照人员登记：先过授权（越权 403），再校验（400，不写留痕），再写库。
// 登记在调用方的交互式事务里执行：人员行的证号、有效期、证件状态与留痕同成同败（#119）。
// 留痕写 cert.updated，前值只写旧有效期和旧状态，不写证号（#105:232、ADR 0011）。
// 被拒时只抛错，不在事务里写失败留痕：拒绝行交给调用方 rejected(...)，回滚后另起事务写入。
// 不入库：发证单位、执法区域、照片、执法权来源。不建资格版本表。

import { Injectable } from '@nestjs/common';
import type { AuditTrailPort } from '@natural-enforcement/audit';

import { AccessDeniedError } from '../domain/access.ts';
import type { ActorRef } from '../domain/actor.ts';
import {
  PERSONNEL_CERT_UPDATE_OPCODE,
  certPreviousValue,
  certUpdateRules,
  normalizeCertUpdate,
  type CertRuleCode,
  type UpdateCertInput,
} from '../domain/personnel-profile.ts';
import type { IdentityTransaction } from '../persistence/identity-store.ts';
import { AccessControlService, type AuthorizationDecision } from './access-control.service.ts';

export type UpdateCertResult =
  | { result: 'updated' }
  | { result: 'not-found' }
  | { result: 'non-compliant'; rules: CertRuleCode[] };

function raiseDenied(decision: Extract<AuthorizationDecision, { allowed: false }>): never {
  throw new AccessDeniedError(decision.reason, decision.detail, decision.denial);
}

@Injectable()
export class PersonnelCertService {
  constructor(private readonly access: AccessControlService) {}

  /**
   * 逐条登记证号、有效期、证件状态（#105 故事 54、55）。换发新证直接改成新证号和新有效期。
   * 数据范围锚点 = 对方当前任职机构；没有当前任职视同根机构（A10 口径）。
   * 对方不存在返回 not-found，不写留痕。被拒抛 AccessDeniedError，denial 非空，由调用方回滚后写入。
   */
  async updateCert(
    actor: ActorRef,
    personnelId: string,
    input: UpdateCertInput,
    tx: IdentityTransaction,
    audit: AuditTrailPort,
    sourceIp: string | null = null,
  ): Promise<UpdateCertResult> {
    const target = await tx.store.findPersonnelProfile(personnelId);
    if (!target) return { result: 'not-found' };
    const current = await tx.store.findCurrentAssignment(target.id);
    const anchor = current?.orgUnitId ?? (await tx.store.findRootOrgUnitId()) ?? '';
    const decision = await this.access.check(actor, PERSONNEL_CERT_UPDATE_OPCODE, anchor, {
      resourceType: 'personnel',
      resourceId: target.id,
    }, tx.store);
    if (!decision.allowed) raiseDenied(decision);

    const rules = certUpdateRules(input);
    if (rules.length > 0) return { result: 'non-compliant', rules };
    const value = normalizeCertUpdate(input);
    if (!value) throw new Error(`执法证登记输入过了规则却解析不出取值：人员 ${personnelId}`);

    // 前值取写入之前的旧有效期和旧状态；证号不进任何一列（#105:232）。
    const previousValue = certPreviousValue(target.enforcementCertExpiresOn, target.enforcementCertStatus);
    const actorCode = (await tx.store.findPersonnelById(actor.personnelId))?.code ?? null;
    await tx.store.updatePersonnelCert(target.id, value);
    await audit.append({
      action: 'cert.updated',
      actorId: actor.personnelId,
      actorCode,
      subjectPersonnelId: target.id,
      subjectCode: target.code,
      orgUnitId: current?.orgUnitId ?? null,
      sourceIp,
      opcode: PERSONNEL_CERT_UPDATE_OPCODE,
      resourceType: 'personnel',
      resourceId: target.id,
      previousValue,
    });
    return { result: 'updated' };
  }
}
