-- #242 案件阶段三类移送（管辖、涉刑、党纪政务）：移送呈批、移送记载、附件与回证、外部决定与人工出口。
-- 呈批表头随审核、批准推进；版本、步骤、记载、附件、外部决定与出口步骤只追加。

CREATE TABLE case_transfer_approval (
  id                 TEXT PRIMARY KEY,
  case_id            TEXT NOT NULL,
  kind               TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'drafting',
  current_version_no INTEGER NOT NULL DEFAULT 0,
  drafter_id         TEXT NOT NULL,
  approval_chain_id  TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_transfer_approval_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_transfer_approval_kind_ck CHECK (kind IN ('jurisdiction', 'criminal', 'party-discipline')),
  CONSTRAINT case_transfer_approval_status_ck CHECK (status IN ('drafting', 'pending_review', 'pending_approval', 'approved', 'withdrawn')),
  CONSTRAINT case_transfer_approval_version_ck CHECK (current_version_no >= 0),
  CONSTRAINT case_transfer_approval_case_fkey FOREIGN KEY (case_id) REFERENCES case_record (id),
  CONSTRAINT case_transfer_approval_drafter_fkey FOREIGN KEY (drafter_id) REFERENCES personnel (id)
);
CREATE INDEX case_transfer_approval_case_idx ON case_transfer_approval (case_id);

CREATE OR REPLACE FUNCTION case_transfer_approval_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% 拒绝 DELETE（#242：移送呈批不物理删除）', TG_TABLE_NAME;
  END IF;
  IF NEW.case_id IS DISTINCT FROM OLD.case_id
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.drafter_id IS DISTINCT FROM OLD.drafter_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION '% 拒绝改写移送呈批归属（#242）', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER case_transfer_approval_guard
  BEFORE UPDATE OR DELETE ON case_transfer_approval
  FOR EACH ROW EXECUTE FUNCTION case_transfer_approval_guard();

CREATE TABLE case_transfer_approval_version (
  id           TEXT PRIMARY KEY,
  approval_id  TEXT NOT NULL,
  version_no   INTEGER NOT NULL,
  content_json TEXT NOT NULL,
  created_by   TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_transfer_approval_version_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_transfer_approval_version_no_ck CHECK (version_no >= 1),
  CONSTRAINT case_transfer_approval_version_fkey FOREIGN KEY (approval_id) REFERENCES case_transfer_approval (id),
  CONSTRAINT case_transfer_approval_version_actor_fkey FOREIGN KEY (created_by) REFERENCES personnel (id)
);
CREATE UNIQUE INDEX case_transfer_approval_version_uq ON case_transfer_approval_version (approval_id, version_no);
CREATE INDEX case_transfer_approval_version_approval_idx ON case_transfer_approval_version (approval_id);

CREATE OR REPLACE FUNCTION case_transfer_approval_version_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% 只追加（#242）', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER case_transfer_approval_version_guard
  BEFORE UPDATE OR DELETE ON case_transfer_approval_version
  FOR EACH ROW EXECUTE FUNCTION case_transfer_approval_version_guard();

CREATE TABLE case_transfer_approval_step (
  id          TEXT PRIMARY KEY,
  approval_id TEXT NOT NULL,
  version_no  INTEGER NOT NULL,
  step        TEXT NOT NULL,
  actor_id    TEXT NOT NULL,
  opinion     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_transfer_approval_step_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_transfer_approval_step_step_ck CHECK (step IN ('submit', 'review', 'approve', 'withdraw')),
  CONSTRAINT case_transfer_approval_step_fkey FOREIGN KEY (approval_id) REFERENCES case_transfer_approval (id),
  CONSTRAINT case_transfer_approval_step_actor_fkey FOREIGN KEY (actor_id) REFERENCES personnel (id)
);
CREATE INDEX case_transfer_approval_step_approval_idx ON case_transfer_approval_step (approval_id);

CREATE OR REPLACE FUNCTION case_transfer_approval_step_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% 只追加（#242）', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER case_transfer_approval_step_guard
  BEFORE UPDATE OR DELETE ON case_transfer_approval_step
  FOR EACH ROW EXECUTE FUNCTION case_transfer_approval_step_guard();

