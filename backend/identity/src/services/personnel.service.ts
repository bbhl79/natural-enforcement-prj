// 人员服务（#52）：登记 / 改名（名称版本化）/ 调岗 / 失效 / 读 / 导出——
// 每个动作都先经 AccessControlService 重新校验身份、权限、数据范围；
// 导出必产生 append-only 留痕（谁在何时导出了什么范围、多少行）。

import { Inject, Injectable } from '@nestjs/common';

import { IDENTITY_MAINTENANCE_OPCODE } from '../domain/access.ts';
import { AlreadyExistsError } from '../domain/already-exists.ts';
import type { ActorRef } from '../domain/actor.ts';
import { newUlid } from '../domain/ulid.ts';
import type {
  ExportAuditRow,
  IdentityTransaction,
  PersonnelRow,
} from '../persistence/identity-store.ts';
import { IDENTITY_STORE, type IdentityStore } from '../persistence/identity-store.ts';
import { AccessControlService } from './access-control.service.ts';
import { CredentialService } from './credential.service.ts';

export interface RegisterPersonnelInput {
  code: string;
  name: string;
  orgUnitId: string;
  /** 初始口令；null = 无口令字段（散列走 CredentialService / argon2） */
  initialPassword?: string | null;
}

export interface PersonnelDetail extends PersonnelRow {
  currentOrgUnitId: string;
}

export interface ExportResult {
  audit: ExportAuditRow;
  personnel: PersonnelRow[];
}

@Injectable()
export class PersonnelService {
  constructor(
    @Inject(IDENTITY_STORE) private readonly store: IdentityStore,
    private readonly access: AccessControlService,
    private readonly credential: CredentialService,
  ) {}

  /** 人员登记：目标机构须在数据范围内；名称落当前行 + v1 版本行，建立首条任职。角色另经人员—角色写入。 */
  async registerPersonnel(actor: ActorRef, input: RegisterPersonnelInput): Promise<PersonnelDetail> {
    await this.access.authorize(actor, IDENTITY_MAINTENANCE_OPCODE, input.orgUnitId);
    const id = newUlid();
    const passwordHash = input.initialPassword
      ? await this.credential.hashPassword(input.initialPassword)
      : null;
    const inserted = await this.store.insertPersonnel({
      id,
      code: input.code,
      name: input.name,
      orgUnitId: input.orgUnitId,
      passwordHash,
    });
    if (inserted.result === 'already-exists') throw new AlreadyExistsError(inserted.conflict);
    await this.store.insertPersonnelNameVersion({
      id: newUlid(),
      personnelId: id,
      name: input.name,
      version: 1,
      createdAt: new Date(),
    });
    await this.store.insertAssignment({
      id: newUlid(),
      personnelId: id,
      orgUnitId: input.orgUnitId,
      startedAt: new Date(),
      endedAt: null,
    });
    return this.detail(id);
  }

  /** 人员改名 = 新版本行（append-only）+ 更新当前名 */
  async renamePersonnel(actor: ActorRef, personnelId: string, newName: string): Promise<void> {
    await this.access.authorize(
      actor,
      IDENTITY_MAINTENANCE_OPCODE,
      await this.access.currentOrgOf(personnelId),
    );
    const versions = await this.store.listPersonnelNameVersions(personnelId);
    const nextVersion = (versions.at(-1)?.version ?? 0) + 1;
    await this.store.insertPersonnelNameVersion({
      id: newUlid(),
      personnelId,
      name: newName,
      version: nextVersion,
      createdAt: new Date(),
    });
    await this.store.updatePersonnelCurrentName(personnelId, newName);
  }

  /**
   * 调岗：旧任职记录闭环 + 新任职建立 + 当前归属迁移。
   * 数据范围锚点 = 该人员「现属」机构（须归 actor 管辖）；目的地不限——
   * 调岗正是跨机构动作。调岗完成后该人员数据范围随新任职生效，旧机构权限即失效（E2 证据）。
   *
   * 交互式事务（#119）：传入 tx 时并入调用方的事务，与调用方随后追加的留痕同成同败；
   * 不传时自开一个事务。授权在事务之外判断，拒绝留痕不随业务事务回滚。
   */
  async transferPersonnel(
    actor: ActorRef,
    personnelId: string,
    toOrgUnitId: string,
    tx?: IdentityTransaction,
  ): Promise<void> {
    const fromOrgUnitId = await this.access.currentOrgOf(personnelId);
    await this.access.authorize(actor, IDENTITY_MAINTENANCE_OPCODE, fromOrgUnitId);
    const write = async ({ store }: IdentityTransaction): Promise<void> => {
      const current = await store.findCurrentAssignment(personnelId);
      if (!current) {
        // currentOrgOf 已兜底，此处仅类型收窄
        throw new Error(`人员 ${personnelId} 无生效任职，无法调岗`);
      }
      const now = new Date();
      await store.transferAssignment({
        closedAssignmentId: current.id,
        endedAt: now,
        personnelId,
        toOrgUnitId,
        next: {
          id: newUlid(),
          personnelId,
          orgUnitId: toOrgUnitId,
          startedAt: now,
          endedAt: null,
        },
      });
    };
    if (tx) await write(tx);
    else await this.store.inTransaction(write);
  }

  /** 人员失效：只置失效标记 + 失效时间，无物理删除路径 */
  async deactivatePersonnel(actor: ActorRef, personnelId: string): Promise<void> {
    await this.access.authorize(
      actor,
      IDENTITY_MAINTENANCE_OPCODE,
      await this.access.currentOrgOf(personnelId),
    );
    await this.store.deactivatePersonnel(personnelId, new Date());
  }

  /** 读人员：数据范围 = 该人员现属机构 */
  async getPersonnel(actor: ActorRef, personnelId: string): Promise<PersonnelDetail> {
    await this.access.authorize(
      actor,
      IDENTITY_MAINTENANCE_OPCODE,
      await this.access.currentOrgOf(personnelId),
    );
    return this.detail(personnelId);
  }

  /** 导出人员清单：先校验，后写导出留痕——留痕写入即不可删改（触发器兜底） */
  async exportPersonnel(actor: ActorRef, orgUnitId: string): Promise<ExportResult> {
    const context = await this.access.authorize(actor, IDENTITY_MAINTENANCE_OPCODE, orgUnitId);
    const rows = await this.store.listActivePersonnelOfOrgUnit(orgUnitId);
    const audit: ExportAuditRow = {
      id: newUlid(),
      actorId: context.personnelId,
      targetOrgUnitId: orgUnitId,
      exportedCount: rows.length,
      createdAt: new Date(),
    };
    await this.store.insertExportAudit(audit);
    return { audit, personnel: rows };
  }

  private async detail(personnelId: string): Promise<PersonnelDetail> {
    const row = await this.store.findPersonnelById(personnelId);
    if (!row) throw new Error(`人员 ${personnelId} 读取失败`);
    return { ...row, currentOrgUnitId: await this.access.currentOrgOf(personnelId) };
  }
}
