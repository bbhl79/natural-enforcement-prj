// Prisma 适配（#52）：IdentityStore 端口的 backend/prisma 实现，模块内唯一 import
// 生成客户端的文件。仓库内不生成 Prisma Client（产物只存在于容器可写层），
// 故本文件被根 tsconfig 排除在 unit 层类型检查之外，由 integration 层
//（dev test integration：先 prisma generate 再 tsc -p integration）承载其编译。
// 触发器（迁移 0002_identity_org）在库层兜底 append-only/只失效不删除，
// 适配器不提供任何 delete 调用。

import type { PrismaClient } from '../../../prisma/generated/prisma/client.ts';

import type {
  ExportAuditRow,
  IdentityStore,
  OrgUnitNameVersionRow,
  OrgUnitRow,
  OrgUnitToCreate,
  PersonnelAssignmentRow,
  PersonnelNameVersionRow,
  PersonnelRow,
  PersonnelToCreate,
} from './identity-store.ts';

export class PrismaIdentityStore implements IdentityStore {
  constructor(private readonly prisma: PrismaClient) {}

  findPersonnelById(id: string): Promise<PersonnelRow | null> {
    return this.prisma.personnel.findUnique({ where: { id } });
  }

  findOrgUnitById(id: string): Promise<OrgUnitRow | null> {
    return this.prisma.orgUnit.findUnique({ where: { id } });
  }

  async findCurrentAssignment(personnelId: string): Promise<PersonnelAssignmentRow | null> {
    const rows = await this.prisma.personnelAssignment.findMany({
      where: { personnelId, endedAt: null },
      orderBy: { startedAt: 'desc' },
      take: 1,
    });
    return rows[0] ?? null;
  }

  /** 祖先链（含自身），自根向叶；目标机构不存在时返回空链（调用方按越权处理） */
  async findOrgUnitPathToRoot(orgUnitId: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      WITH RECURSIVE up AS (
        SELECT id, parent_id FROM org_unit WHERE id = ${orgUnitId}
        UNION ALL
        SELECT parent.id, parent.parent_id
        FROM org_unit parent JOIN up child ON parent.id = child.parent_id
      )
      SELECT id FROM up`;
    return rows.map((row) => row.id);
  }

  listOrgUnitNameVersions(orgUnitId: string): Promise<OrgUnitNameVersionRow[]> {
    return this.prisma.orgUnitNameVersion.findMany({
      where: { orgUnitId },
      orderBy: { version: 'asc' },
    });
  }

  listPersonnelNameVersions(personnelId: string): Promise<PersonnelNameVersionRow[]> {
    return this.prisma.personnelNameVersion.findMany({
      where: { personnelId },
      orderBy: { version: 'asc' },
    });
  }

  listActivePersonnelOfOrgUnit(orgUnitId: string): Promise<PersonnelRow[]> {
    return this.prisma.personnel.findMany({
      where: { orgUnitId, deactivatedAt: null },
      orderBy: { code: 'asc' },
    });
  }

  findExportAuditById(id: string): Promise<ExportAuditRow | null> {
    return this.prisma.exportAudit.findUnique({ where: { id } });
  }

  async insertOrgUnit(input: OrgUnitToCreate): Promise<void> {
    await this.prisma.orgUnit.create({ data: input });
  }

  async insertOrgUnitNameVersion(row: OrgUnitNameVersionRow): Promise<void> {
    await this.prisma.orgUnitNameVersion.create({ data: row });
  }

  async updateOrgUnitCurrentName(orgUnitId: string, name: string): Promise<void> {
    await this.prisma.orgUnit.update({ where: { id: orgUnitId }, data: { name } });
  }

  async deactivateOrgUnit(orgUnitId: string, deactivatedAt: Date): Promise<void> {
    await this.prisma.orgUnit.update({ where: { id: orgUnitId }, data: { deactivatedAt } });
  }

  async insertPersonnel(input: PersonnelToCreate): Promise<void> {
    await this.prisma.personnel.create({ data: input });
  }

  async insertPersonnelNameVersion(row: PersonnelNameVersionRow): Promise<void> {
    await this.prisma.personnelNameVersion.create({ data: row });
  }

  async updatePersonnelCurrentName(personnelId: string, name: string): Promise<void> {
    await this.prisma.personnel.update({ where: { id: personnelId }, data: { name } });
  }

  async updatePersonnelOrgUnit(personnelId: string, orgUnitId: string): Promise<void> {
    await this.prisma.personnel.update({ where: { id: personnelId }, data: { orgUnitId } });
  }

  async deactivatePersonnel(personnelId: string, deactivatedAt: Date): Promise<void> {
    await this.prisma.personnel.update({ where: { id: personnelId }, data: { deactivatedAt } });
  }

  async insertAssignment(row: PersonnelAssignmentRow): Promise<void> {
    await this.prisma.personnelAssignment.create({ data: row });
  }

  async closeAssignment(assignmentId: string, endedAt: Date): Promise<void> {
    await this.prisma.personnelAssignment.update({
      where: { id: assignmentId },
      data: { endedAt },
    });
  }

  async insertExportAudit(row: ExportAuditRow): Promise<void> {
    await this.prisma.exportAudit.create({ data: row });
  }
}