CREATE TABLE case_transfer (
  id            TEXT PRIMARY KEY,
  case_id       TEXT NOT NULL,
  kind          TEXT NOT NULL,
  receiving_org TEXT NOT NULL,
  document_no   TEXT NOT NULL,
  letter_date   TEXT NOT NULL,
  reason        TEXT NOT NULL,
  approval_id   TEXT NOT NULL,
  recorded_by   TEXT NOT NULL,
  recorded_at   TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_transfer_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_transfer_kind_ck CHECK (kind IN ('jurisdiction', 'criminal', 'party-discipline')),
  CONSTRAINT case_transfer_case_fkey FOREIGN KEY (case_id) REFERENCES case_record (id),
  CONSTRAINT case_transfer_approval_fkey FOREIGN KEY (approval_id) REFERENCES case_transfer_approval (id),
  CONSTRAINT case_transfer_actor_fkey FOREIGN KEY (recorded_by) REFERENCES personnel (id)
);
CREATE UNIQUE INDEX case_transfer_approval_uq ON case_transfer (approval_id);
CREATE INDEX case_transfer_case_idx ON case_transfer (case_id);

CREATE OR REPLACE FUNCTION case_transfer_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% 只追加（#242：移送记载不改不删）', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER case_transfer_guard
  BEFORE UPDATE OR DELETE ON case_transfer
  FOR EACH ROW EXECUTE FUNCTION case_transfer_guard();

CREATE TABLE case_transfer_file (
  id           TEXT PRIMARY KEY,
  case_id      TEXT NOT NULL,
  approval_id  TEXT,
  transfer_id  TEXT,
  kind         TEXT NOT NULL,
  file_key     TEXT NOT NULL,
  version_id   TEXT NOT NULL,
  file_name    TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_size    INTEGER NOT NULL,
  digest       TEXT NOT NULL,
  uploaded_by  TEXT NOT NULL,
  uploaded_at  TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_transfer_file_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_transfer_file_kind_ck CHECK (kind IN ('attachment', 'receipt')),
  CONSTRAINT case_transfer_file_target_ck CHECK (
    (kind = 'attachment' AND approval_id IS NOT NULL AND transfer_id IS NULL)
    OR (kind = 'receipt' AND transfer_id IS NOT NULL)
  ),
  CONSTRAINT case_transfer_file_case_fkey FOREIGN KEY (case_id) REFERENCES case_record (id),
  CONSTRAINT case_transfer_file_approval_fkey FOREIGN KEY (approval_id) REFERENCES case_transfer_approval (id),
  CONSTRAINT case_transfer_file_transfer_fkey FOREIGN KEY (transfer_id) REFERENCES case_transfer (id),
  CONSTRAINT case_transfer_file_actor_fkey FOREIGN KEY (uploaded_by) REFERENCES personnel (id)
);
CREATE INDEX case_transfer_file_approval_idx ON case_transfer_file (approval_id);
CREATE INDEX case_transfer_file_transfer_idx ON case_transfer_file (transfer_id);
CREATE INDEX case_transfer_file_case_idx ON case_transfer_file (case_id);

CREATE OR REPLACE FUNCTION case_transfer_file_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% 只追加（#242：附件与回证不改不删）', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER case_transfer_file_guard
  BEFORE UPDATE OR DELETE ON case_transfer_file
  FOR EACH ROW EXECUTE FUNCTION case_transfer_file_guard();

CREATE TABLE case_criminal_decision (
  id                 TEXT PRIMARY KEY,
  case_id            TEXT NOT NULL,
  source             TEXT NOT NULL,
  notified_on        TEXT NOT NULL,
  reason             TEXT NOT NULL,
  case_returned      BOOLEAN NOT NULL,
  returned_list_json TEXT NOT NULL DEFAULT '[]',
  review_json        TEXT NOT NULL DEFAULT '{}',
  party_notice_json  TEXT NOT NULL DEFAULT '{}',
  recorded_by        TEXT NOT NULL,
  recorded_at        TIMESTAMPTZ NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_criminal_decision_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_criminal_decision_source_ck CHECK (source IN ('police', 'procuratorate')),
  CONSTRAINT case_criminal_decision_case_fkey FOREIGN KEY (case_id) REFERENCES case_record (id),
  CONSTRAINT case_criminal_decision_actor_fkey FOREIGN KEY (recorded_by) REFERENCES personnel (id)
);
CREATE INDEX case_criminal_decision_case_idx ON case_criminal_decision (case_id);

