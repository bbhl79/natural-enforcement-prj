-- #246 期限行、期间事件、期限呈批、后装工作日历。期限行与期间事件只追加。

CREATE TABLE case_deadline_row (
  id                           TEXT PRIMARY KEY,
  case_id                      TEXT NOT NULL,
  rule_key                     TEXT NOT NULL,
  entry_seq                    INTEGER NOT NULL,
  procedure_node               TEXT NOT NULL,
  starting_document            TEXT,
  consumption                  TEXT NOT NULL,
  rule_version                 TEXT NOT NULL,
  day_count                    INTEGER NOT NULL,
  day_basis                    TEXT NOT NULL,
  party_facing                 BOOLEAN NOT NULL,
  extension_allowance          INTEGER,
  started_on                   DATE NOT NULL,
  due_on                       DATE,
  needs_manual_confirmation    BOOLEAN NOT NULL DEFAULT FALSE,
  confirmation_trace           TEXT,
  row_status                   TEXT NOT NULL DEFAULT 'open',
  revision_no                  INTEGER NOT NULL DEFAULT 0,
  calendar_version             TEXT NOT NULL,
  clamped                      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_deadline_row_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_deadline_row_consumption_ck CHECK (consumption IN ('continue', 'restart')),
  CONSTRAINT case_deadline_row_basis_ck CHECK (day_basis IN ('calendar', 'working')),
  CONSTRAINT case_deadline_row_status_ck CHECK (row_status IN ('open', 'expired', 'deemed-waived')),
  CONSTRAINT case_deadline_row_count_ck CHECK (day_count > 0),
  CONSTRAINT case_deadline_row_revision_ck CHECK (revision_no >= 0),
  CONSTRAINT case_deadline_row_case_fkey FOREIGN KEY (case_id) REFERENCES case_record (id)
);
CREATE UNIQUE INDEX case_deadline_row_anchor_uq
  ON case_deadline_row (case_id, rule_key, entry_seq, procedure_node, revision_no);
CREATE INDEX case_deadline_row_case_idx ON case_deadline_row (case_id);
CREATE TRIGGER case_deadline_row_append_only
  BEFORE UPDATE OR DELETE ON case_deadline_row
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

COMMENT ON TABLE case_deadline_row IS '#246 期限行。四维锚点加修订号唯一，只追加。';

CREATE TABLE case_period_event (
  id               TEXT PRIMARY KEY,
  case_id          TEXT NOT NULL,
  kind             TEXT NOT NULL,
  source           TEXT NOT NULL,
  basis_label      TEXT NOT NULL,
  basis_note       TEXT NOT NULL,
  reason           TEXT,
  started_on       DATE,
  ended_on         DATE,
  extension_days   INTEGER,
  backfill         BOOLEAN NOT NULL DEFAULT FALSE,
  status           TEXT NOT NULL,
  approval_id      TEXT,
  actor_id         TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_period_event_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_period_event_kind_ck CHECK (
    kind IN ('appraisal', 'hearing', 'announcement', 'in-transit', 'criminal-wait', 'business-exclusion', 'extension')
  ),
  CONSTRAINT case_period_event_source_ck CHECK (source IN ('system', 'manual')),
  CONSTRAINT case_period_event_status_ck CHECK (status IN ('effective')),
  CONSTRAINT case_period_event_label_ck CHECK (btrim(basis_label) <> ''),
  CONSTRAINT case_period_event_interval_ck CHECK (
    (started_on IS NULL AND ended_on IS NULL)
    OR (started_on IS NOT NULL AND ended_on IS NOT NULL AND started_on <= ended_on)
  ),
  CONSTRAINT case_period_event_case_fkey FOREIGN KEY (case_id) REFERENCES case_record (id),
  CONSTRAINT case_period_event_actor_fkey FOREIGN KEY (actor_id) REFERENCES personnel (id)
);
CREATE INDEX case_period_event_case_idx ON case_period_event (case_id);
CREATE TRIGGER case_period_event_append_only
  BEFORE UPDATE OR DELETE ON case_period_event
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

