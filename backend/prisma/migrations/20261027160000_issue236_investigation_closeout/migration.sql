-- #236 调查环节与收尾：中止标记、违法记录、笔录、呈批、停表续表、告知记录。
-- 违法记录与笔录不物理删除。呈批正文、步骤、期限事件、告知记录只追加。

ALTER TABLE case_record ADD COLUMN suspended BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE case_violation_record (
  id                    TEXT PRIMARY KEY,
  case_id               TEXT NOT NULL,
  behavior_description  TEXT NOT NULL,
  parties               TEXT[] NOT NULL,
  started_on            DATE NOT NULL,
  ended_on              DATE NOT NULL,
  recognition           TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'active',
  void_reason           TEXT,
  voided_by             TEXT,
  voided_at             TIMESTAMPTZ,
  created_by            TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_violation_record_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_violation_record_recognition_ck CHECK (recognition IN ('one-off', 'continuous', 'continuing')),
  CONSTRAINT case_violation_record_status_ck CHECK (status IN ('active', 'voided')),
  CONSTRAINT case_violation_record_dates_ck CHECK (started_on <= ended_on),
  CONSTRAINT case_violation_record_text_ck CHECK (btrim(behavior_description) <> ''),
  CONSTRAINT case_violation_record_case_fkey FOREIGN KEY (case_id) REFERENCES case_record (id),
  CONSTRAINT case_violation_record_actor_fkey FOREIGN KEY (created_by) REFERENCES personnel (id),
  CONSTRAINT case_violation_record_voided_by_fkey FOREIGN KEY (voided_by) REFERENCES personnel (id)
);
CREATE INDEX case_violation_record_case_idx ON case_violation_record (case_id);

CREATE OR REPLACE FUNCTION case_violation_record_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% 拒绝 DELETE（#236：违法记录不物理删除）', TG_TABLE_NAME;
  END IF;
  IF NEW.case_id IS DISTINCT FROM OLD.case_id
     OR NEW.behavior_description IS DISTINCT FROM OLD.behavior_description
     OR NEW.parties IS DISTINCT FROM OLD.parties
     OR NEW.started_on IS DISTINCT FROM OLD.started_on
     OR NEW.ended_on IS DISTINCT FROM OLD.ended_on
     OR NEW.recognition IS DISTINCT FROM OLD.recognition
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.id IS DISTINCT FROM OLD.id
  THEN
    RAISE EXCEPTION '% 拒绝改写违法记录正文（#236：只允许标记作废）', TG_TABLE_NAME;
  END IF;
  IF OLD.status = 'voided' THEN
    RAISE EXCEPTION '% 已作废的违法记录不能再改（#236）', TG_TABLE_NAME;
  END IF;
  IF NEW.status IS DISTINCT FROM 'voided' THEN
    RAISE EXCEPTION '% 违法记录只允许改为作废（#236）', TG_TABLE_NAME;
  END IF;
  IF NEW.void_reason IS NULL OR btrim(NEW.void_reason) = '' THEN
    RAISE EXCEPTION '% 作废理由必填（#236）', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER case_violation_record_guard
  BEFORE UPDATE OR DELETE ON case_violation_record
  FOR EACH ROW EXECUTE FUNCTION case_violation_record_guard();

COMMENT ON TABLE case_violation_record IS '#236 违法记录。作废留行，不物理删除。';

CREATE TABLE case_inquiry_record (
  id                TEXT PRIMARY KEY,
  case_id           TEXT NOT NULL,
  occurred_at       TIMESTAMPTZ NOT NULL,
  place             TEXT NOT NULL,
  interviewee       TEXT NOT NULL,
  officer_ids       TEXT[] NOT NULL,
  attachment_name   TEXT NOT NULL,
  created_by        TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_inquiry_record_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_inquiry_record_officers_ck CHECK (cardinality(officer_ids) >= 2),
  CONSTRAINT case_inquiry_record_text_ck CHECK (
    btrim(place) <> '' AND btrim(interviewee) <> '' AND btrim(attachment_name) <> ''
  ),
  CONSTRAINT case_inquiry_record_case_fkey FOREIGN KEY (case_id) REFERENCES case_record (id),
  CONSTRAINT case_inquiry_record_actor_fkey FOREIGN KEY (created_by) REFERENCES personnel (id)
);
CREATE INDEX case_inquiry_record_case_idx ON case_inquiry_record (case_id);
CREATE TRIGGER case_inquiry_record_append_only
  BEFORE UPDATE OR DELETE ON case_inquiry_record
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

COMMENT ON TABLE case_inquiry_record IS '#236 调查取证笔录。只追加，不物理删除。';

