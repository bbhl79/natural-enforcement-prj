-- #237 人员层利害关系、回避决定、调查继续登记。三张表都只追加。
-- 登记声明过渡复用 doc.draft，回避决定过渡复用 doc.approve。不新增操作码。

CREATE TABLE person_conflict_event (
  id          TEXT PRIMARY KEY,
  case_id     TEXT NOT NULL,
  person_id   TEXT NOT NULL,
  lineage_id  TEXT NOT NULL,
  seq         INTEGER NOT NULL,
  source      TEXT NOT NULL,
  reason      TEXT NOT NULL,
  status      TEXT NOT NULL,
  created_by  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT person_conflict_event_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT person_conflict_event_lineage_ulid CHECK (lineage_id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT person_conflict_event_seq_ck CHECK (seq >= 1),
  CONSTRAINT person_conflict_event_source_ck CHECK (source IN ('self', 'party', 'other')),
  CONSTRAINT person_conflict_event_status_ck CHECK (status IN ('declared', 'effective', 'rejected')),
  CONSTRAINT person_conflict_event_reason_ck CHECK (length(btrim(reason)) > 0),
  CONSTRAINT person_conflict_event_case_fkey FOREIGN KEY (case_id) REFERENCES case_record (id),
  CONSTRAINT person_conflict_event_person_fkey FOREIGN KEY (person_id) REFERENCES personnel (id),
  CONSTRAINT person_conflict_event_actor_fkey FOREIGN KEY (created_by) REFERENCES personnel (id)
);
CREATE UNIQUE INDEX person_conflict_event_lineage_seq_uq ON person_conflict_event (lineage_id, seq);
CREATE INDEX person_conflict_event_case_person_idx ON person_conflict_event (case_id, person_id);
CREATE TRIGGER person_conflict_event_append_only
  BEFORE UPDATE OR DELETE ON person_conflict_event
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

COMMENT ON TABLE person_conflict_event IS '#237 人员层利害关系事件（追加式）。状态变化写新行。过渡写入复用 doc.draft。';

CREATE TABLE person_conflict_decision (
  id          TEXT PRIMARY KEY,
  case_id     TEXT NOT NULL,
  lineage_id  TEXT NOT NULL UNIQUE,
  decider_id  TEXT NOT NULL,
  conclusion  TEXT NOT NULL,
  reason      TEXT NOT NULL,
  decided_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT person_conflict_decision_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT person_conflict_decision_lineage_ulid CHECK (lineage_id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT person_conflict_decision_conclusion_ck CHECK (conclusion IN ('recuse', 'reject')),
  CONSTRAINT person_conflict_decision_reason_ck CHECK (length(btrim(reason)) > 0),
  CONSTRAINT person_conflict_decision_case_fkey FOREIGN KEY (case_id) REFERENCES case_record (id),
  CONSTRAINT person_conflict_decision_actor_fkey FOREIGN KEY (decider_id) REFERENCES personnel (id)
);
CREATE INDEX person_conflict_decision_case_idx ON person_conflict_decision (case_id);
CREATE TRIGGER person_conflict_decision_append_only
  BEFORE UPDATE OR DELETE ON person_conflict_decision
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

COMMENT ON TABLE person_conflict_decision IS '#237 回避决定（追加式）。一条声明链至多一条。过渡写入复用 doc.approve。';

CREATE TABLE case_investigation_entry (
  id            TEXT PRIMARY KEY,
  case_id       TEXT NOT NULL,
  personnel_id  TEXT NOT NULL,
  kind          TEXT NOT NULL,
  summary       TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_investigation_entry_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_investigation_entry_kind_ck CHECK (kind IN ('transcript', 'violation')),
  CONSTRAINT case_investigation_entry_summary_ck CHECK (length(btrim(summary)) > 0),
  CONSTRAINT case_investigation_entry_case_fkey FOREIGN KEY (case_id) REFERENCES case_record (id),
  CONSTRAINT case_investigation_entry_actor_fkey FOREIGN KEY (personnel_id) REFERENCES personnel (id)
);
CREATE INDEX case_investigation_entry_case_idx ON case_investigation_entry (case_id);
CREATE TRIGGER case_investigation_entry_append_only
  BEFORE UPDATE OR DELETE ON case_investigation_entry
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

COMMENT ON TABLE case_investigation_entry IS '#237 声明期间承办人员继续登记的笔录或违法记录（追加式）。不走签出守卫。';
