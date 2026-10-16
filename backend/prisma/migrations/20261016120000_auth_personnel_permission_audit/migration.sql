-- #92 认证：人员登录字段、权限四表、留痕表。
-- 人员旧 role 列保留。手机号有值时全库唯一；空值可以有多条。
-- Role / Permission / RolePermission / PersonnelRole 只失效不删除。
-- DELETE 复用 reject_row_mutation。UPDATE 只允许 deactivated_at 从空到非空。
-- 未失效行的业务键唯一，由部分唯一索引保证。Prisma schema 表达不了这些索引，后续生成迁移时不得删掉。
-- AuditTrail 追加写入。UPDATE 与 DELETE 都复用 reject_row_mutation。
-- 主键为 ULID（#16 §1.1）。动作取值不在库内锁死。成败只有 succeeded / failed。

ALTER TABLE personnel
  ADD COLUMN mobile_phone TEXT,
  ADD COLUMN password_failure_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN password_failure_window_started_at TIMESTAMPTZ,
  ADD COLUMN locked_until TIMESTAMPTZ,
  ADD COLUMN password_changed_at TIMESTAMPTZ,
  ADD COLUMN enforcement_cert_no TEXT,
  ADD COLUMN enforcement_cert_expires_on DATE;

CREATE UNIQUE INDEX personnel_mobile_phone_key ON personnel (mobile_phone);

CREATE OR REPLACE FUNCTION reject_unless_first_deactivation() RETURNS trigger AS $$
DECLARE
  old_row jsonb := to_jsonb(OLD) - 'deactivated_at';
  new_row jsonb := to_jsonb(NEW) - 'deactivated_at';
BEGIN
  IF OLD.deactivated_at IS NOT NULL THEN
    RAISE EXCEPTION '% 拒绝 UPDATE（#92：已失效记录不可改）', TG_TABLE_NAME;
  END IF;
  IF NEW.deactivated_at IS NULL OR old_row IS DISTINCT FROM new_row THEN
    RAISE EXCEPTION '% 拒绝 UPDATE（#92：记录只允许一次失效）', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE "role" (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  deactivated_at TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT role_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$')
);

CREATE UNIQUE INDEX role_one_active_name
  ON "role" (name)
  WHERE deactivated_at IS NULL;

CREATE TABLE permission (
  id             TEXT PRIMARY KEY,
  code           TEXT NOT NULL,
  deactivated_at TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT permission_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$')
);

CREATE UNIQUE INDEX permission_one_active_code
  ON permission (code)
  WHERE deactivated_at IS NULL;

CREATE TABLE role_permission (
  id             TEXT PRIMARY KEY,
  role_id        TEXT NOT NULL REFERENCES "role" (id),
  permission_id  TEXT NOT NULL REFERENCES permission (id),
  deactivated_at TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT role_permission_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$')
);

CREATE UNIQUE INDEX role_permission_one_active
  ON role_permission (role_id, permission_id)
  WHERE deactivated_at IS NULL;

CREATE TABLE personnel_role (
  id             TEXT PRIMARY KEY,
  personnel_id   TEXT NOT NULL REFERENCES personnel (id),
  role_id        TEXT NOT NULL REFERENCES "role" (id),
  deactivated_at TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT personnel_role_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$')
);

CREATE UNIQUE INDEX personnel_role_one_active
  ON personnel_role (personnel_id, role_id)
  WHERE deactivated_at IS NULL;

CREATE TRIGGER role_no_delete
  BEFORE DELETE ON "role"
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
CREATE TRIGGER role_deactivate_only
  BEFORE UPDATE ON "role"
  FOR EACH ROW EXECUTE FUNCTION reject_unless_first_deactivation();
CREATE TRIGGER permission_no_delete
  BEFORE DELETE ON permission
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
CREATE TRIGGER permission_deactivate_only
  BEFORE UPDATE ON permission
  FOR EACH ROW EXECUTE FUNCTION reject_unless_first_deactivation();
CREATE TRIGGER role_permission_no_delete
  BEFORE DELETE ON role_permission
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
CREATE TRIGGER role_permission_deactivate_only
  BEFORE UPDATE ON role_permission
  FOR EACH ROW EXECUTE FUNCTION reject_unless_first_deactivation();
CREATE TRIGGER personnel_role_no_delete
  BEFORE DELETE ON personnel_role
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
CREATE TRIGGER personnel_role_deactivate_only
  BEFORE UPDATE ON personnel_role
  FOR EACH ROW EXECUTE FUNCTION reject_unless_first_deactivation();

CREATE TABLE audit_trail (
  id                    TEXT PRIMARY KEY,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  action                TEXT NOT NULL,
  outcome               TEXT NOT NULL,
  actor_id              TEXT REFERENCES personnel (id),
  actor_code            TEXT,
  subject_personnel_id  TEXT REFERENCES personnel (id),
  subject_code          TEXT,
  org_unit_id           TEXT REFERENCES org_unit (id),
  source_ip             TEXT,
  reason                TEXT,
  opcode                TEXT,
  resource_type         TEXT,
  resource_id           TEXT,
  previous_value        TEXT,
  CONSTRAINT audit_trail_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT audit_trail_outcome CHECK (outcome IN ('succeeded', 'failed'))
);

CREATE TRIGGER audit_trail_append_only
  BEFORE UPDATE OR DELETE ON audit_trail
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