CREATE TABLE case_procedure_approval (
  id                  TEXT PRIMARY KEY,
  case_id             TEXT NOT NULL,
  kind                TEXT NOT NULL,
  drafter_id          TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'drafting',
  admin_review        TEXT,
  current_version_no  INTEGER NOT NULL DEFAULT 0,
  approval_chain_id   TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_procedure_approval_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_procedure_approval_kind_ck CHECK (kind IN ('suspend', 'resume', 'terminate', 'withdraw', 'close')),
  CONSTRAINT case_procedure_approval_status_ck CHECK (
    status IN ('drafting', 'pending_review', 'pending_approval', 'approved')
  ),
  CONSTRAINT case_procedure_approval_case_fkey FOREIGN KEY (case_id) REFERENCES case_record (id),
  CONSTRAINT case_procedure_approval_drafter_fkey FOREIGN KEY (drafter_id) REFERENCES personnel (id)
);
CREATE INDEX case_procedure_approval_case_idx ON case_procedure_approval (case_id);
CREATE UNIQUE INDEX case_procedure_approval_open_uq
  ON case_procedure_approval (case_id) WHERE status <> 'approved';

CREATE OR REPLACE FUNCTION case_procedure_approval_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% 拒绝 DELETE（#236：呈批不物理删除）', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER case_procedure_approval_guard
  BEFORE DELETE ON case_procedure_approval
  FOR EACH ROW EXECUTE FUNCTION case_procedure_approval_guard();

COMMENT ON TABLE case_procedure_approval IS '#236 调查收尾呈批。一条案件至多一张未批准呈批。';

CREATE TABLE case_procedure_version (
  id            TEXT PRIMARY KEY,
  approval_id   TEXT NOT NULL,
  version_no    INTEGER NOT NULL,
  content_json  TEXT NOT NULL,
  created_by    TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_procedure_version_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_procedure_version_no_ck CHECK (version_no >= 1),
  CONSTRAINT case_procedure_version_approval_fkey FOREIGN KEY (approval_id) REFERENCES case_procedure_approval (id),
  CONSTRAINT case_procedure_version_actor_fkey FOREIGN KEY (created_by) REFERENCES personnel (id)
);
CREATE UNIQUE INDEX case_procedure_version_uq ON case_procedure_version (approval_id, version_no);
CREATE TRIGGER case_procedure_version_append_only
  BEFORE UPDATE OR DELETE ON case_procedure_version
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

CREATE TABLE case_procedure_step (
  id            TEXT PRIMARY KEY,
  approval_id   TEXT NOT NULL,
  version_no    INTEGER NOT NULL,
  step          TEXT NOT NULL,
  actor_id      TEXT NOT NULL,
  opinion       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_procedure_step_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_procedure_step_kind_ck CHECK (step IN ('submit', 'review', 'approve', 'return')),
  CONSTRAINT case_procedure_step_approval_fkey FOREIGN KEY (approval_id) REFERENCES case_procedure_approval (id),
  CONSTRAINT case_procedure_step_actor_fkey FOREIGN KEY (actor_id) REFERENCES personnel (id)
);
CREATE INDEX case_procedure_step_approval_idx ON case_procedure_step (approval_id);
CREATE TRIGGER case_procedure_step_append_only
  BEFORE UPDATE OR DELETE ON case_procedure_step
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

CREATE TABLE case_deadline_event (
  id                TEXT PRIMARY KEY,
  case_id           TEXT NOT NULL,
  event_kind        TEXT NOT NULL,
  basis_label       TEXT NOT NULL,
  basis_note        TEXT NOT NULL,
  stage             TEXT NOT NULL,
  entry_seq         INTEGER NOT NULL,
  transition_code   TEXT NOT NULL,
  actor_id          TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_deadline_event_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_deadline_event_kind_ck CHECK (event_kind IN ('stop', 'continue')),
  CONSTRAINT case_deadline_event_label_ck CHECK (btrim(basis_label) <> ''),
  CONSTRAINT case_deadline_event_case_fkey FOREIGN KEY (case_id) REFERENCES case_record (id),
  CONSTRAINT case_deadline_event_actor_fkey FOREIGN KEY (actor_id) REFERENCES personnel (id)
);
CREATE INDEX case_deadline_event_case_idx ON case_deadline_event (case_id);
CREATE TRIGGER case_deadline_event_append_only
  BEFORE UPDATE OR DELETE ON case_deadline_event
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

COMMENT ON TABLE case_deadline_event IS '#236 停表、续表事件。类别来自 #29 参数，本表只追加。';

CREATE TABLE case_party_notice (
  id            TEXT PRIMARY KEY,
  case_id       TEXT NOT NULL,
  occasion      TEXT NOT NULL,
  note          TEXT NOT NULL,
  recorded_by   TEXT NOT NULL,
  recorded_at   TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_party_notice_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_party_notice_occasion_ck CHECK (occasion IN ('suspend', 'resume')),
  CONSTRAINT case_party_notice_note_ck CHECK (btrim(note) <> ''),
  CONSTRAINT case_party_notice_case_fkey FOREIGN KEY (case_id) REFERENCES case_record (id),
  CONSTRAINT case_party_notice_actor_fkey FOREIGN KEY (recorded_by) REFERENCES personnel (id)
);
CREATE INDEX case_party_notice_case_idx ON case_party_notice (case_id);
CREATE TRIGGER case_party_notice_append_only
  BEFORE UPDATE OR DELETE ON case_party_notice
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

COMMENT ON TABLE case_party_notice IS '#236 中止、恢复的书面告知记录。不算期限。';
