-- 0002_identity_org（#52 身份组织：人员/机构 + 名称版本 + 任职记录 + 导出留痕）
-- 只失效不删除：personnel/org_unit 禁物理删除；personnel_assignment 禁物理删除，
-- 并且 UPDATE 只允许一次 ended_at 从 NULL 到非 NULL（其余列与已关止行不可改）。
-- 每人至多一条 ended_at IS NULL 的当前任职（部分唯一索引）。
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

-- 任职记录：当前任职 = ended_at 为 NULL 的那条（部分唯一索引保证至多一条）；
-- 调岗 = 旧记录闭环 + 新记录，旧权限随之失效由 AccessControlService 以「当前任职机构」判定。
CREATE TABLE personnel_assignment (
  id           TEXT PRIMARY KEY,
  personnel_id TEXT NOT NULL REFERENCES personnel (id),
  org_unit_id  TEXT NOT NULL REFERENCES org_unit (id),
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at     TIMESTAMPTZ
);

CREATE UNIQUE INDEX personnel_assignment_one_current
  ON personnel_assignment (personnel_id)
  WHERE ended_at IS NULL;

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
CREATE OR REPLACE FUNCTION personnel_assignment_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% 拒绝 DELETE（#52：任职记录只失效不删除）', TG_TABLE_NAME;
  END IF;
  IF OLD.ended_at IS NOT NULL THEN
    RAISE EXCEPTION '% 拒绝 UPDATE（#52：已关止任职不可改）', TG_TABLE_NAME;
  END IF;
  IF NEW.ended_at IS NULL
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.personnel_id IS DISTINCT FROM OLD.personnel_id
     OR NEW.org_unit_id IS DISTINCT FROM OLD.org_unit_id
     OR NEW.started_at IS DISTINCT FROM OLD.started_at THEN
    RAISE EXCEPTION '% 拒绝 UPDATE（#52：任职记录只允许一次 ended_at 从空到非空）', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER personnel_assignment_guard
  BEFORE UPDATE OR DELETE ON personnel_assignment
  FOR EACH ROW EXECUTE FUNCTION personnel_assignment_guard();
