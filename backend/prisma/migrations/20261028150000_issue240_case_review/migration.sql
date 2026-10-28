-- #240 调查终结与审理：调查报告呈批、审理人指定、审理意见、拟决定摘要冻结、审理异议呈批。
-- 呈批正文与步骤、审理意见、冻结摘要只追加；审理人指定只追加新行，旧指定置 superseded_at 后保留。

CREATE TABLE case_review_report (
  id                  TEXT PRIMARY KEY,
  case_id             TEXT NOT NULL,
  drafter_id          TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'drafting',
  admin_review        TEXT,
  current_version_no  INTEGER NOT NULL DEFAULT 0,
  approval_chain_id   TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_review_report_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_review_report_status_ck CHECK (
    status IN ('drafting', 'pending_review', 'pending_approval', 'approved')
  ),
  CONSTRAINT case_review_report_case_fkey FOREIGN KEY (case_id) REFERENCES case_record (id),
  CONSTRAINT case_review_report_drafter_fkey FOREIGN KEY (drafter_id) REFERENCES personnel (id)
);
CREATE INDEX case_review_report_case_idx ON case_review_report (case_id);
CREATE UNIQUE INDEX case_review_report_open_uq
  ON case_review_report (case_id) WHERE status <> 'approved';

CREATE OR REPLACE FUNCTION case_review_report_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% 拒绝 DELETE（#240：呈批不物理删除）', TG_TABLE_NAME;
  END IF;
  IF NEW.case_id IS DISTINCT FROM OLD.case_id
     OR NEW.drafter_id IS DISTINCT FROM OLD.drafter_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION '% 拒绝改写呈批归属（#240）', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER case_review_report_guard
  BEFORE UPDATE OR DELETE ON case_review_report
  FOR EACH ROW EXECUTE FUNCTION case_review_report_guard();

COMMENT ON TABLE case_review_report IS '#240 调查报告呈批（T08）。一条案件至多一张未批准呈批。';

CREATE TABLE case_review_report_version (
  id            TEXT PRIMARY KEY,
  report_id     TEXT NOT NULL,
  version_no    INTEGER NOT NULL,
  content_json  TEXT NOT NULL,
  created_by    TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_review_report_version_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_review_report_version_no_ck CHECK (version_no >= 1),
  CONSTRAINT case_review_report_version_report_fkey FOREIGN KEY (report_id) REFERENCES case_review_report (id),
  CONSTRAINT case_review_report_version_actor_fkey FOREIGN KEY (created_by) REFERENCES personnel (id),
  CONSTRAINT case_review_report_version_uq UNIQUE (report_id, version_no)
);
CREATE TRIGGER case_review_report_version_append_only
  BEFORE UPDATE OR DELETE ON case_review_report_version
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

CREATE TABLE case_review_report_step (
  id          TEXT PRIMARY KEY,
  report_id   TEXT NOT NULL,
  version_no  INTEGER NOT NULL,
  step        TEXT NOT NULL,
  actor_id    TEXT NOT NULL,
  opinion     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_review_report_step_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_review_report_step_ck CHECK (step IN ('submit', 'review', 'approve', 'return')),
  CONSTRAINT case_review_report_step_report_fkey FOREIGN KEY (report_id) REFERENCES case_review_report (id),
  CONSTRAINT case_review_report_step_actor_fkey FOREIGN KEY (actor_id) REFERENCES personnel (id)
);
CREATE INDEX case_review_report_step_report_idx ON case_review_report_step (report_id);
CREATE TRIGGER case_review_report_step_append_only
  BEFORE UPDATE OR DELETE ON case_review_report_step
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

CREATE TABLE case_reviewer_designation (
  id             TEXT PRIMARY KEY,
  case_id        TEXT NOT NULL,
  entry_seq      INTEGER NOT NULL,
  personnel_id   TEXT NOT NULL,
  designated_by  TEXT NOT NULL,
  reason         TEXT,
  replaces_id    TEXT,
  designated_at  TIMESTAMPTZ NOT NULL,
  superseded_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_reviewer_designation_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_reviewer_designation_entry_ck CHECK (entry_seq >= 1),
  CONSTRAINT case_reviewer_designation_case_fkey FOREIGN KEY (case_id) REFERENCES case_record (id),
  CONSTRAINT case_reviewer_designation_person_fkey FOREIGN KEY (personnel_id) REFERENCES personnel (id),
  CONSTRAINT case_reviewer_designation_by_fkey FOREIGN KEY (designated_by) REFERENCES personnel (id)
);
CREATE INDEX case_reviewer_designation_case_idx ON case_reviewer_designation (case_id);
CREATE UNIQUE INDEX case_reviewer_designation_active_uq
  ON case_reviewer_designation (case_id, entry_seq) WHERE superseded_at IS NULL;

CREATE OR REPLACE FUNCTION case_reviewer_designation_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% 拒绝 DELETE（#240：旧指定只追加保留）', TG_TABLE_NAME;
  END IF;
  IF NEW.case_id IS DISTINCT FROM OLD.case_id
     OR NEW.entry_seq IS DISTINCT FROM OLD.entry_seq
     OR NEW.personnel_id IS DISTINCT FROM OLD.personnel_id
     OR NEW.designated_by IS DISTINCT FROM OLD.designated_by
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.replaces_id IS DISTINCT FROM OLD.replaces_id
     OR NEW.designated_at IS DISTINCT FROM OLD.designated_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION '% 拒绝改写指定内容（#240：只允许置 superseded_at）', TG_TABLE_NAME;
  END IF;
  IF OLD.superseded_at IS NOT NULL AND NEW.superseded_at IS DISTINCT FROM OLD.superseded_at THEN
    RAISE EXCEPTION '% 已更换的指定不能再改（#240）', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER case_reviewer_designation_guard
  BEFORE UPDATE OR DELETE ON case_reviewer_designation
  FOR EACH ROW EXECUTE FUNCTION case_reviewer_designation_guard();