CREATE OR REPLACE FUNCTION case_criminal_decision_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% 只追加（#242：外部决定记载不改不删）', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER case_criminal_decision_guard
  BEFORE UPDATE OR DELETE ON case_criminal_decision
  FOR EACH ROW EXECUTE FUNCTION case_criminal_decision_guard();

CREATE TABLE case_criminal_outlet (
  id               TEXT PRIMARY KEY,
  case_id          TEXT NOT NULL,
  decision_id      TEXT NOT NULL,
  outlet           TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'drafting',
  content_json     TEXT NOT NULL,
  drafter_id       TEXT NOT NULL,
  approval_chain_id TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_criminal_outlet_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_criminal_outlet_outlet_ck CHECK (outlet IN ('investigate-again', 'close-or-other')),
  CONSTRAINT case_criminal_outlet_status_ck CHECK (status IN ('drafting', 'pending_approval', 'approved', 'withdrawn')),
  CONSTRAINT case_criminal_outlet_case_fkey FOREIGN KEY (case_id) REFERENCES case_record (id),
  CONSTRAINT case_criminal_outlet_decision_fkey FOREIGN KEY (decision_id) REFERENCES case_criminal_decision (id),
  CONSTRAINT case_criminal_outlet_drafter_fkey FOREIGN KEY (drafter_id) REFERENCES personnel (id)
);
CREATE INDEX case_criminal_outlet_case_idx ON case_criminal_outlet (case_id);
CREATE INDEX case_criminal_outlet_decision_idx ON case_criminal_outlet (decision_id);
-- 同一次外部决定至多一个在途出口、至多一个已批准出口（A、B 互斥）。
CREATE UNIQUE INDEX case_criminal_outlet_pending_uq ON case_criminal_outlet (decision_id)
  WHERE status = 'pending_approval';
CREATE UNIQUE INDEX case_criminal_outlet_approved_uq ON case_criminal_outlet (decision_id)
  WHERE status = 'approved';

CREATE OR REPLACE FUNCTION case_criminal_outlet_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% 拒绝 DELETE（#242：人工出口不物理删除）', TG_TABLE_NAME;
  END IF;
  IF NEW.case_id IS DISTINCT FROM OLD.case_id
     OR NEW.decision_id IS DISTINCT FROM OLD.decision_id
     OR NEW.outlet IS DISTINCT FROM OLD.outlet
     OR NEW.content_json IS DISTINCT FROM OLD.content_json
     OR NEW.drafter_id IS DISTINCT FROM OLD.drafter_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION '% 拒绝改写人工出口正文与归属（#242）', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER case_criminal_outlet_guard
  BEFORE UPDATE OR DELETE ON case_criminal_outlet
  FOR EACH ROW EXECUTE FUNCTION case_criminal_outlet_guard();

CREATE TABLE case_criminal_outlet_step (
  id         TEXT PRIMARY KEY,
  outlet_id  TEXT NOT NULL,
  step       TEXT NOT NULL,
  actor_id   TEXT NOT NULL,
  opinion    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_criminal_outlet_step_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_criminal_outlet_step_step_ck CHECK (step IN ('submit', 'approve', 'withdraw')),
  CONSTRAINT case_criminal_outlet_step_fkey FOREIGN KEY (outlet_id) REFERENCES case_criminal_outlet (id),
  CONSTRAINT case_criminal_outlet_step_actor_fkey FOREIGN KEY (actor_id) REFERENCES personnel (id)
);
CREATE INDEX case_criminal_outlet_step_outlet_idx ON case_criminal_outlet_step (outlet_id);

CREATE OR REPLACE FUNCTION case_criminal_outlet_step_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% 只追加（#242）', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER case_criminal_outlet_step_guard
  BEFORE UPDATE OR DELETE ON case_criminal_outlet_step
  FOR EACH ROW EXECUTE FUNCTION case_criminal_outlet_step_guard();
-- #242：案件标记新增「已形成涉刑移送记载」。同步 case_marker 的取值约束（#272 R-02 复用同一机制）。
ALTER TABLE case_marker DROP CONSTRAINT case_marker_key_ck;
ALTER TABLE case_marker ADD CONSTRAINT case_marker_key_ck CHECK (
  marker IN ('notice-served', 'notice-waiting', 'deemed-waived', 'hearing-entered', 'hearing-terminated', 'criminal-transfer')
);
