-- #272 R-02 案件标记：统一标记存储。只追加，当前状态取每键最后一行。
-- 「已送达」「进入听证程序」由服务层拒绝清除；表本身不限制方向，留痕更完整。

CREATE TABLE case_marker (
  id          TEXT PRIMARY KEY,
  case_id     TEXT NOT NULL,
  marker      TEXT NOT NULL,
  state       TEXT NOT NULL,
  note        TEXT,
  actor_id    TEXT NOT NULL,
  changed_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_marker_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_marker_key_ck CHECK (
    marker IN ('notice-served', 'notice-waiting', 'deemed-waived', 'hearing-entered', 'hearing-terminated')
  ),
  CONSTRAINT case_marker_state_ck CHECK (state IN ('set', 'cleared')),
  CONSTRAINT case_marker_case_fkey FOREIGN KEY (case_id) REFERENCES case_record (id),
  CONSTRAINT case_marker_actor_fkey FOREIGN KEY (actor_id) REFERENCES personnel (id)
);
CREATE INDEX case_marker_case_key_idx ON case_marker (case_id, marker, changed_at);

CREATE TRIGGER case_marker_append_only
  BEFORE UPDATE OR DELETE ON case_marker
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

COMMENT ON TABLE case_marker IS '#272 R-02 案件标记。只追加；当前状态取每键最后一行。供 #269／#242／#270 复用。';