COMMENT ON TABLE case_reviewer_designation IS '#240 审理人指定。只追加新行；更换时旧行置 superseded_at 后保留。';

CREATE TABLE case_review_opinion (
  id                TEXT PRIMARY KEY,
  case_id           TEXT NOT NULL,
  entry_seq         INTEGER NOT NULL,
  opinion_kind      TEXT NOT NULL,
  content           TEXT NOT NULL,
  signed_by         TEXT NOT NULL,
  designation_id    TEXT NOT NULL,
  destination_code  TEXT NOT NULL,
  outcome_code      TEXT,
  outcome_label     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_review_opinion_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_review_opinion_entry_ck CHECK (entry_seq >= 1),
  CONSTRAINT case_review_opinion_kind_ck CHECK (
    opinion_kind IN (
      'supplementary-investigation', 'correction', 'penalty',
      'no-penalty', 'fact-not-established', 'limitation-expired'
    )
  ),
  CONSTRAINT case_review_opinion_destination_ck CHECK (btrim(destination_code) <> ''),
  CONSTRAINT case_review_opinion_text_ck CHECK (btrim(content) <> ''),
  CONSTRAINT case_review_opinion_case_fkey FOREIGN KEY (case_id) REFERENCES case_record (id),
  CONSTRAINT case_review_opinion_signer_fkey FOREIGN KEY (signed_by) REFERENCES personnel (id),
  CONSTRAINT case_review_opinion_designation_fkey FOREIGN KEY (designation_id) REFERENCES case_reviewer_designation (id)
);
CREATE INDEX case_review_opinion_case_idx ON case_review_opinion (case_id);
CREATE TRIGGER case_review_opinion_append_only
  BEFORE UPDATE OR DELETE ON case_review_opinion
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

COMMENT ON TABLE case_review_opinion IS '#240 审理意见。签出即生效，只追加，不改写。';

CREATE TABLE case_frozen_decision (
  id            TEXT PRIMARY KEY,
  case_id       TEXT NOT NULL,
  opinion_id    TEXT NOT NULL,
  summary_json  TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_frozen_decision_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_frozen_decision_case_fkey FOREIGN KEY (case_id) REFERENCES case_record (id),
  CONSTRAINT case_frozen_decision_opinion_fkey FOREIGN KEY (opinion_id) REFERENCES case_review_opinion (id),
  CONSTRAINT case_frozen_decision_opinion_uq UNIQUE (opinion_id)
);
CREATE INDEX case_frozen_decision_case_idx ON case_frozen_decision (case_id);
CREATE TRIGGER case_frozen_decision_append_only
  BEFORE UPDATE OR DELETE ON case_frozen_decision
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

COMMENT ON TABLE case_frozen_decision IS '#240 审理通过后的拟决定摘要冻结。之后修改须回流。';

CREATE TABLE case_review_objection (
  id                   TEXT PRIMARY KEY,
  case_id              TEXT NOT NULL,
  entry_seq            INTEGER NOT NULL,
  opinion_id           TEXT NOT NULL,
  drafter_id           TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'drafting',
  content_json         TEXT NOT NULL,
  decision             TEXT,
  decision_transition  TEXT,
  decided_by           TEXT,
  decided_at           TIMESTAMPTZ,
  approval_chain_id    TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_review_objection_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_review_objection_entry_ck CHECK (entry_seq >= 1),
  CONSTRAINT case_review_objection_status_ck CHECK (status IN ('drafting', 'pending_approval', 'decided')),
  CONSTRAINT case_review_objection_decision_ck CHECK (
    decision IS NULL OR decision IN ('support-review', 'support-handler')
  ),
  CONSTRAINT case_review_objection_transition_ck CHECK (
    decision_transition IS NULL OR decision_transition IN ('T09', 'T10', 'T11', 'T12')
  ),
  CONSTRAINT case_review_objection_case_fkey FOREIGN KEY (case_id) REFERENCES case_record (id),
  CONSTRAINT case_review_objection_opinion_fkey FOREIGN KEY (opinion_id) REFERENCES case_review_opinion (id),
  CONSTRAINT case_review_objection_drafter_fkey FOREIGN KEY (drafter_id) REFERENCES personnel (id),
  CONSTRAINT case_review_objection_decider_fkey FOREIGN KEY (decided_by) REFERENCES personnel (id)
);
CREATE INDEX case_review_objection_case_idx ON case_review_objection (case_id);
CREATE UNIQUE INDEX case_review_objection_open_uq
  ON case_review_objection (case_id, entry_seq) WHERE status <> 'decided';

CREATE OR REPLACE FUNCTION case_review_objection_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% 拒绝 DELETE（#240：异议呈批不物理删除）', TG_TABLE_NAME;
  END IF;
  IF NEW.case_id IS DISTINCT FROM OLD.case_id
     OR NEW.entry_seq IS DISTINCT FROM OLD.entry_seq
     OR NEW.opinion_id IS DISTINCT FROM OLD.opinion_id
     OR NEW.drafter_id IS DISTINCT FROM OLD.drafter_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION '% 拒绝改写异议呈批归属（#240）', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER case_review_objection_guard
  BEFORE UPDATE OR DELETE ON case_review_objection
  FOR EACH ROW EXECUTE FUNCTION case_review_objection_guard();

COMMENT ON TABLE case_review_objection IS '#240 审理异议呈批（T09a）。不是退回，不进退回列表。';
