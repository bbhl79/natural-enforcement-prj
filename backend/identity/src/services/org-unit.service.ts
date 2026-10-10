// 机构服务（#52）：登记 / 名称版本化改名 / 失效——全部经 AccessControlService 强校验，
// 且只失效不删除（本服务不存在任何删除路径，库层触发器为第二道兜底）。

import { Inject, Injectable } from '@nestjs/common';

import type { ActorRef } from '../domain/actor.ts';
import { newUlid } from '../domain/ulid.ts';
import type { OrgUnitRow } from '../persistence/identity-store.ts';
import { IDENTITY_STORE, type IdentityStore } from '../persistence/identity-store.ts';
import { AccessControlService } from './access-control.service.ts';

export interface RegisterOrgUnitInput {
  code: string;
  name: string;
  /** null = 根机构 */
  parentId: string | null;
}

@Injectable()
export class OrgUnitService {
  constructor(
    @Inject(IDENTITY_STORE) private readonly store: IdentityStore,
    private readonly access: AccessControlService,
  ) {}

  /** 登记机构（modify 动作）：上级机构须在数据范围内；名称落当前行 + v1 版本行 */
  async registerOrgUnit(actor: ActorRef, input: RegisterOrgUnitInput): Promise<OrgUnitRow> {
    if (input.parentId) {
      await this.access.authorize(actor, 'modify', input.parentId);
    }
    const id = newUlid();
    await this.store.insertOrgUnit({ id, ...input });
    await this.store.insertOrgUnitNameVersion({
      id: newUlid(),
      orgUnitId: id,
      name: input.name,
      version: 1,
      createdAt: new Date(),
    });
    const created = await this.store.findOrgUnitById(id);
    if (!created) throw new Error(`机构 ${id} 写入后读取失败`);
    return created;
  }

  /** 机构改名 = 产生新版本行（append-only）+ 更新当前名；历史版本永不可改 */
  async renameOrgUnit(actor: ActorRef, orgUnitId: string, newName: string): Promise<void> {
    await this.access.authorize(actor, 'modify', orgUnitId);
    const versions = await this.store.listOrgUnitNameVersions(orgUnitId);
    const nextVersion = (versions.at(-1)?.version ?? 0) + 1;
    await this.store.insertOrgUnitNameVersion({
      id: newUlid(),
      orgUnitId,
      name: newName,
      version: nextVersion,
      createdAt: new Date(),
    });
    await this.store.updateOrgUnitCurrentName(orgUnitId, newName);
  }

  /** 机构失效（modify 动作）：只置失效标记 + 失效时间，无物理删除路径 */
  async deactivateOrgUnit(actor: ActorRef, orgUnitId: string): Promise<void> {
    await this.access.authorize(actor, 'modify', orgUnitId);
    await this.store.deactivateOrgUnit(orgUnitId, new Date());
  }
}
