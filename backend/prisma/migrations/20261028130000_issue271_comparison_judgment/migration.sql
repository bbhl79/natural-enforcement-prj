-- #271 新旧比对判定。只追加，不物理删除。每条违法记录每次判定一行，最新一行生效。
-- 没有「已知版本集摘要」字段。版本集自动解析、自动重新比对、自动 R7／T32 均属二期。

CREATE TABLE case_comparison_judgment (
  id                      TEXT PRIMARY KEY,
  case_id                 TEXT NOT NULL,
  violation_record_id     TEXT NOT NULL,
  behavior_bases_json     TEXT NOT NULL,
  decision_bases_json     TEXT NOT NULL,
  behavior_benchmarks_json TEXT NOT NULL,
  decision_benchmarks_json TEXT NOT NULL,
  adopted_version         TEXT NOT NULL,
  reason                  TEXT NOT NULL,
  notice_ref              TEXT NOT NULL,
  zero_difference         BOOLEAN NOT NULL,
  created_by              TEXT NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_comparison_judgment_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_comparison_judgment_text_ck CHECK (
    btrim(adopted_version) <> '' AND btrim(reason) <> '' AND btrim(notice_ref) <> ''
  ),
  CONSTRAINT case_comparison_judgment_behavior_bases_ck CHECK (jsonb_typeof(behavior_bases_json::jsonb) = 'array'),
  CONSTRAINT case_comparison_judgment_decision_bases_ck CHECK (jsonb_typeof(decision_bases_json::jsonb) = 'array'),
  CONSTRAINT case_comparison_judgment_behavior_benchmarks_ck CHECK (jsonb_typeof(behavior_benchmarks_json::jsonb) = 'array'),
  CONSTRAINT case_comparison_judgment_decision_benchmarks_ck CHECK (jsonb_typeof(decision_benchmarks_json::jsonb) = 'array'),
  CONSTRAINT case_comparison_judgment_case_fkey FOREIGN KEY (case_id) REFERENCES case_record (id),
  CONSTRAINT case_comparison_judgment_violation_fkey FOREIGN KEY (violation_record_id) REFERENCES case_violation_record (id),
  CONSTRAINT case_comparison_judgment_actor_fkey FOREIGN KEY (created_by) REFERENCES personnel (id)
);
CREATE INDEX case_comparison_judgment_case_idx ON case_comparison_judgment (case_id);
CREATE INDEX case_comparison_judgment_violation_idx ON case_comparison_judgment (violation_record_id);
CREATE TRIGGER case_comparison_judgment_append_only
  BEFORE UPDATE OR DELETE ON case_comparison_judgment
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

COMMENT ON TABLE case_comparison_judgment IS '#271 新旧比对判定（追加式）。每条违法记录取最新一行。比对结果只进内部材料和卷宗，不写入对外决定书。';