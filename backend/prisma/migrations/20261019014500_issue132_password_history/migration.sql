-- #132（#105「口令历史不重复（ADR 0015）」，ADR 0015）：口令历史表。
-- 只存被换下来的口令散列（PHC 串，自带随机盐），只追加：UPDATE、DELETE 都复用
-- reject_row_mutation 拒绝（函数定义见 0002_identity_org）。
-- 比对口径「当前口令 + 最近 4 条历史」：读取按 (personnel_id, retired_at DESC, id DESC)
-- 取前 N-1 条，索引 (personnel_id, retired_at)。超出 5 条的旧散列一直保留，不设定期删除。
-- 存量人员不回填：只记换下来的口令，登记与引导写入的初始口令没有可换下的旧散列。

CREATE TABLE personnel_password_history (
  id            TEXT PRIMARY KEY,
  personnel_id  TEXT NOT NULL REFERENCES personnel (id),
  password_hash TEXT NOT NULL,
  retired_at    TIMESTAMPTZ NOT NULL,
  CONSTRAINT personnel_password_history_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$')
);

CREATE INDEX personnel_password_history_personnel_retired
  ON personnel_password_history (personnel_id, retired_at);

CREATE TRIGGER personnel_password_history_no_update
  BEFORE UPDATE ON personnel_password_history
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
CREATE TRIGGER personnel_password_history_no_delete
  BEFORE DELETE ON personnel_password_history
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
