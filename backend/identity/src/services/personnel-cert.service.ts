// 执法证登记（#105「执法证（#85）」，#133）。
// 授权经 AccessControlService 按操作码判断：personnel.cert.update，只给系统管理。
// 判定顺序照人员登记：先过授权（越权 403），再校验（400，不写留痕），再写库。
// 登记在调用方的交互式事务里执行：人员行的证号、有效期、证件状态与留痕同成同败（#119）。
// 留痕写 cert.updated，前值只写旧有效期和旧状态，不写证号（#105:232、ADR 0011）。
// 被拒时只抛错，不在事务里写失败留痕：拒绝行交给调用方 rejected(...)，回滚后另起事务写入。
// 不入库：发证单位、执法区域、照片、执法权来源。不建资格版本表。

import { Injectable } from '@nestjs/common';
import type { AuditAppend, AuditTrailPort } from '@natural-enforcement/audit';

import { AccessDeniedError } from '../domain/access.ts';
import type { ActorRef } from '../domain/actor.ts';
import {
  PERSONNEL_CERT_UPDATE_OPCODE,
  PERSONNEL_DEACTIVATED_REASON,
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
  | { result: 'non-compliant'; rules: CertRuleCode[] }
  /** 对方已停用（409，#158 定口径）：failure 是 cert.updated 的失败留痕行，由调用方回滚后写入。 */
  | { result: 'personnel-deactivated'; failure: AuditAppend };

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

    // 人员级事务锁 + 锁内重读（#129 先例）：与停用该人员串行，停用后不再接受执法证改动。
    const locked = await tx.store.lockPersonnelProfile(personnelId);
    if (!locked) return { result: 'not-found' };
    const actorCode = (await tx.store.findPersonnelById(actor.personnelId))?.code ?? null;
    // 前值取写入之前的旧有效期和旧状态；证号不进任何一列（#105:232）。
    const previousValue = certPreviousValue(locked.enforcementCertExpiresOn, locked.enforcementCertStatus);
    // 停用即离职（#158 业主拍板）：执法证登记与修改一律拒绝，按项写一行失败留痕。
    if (locked.deactivatedAt) {
      return {
        result: 'personnel-deactivated',
        failure: {
          action: 'cert.updated',
          outcome: 'failed',
          reason: PERSONNEL_DEACTIVATED_REASON,
          actorId: actor.personnelId,
          actorCode,
          subjectPersonnelId: locked.id,
          subjectCode: locked.code,
          orgUnitId: current?.orgUnitId ?? null,
          sourceIp,
          opcode: PERSONNEL_CERT_UPDATE_OPCODE,
          resourceType: 'personnel',
          resourceId: locked.id,
          previousValue,
        },
      };
    }

    await tx.store.updatePersonnelCert(locked.id, value);
    await audit.append({
      action: 'cert.updated',
      actorId: actor.personnelId,
      actorCode,
      subjectPersonnelId: locked.id,
      subjectCode: locked.code,
      orgUnitId: current?.orgUnitId ?? null,
      sourceIp,
      opcode: PERSONNEL_CERT_UPDATE_OPCODE,
      resourceType: 'personnel',
      resourceId: locked.id,
      previousValue,
    });
    return { result: 'updated' };
  }
}
