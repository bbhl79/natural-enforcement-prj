-- #128（#105「人员与登录凭据」岗位标记，Lei Hu 2026-10-17 22:14，A1）：人员—岗位标记表；留痕表加「后值」列。
-- 岗位标记取值固定两项：legal-review-lead 法制审核负责人、legal-affairs-leader 分管法制的局领导。
-- 存法同人员—角色：加标记插入新行，摘标记给旧行置失效时间，不删行。
-- 未失效行的「人员 + 标记」唯一，由部分唯一索引保证。Prisma schema 表达不了这个索引，后续生成迁移时不得删掉。
-- DELETE 复用 reject_row_mutation。UPDATE 只允许 deactivated_at 从空到非空（reject_unless_first_deactivation）。
-- 岗位标记不是角色：不进允许行，不授予任何操作码。

CREATE TABLE personnel_post (
  id             TEXT PRIMARY KEY,
  personnel_id   TEXT NOT NULL REFERENCES personnel (id),
  post           TEXT NOT NULL,
  deactivated_at TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT personnel_post_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT personnel_post_known CHECK (post IN ('legal-review-lead', 'legal-affairs-leader'))
);

CREATE UNIQUE INDEX personnel_post_one_active
  ON personnel_post (personnel_id, post)
  WHERE deactivated_at IS NULL;

CREATE TRIGGER personnel_post_no_delete
  BEFORE DELETE ON personnel_post
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
CREATE TRIGGER personnel_post_deactivate_only
  BEFORE UPDATE ON personnel_post
  FOR EACH ROW EXECUTE FUNCTION reject_unless_first_deactivation();

-- 「后值」（#105：personnel.post-granted / post-revoked「后值写标记取值」）。可空，其余动作为空。
-- 与 previous_value 对称。留痕表照旧只追加（audit_trail_append_only）。
ALTER TABLE audit_trail ADD COLUMN next_value TEXT;
