-- 0002_identity_org（#52 身份组织：人员/机构 + 名称版本 + 任职记录 + 导出留痕）
-- 只失效不删除：personnel/org_unit/personnel_assignment 禁物理删除（BEFORE DELETE 触发器），
-- 失效 = deactivated_at 标记；名称历史与导出留痕为 append-only（禁 UPDATE/DELETE 触发器）。
-- 库层触发器是接口层「无删除路径」之外的第二道兜底：即便绕开应用直改库也无法删改。

CREATE TABLE org_unit (
  id             TEXT PRIMARY KEY,
  code           TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  parent_id      TEXT REFERENCES org_unit (id),
  deactivated_at TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE org_unit_name_version (
  id          TEXT PRIMARY KEY,
  org_unit_id TEXT NOT NULL REFERENCES org_unit (id),
  name        TEXT NOT NULL,
  version     INTEGER NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_unit_id, version)
);

CREATE TABLE personnel (
  id             TEXT PRIMARY KEY,
  code           TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  org_unit_id    TEXT NOT NULL REFERENCES org_unit (id),
  role           TEXT NOT NULL,
  password_hash  TEXT,
  deactivated_at TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE personnel_name_version (
  id           TEXT PRIMARY KEY,
  personnel_id TEXT NOT NULL REFERENCES personnel (id),
  name         TEXT NOT NULL,
  version      INTEGER NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (personnel_id, version)
);

-- 任职记录：当前任职 = ended_at 为 NULL 的那条；调岗 = 旧记录闭环 + 新记录，
-- 旧权限随之失效由 AccessControlService 以「当前任职机构」判定（E2 越权矩阵证据）。
CREATE TABLE personnel_assignment (
  id           TEXT PRIMARY KEY,
  personnel_id TEXT NOT NULL REFERENCES personnel (id),
  org_unit_id  TEXT NOT NULL REFERENCES org_unit (id),
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at     TIMESTAMPTZ
);

-- 导出留痕（append-only）：谁在何时导出了什么范围、多少行。
CREATE TABLE export_audit (
  id                 TEXT PRIMARY KEY,
  actor_id           TEXT NOT NULL REFERENCES personnel (id),
  target_org_unit_id TEXT NOT NULL REFERENCES org_unit (id),
  exported_count     INTEGER NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION reject_row_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% 拒绝 %（#52：append-only/只失效不删除，留痕与名称历史不可删改，人员/机构不可物理删除）',
    TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER org_unit_name_version_immutable
  BEFORE UPDATE OR DELETE ON org_unit_name_version
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
CREATE TRIGGER personnel_name_version_immutable
  BEFORE UPDATE OR DELETE ON personnel_name_version
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
CREATE TRIGGER export_audit_append_only
  BEFORE UPDATE OR DELETE ON export_audit
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
CREATE TRIGGER org_unit_no_physical_delete
  BEFORE DELETE ON org_unit
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
CREATE TRIGGER personnel_no_physical_delete
  BEFORE DELETE ON personnel
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
CREATE TRIGGER personnel_assignment_no_physical_delete
  BEFORE DELETE ON personnel_assignment
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