COMMENT ON TABLE case_period_event IS '#246 期间事件。系统事件与批准后的人工事件都只追加。';

CREATE TABLE case_deadline_approval (
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
  CONSTRAINT case_deadline_approval_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_deadline_approval_kind_ck CHECK (kind IN ('extend', 'period')),
  CONSTRAINT case_deadline_approval_status_ck CHECK (
    status IN ('drafting', 'pending_review', 'pending_approval', 'approved')
  ),
  CONSTRAINT case_deadline_approval_case_fkey FOREIGN KEY (case_id) REFERENCES case_record (id),
  CONSTRAINT case_deadline_approval_drafter_fkey FOREIGN KEY (drafter_id) REFERENCES personnel (id)
);
CREATE INDEX case_deadline_approval_case_idx ON case_deadline_approval (case_id);
CREATE UNIQUE INDEX case_deadline_approval_open_uq
  ON case_deadline_approval (case_id) WHERE status <> 'approved';

CREATE OR REPLACE FUNCTION case_deadline_approval_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% 拒绝 DELETE（#246：期限呈批不物理删除）', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER case_deadline_approval_guard
  BEFORE DELETE ON case_deadline_approval
  FOR EACH ROW EXECUTE FUNCTION case_deadline_approval_guard();

CREATE TABLE case_deadline_approval_version (
  id            TEXT PRIMARY KEY,
  approval_id   TEXT NOT NULL,
  version_no    INTEGER NOT NULL,
  content_json  TEXT NOT NULL,
  created_by    TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_deadline_approval_version_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_deadline_approval_version_no_ck CHECK (version_no >= 1),
  CONSTRAINT case_deadline_approval_version_approval_fkey FOREIGN KEY (approval_id) REFERENCES case_deadline_approval (id),
  CONSTRAINT case_deadline_approval_version_actor_fkey FOREIGN KEY (created_by) REFERENCES personnel (id)
);
CREATE UNIQUE INDEX case_deadline_approval_version_uq
  ON case_deadline_approval_version (approval_id, version_no);
CREATE TRIGGER case_deadline_approval_version_append_only
  BEFORE UPDATE OR DELETE ON case_deadline_approval_version
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

CREATE TABLE case_deadline_approval_step (
  id            TEXT PRIMARY KEY,
  approval_id   TEXT NOT NULL,
  version_no    INTEGER NOT NULL,
  step          TEXT NOT NULL,
  actor_id      TEXT NOT NULL,
  opinion       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_deadline_approval_step_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_deadline_approval_step_kind_ck CHECK (step IN ('submit', 'review', 'approve', 'return')),
  CONSTRAINT case_deadline_approval_step_approval_fkey FOREIGN KEY (approval_id) REFERENCES case_deadline_approval (id),
  CONSTRAINT case_deadline_approval_step_actor_fkey FOREIGN KEY (actor_id) REFERENCES personnel (id)
);
CREATE INDEX case_deadline_approval_step_approval_idx ON case_deadline_approval_step (approval_id);
CREATE TRIGGER case_deadline_approval_step_append_only
  BEFORE UPDATE OR DELETE ON case_deadline_approval_step
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

CREATE TABLE deadline_calendar_install (
  id                 TEXT PRIMARY KEY,
  version            TEXT NOT NULL,
  year               INTEGER NOT NULL,
  holidays           TEXT[] NOT NULL,
  makeup_workdays    TEXT[] NOT NULL,
  source_url         TEXT NOT NULL,
  installed_by       TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT deadline_calendar_install_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT deadline_calendar_install_source_ck CHECK (btrim(source_url) <> ''),
  CONSTRAINT deadline_calendar_install_actor_fkey FOREIGN KEY (installed_by) REFERENCES personnel (id)
);
CREATE TRIGGER deadline_calendar_install_append_only
  BEFORE UPDATE OR DELETE ON deadline_calendar_install
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

COMMENT ON TABLE deadline_calendar_install IS '#246 后装入的工作日历年份。代码常量仍保留 2026 年通知。';
