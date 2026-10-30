-- #270 决定、送达、执行记载与结案（T23–T26）。
-- 决定呈批与结案呈批：表头只允许推进状态与版本号；正文版本、步骤只追加。
-- 送达、执行记载、结案记录只追加。
-- X16、X11 的阻断不改业务行；X10 警告同样不改业务行。

CREATE TABLE case_decision_approval (
  id                 TEXT PRIMARY KEY,
  case_id            TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'drafting',
  current_version_no INTEGER NOT NULL DEFAULT 0,
  drafter_id         TEXT NOT NULL,
  approval_chain_id  TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_decision_approval_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_decision_approval_status_ck CHECK (status IN ('drafting', 'pending_review', 'pending_approval', 'approved')),
  CONSTRAINT case_decision_approval_version_ck CHECK (current_version_no >= 0),
  CONSTRAINT case_decision_approval_case_fkey FOREIGN KEY (case_id) REFERENCES case_record (id),
  CONSTRAINT case_decision_approval_drafter_fkey FOREIGN KEY (drafter_id) REFERENCES personnel (id)
);
CREATE INDEX case_decision_approval_case_idx ON case_decision_approval (case_id);
-- 一案同时至多一张未批准的决定呈批。
CREATE UNIQUE INDEX case_decision_approval_open_uq
  ON case_decision_approval (case_id) WHERE status <> 'approved';

CREATE OR REPLACE FUNCTION case_decision_approval_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% 拒绝 DELETE（#270：决定呈批不物理删除）', TG_TABLE_NAME;
  END IF;
  IF NEW.case_id IS DISTINCT FROM OLD.case_id
     OR NEW.drafter_id IS DISTINCT FROM OLD.drafter_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION '% 拒绝改写决定呈批归属（#270）', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER case_decision_approval_guard
  BEFORE UPDATE OR DELETE ON case_decision_approval
  FOR EACH ROW EXECUTE FUNCTION case_decision_approval_guard();

COMMENT ON TABLE case_decision_approval IS '#270 决定（E09／T23）呈批。批准后落 T23 与决定书记载。';

CREATE TABLE case_decision_approval_version (
  id           TEXT PRIMARY KEY,
  approval_id  TEXT NOT NULL,
  version_no   INTEGER NOT NULL,
  content_json TEXT NOT NULL,
  created_by   TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_decision_approval_version_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_decision_approval_version_no_ck CHECK (version_no >= 1),
  CONSTRAINT case_decision_approval_version_fkey FOREIGN KEY (approval_id) REFERENCES case_decision_approval (id),
  CONSTRAINT case_decision_approval_version_actor_fkey FOREIGN KEY (created_by) REFERENCES personnel (id)
);
CREATE UNIQUE INDEX case_decision_approval_version_uq ON case_decision_approval_version (approval_id, version_no);
CREATE INDEX case_decision_approval_version_approval_idx ON case_decision_approval_version (approval_id);

CREATE TRIGGER case_decision_approval_version_append_only
  BEFORE UPDATE OR DELETE ON case_decision_approval_version
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

COMMENT ON TABLE case_decision_approval_version IS '#270 决定呈批正文版本。只追加。';

CREATE TABLE case_decision_approval_step (
  id          TEXT PRIMARY KEY,
  approval_id TEXT NOT NULL,
  version_no  INTEGER NOT NULL,
  step        TEXT NOT NULL,
  actor_id    TEXT NOT NULL,
  opinion     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_decision_approval_step_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_decision_approval_step_step_ck CHECK (step IN ('submit', 'review', 'approve')),
  CONSTRAINT case_decision_approval_step_fkey FOREIGN KEY (approval_id) REFERENCES case_decision_approval (id),
  CONSTRAINT case_decision_approval_step_actor_fkey FOREIGN KEY (actor_id) REFERENCES personnel (id)
);
CREATE INDEX case_decision_approval_step_approval_idx ON case_decision_approval_step (approval_id);

CREATE TRIGGER case_decision_approval_step_append_only
  BEFORE UPDATE OR DELETE ON case_decision_approval_step
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

COMMENT ON TABLE case_decision_approval_step IS '#270 决定呈批步骤。只追加。';

CREATE TABLE case_delivery (
  id                         TEXT PRIMARY KEY,
  case_id                    TEXT NOT NULL,
  kind                       TEXT NOT NULL,
  document_kind              TEXT,
  delivered_on               TEXT NOT NULL,
  deliverers_json            TEXT NOT NULL DEFAULT '[]',
  reason_record              TEXT,
  announcement_materials_json TEXT NOT NULL DEFAULT '[]',
  note                       TEXT,
  decision_approval_id       TEXT,
  recorded_by                TEXT NOT NULL,
  recorded_at                TIMESTAMPTZ NOT NULL,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_delivery_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_delivery_kind_ck CHECK (kind IN ('receipt', 'announcement')),
  CONSTRAINT case_delivery_document_ck CHECK (
    document_kind IS NULL OR document_kind IN ('penalty-decision', 'no-penalty-decision', 'order-correction-notice')
  ),
  CONSTRAINT case_delivery_day_ck CHECK (delivered_on ~ '^\d{4}-\d{2}-\d{2}$'),
  CONSTRAINT case_delivery_receipt_ck CHECK (
    kind <> 'receipt' OR (reason_record IS NULL AND announcement_materials_json = '[]')
  ),
  CONSTRAINT case_delivery_announcement_ck CHECK (
    kind <> 'announcement'
    OR (reason_record IS NOT NULL AND btrim(reason_record) <> '' AND announcement_materials_json <> '[]')
  ),
  CONSTRAINT case_delivery_case_fkey FOREIGN KEY (case_id) REFERENCES case_record (id),
  CONSTRAINT case_delivery_actor_fkey FOREIGN KEY (recorded_by) REFERENCES personnel (id)
);
CREATE INDEX case_delivery_case_idx ON case_delivery (case_id);

CREATE TRIGGER case_delivery_append_only
  BEFORE UPDATE OR DELETE ON case_delivery
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

COMMENT ON TABLE case_delivery IS '#270 送达记载（T24）。只追加。Q27：回证，或公告原因经过加公告材料。';

CREATE TABLE case_execution_record (
  id               TEXT PRIMARY KEY,
  case_id          TEXT NOT NULL,
  kind             TEXT NOT NULL,
  note             TEXT,
  attachments_json TEXT NOT NULL DEFAULT '[]',
  recorded_by      TEXT NOT NULL,
  recorded_at      TIMESTAMPTZ NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_execution_record_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_execution_record_kind_ck CHECK (kind IN ('court-enforcement', 'fulfilled', 'other')),
  CONSTRAINT case_execution_record_case_fkey FOREIGN KEY (case_id) REFERENCES case_record (id),
  CONSTRAINT case_execution_record_actor_fkey FOREIGN KEY (recorded_by) REFERENCES personnel (id)
);
CREATE INDEX case_execution_record_case_idx ON case_execution_record (case_id);

CREATE TRIGGER case_execution_record_append_only
  BEFORE UPDATE OR DELETE ON case_execution_record
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

COMMENT ON TABLE case_execution_record IS '#270 执行记载（T25）。只追加；强制类与履行类须附凭证。';

CREATE TABLE case_closure_approval (
  id                 TEXT PRIMARY KEY,
  case_id            TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'drafting',
  current_version_no INTEGER NOT NULL DEFAULT 0,
  drafter_id         TEXT NOT NULL,
  approval_chain_id  TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_closure_approval_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_closure_approval_status_ck CHECK (status IN ('drafting', 'pending_review', 'pending_approval', 'approved')),
  CONSTRAINT case_closure_approval_version_ck CHECK (current_version_no >= 0),
  CONSTRAINT case_closure_approval_case_fkey FOREIGN KEY (case_id) REFERENCES case_record (id),
  CONSTRAINT case_closure_approval_drafter_fkey FOREIGN KEY (drafter_id) REFERENCES personnel (id)
);
CREATE INDEX case_closure_approval_case_idx ON case_closure_approval (case_id);
-- 一案同时至多一张未批准的结案呈批。
CREATE UNIQUE INDEX case_closure_approval_open_uq
  ON case_closure_approval (case_id) WHERE status <> 'approved';

CREATE OR REPLACE FUNCTION case_closure_approval_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% 拒绝 DELETE（#270：结案呈批不物理删除）', TG_TABLE_NAME;
  END IF;
  IF NEW.case_id IS DISTINCT FROM OLD.case_id
     OR NEW.drafter_id IS DISTINCT FROM OLD.drafter_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION '% 拒绝改写结案呈批归属（#270）', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER case_closure_approval_guard
  BEFORE UPDATE OR DELETE ON case_closure_approval
  FOR EACH ROW EXECUTE FUNCTION case_closure_approval_guard();

COMMENT ON TABLE case_closure_approval IS '#270 结案（T26）呈批。批准即办结，不等定型。';

CREATE TABLE case_closure_approval_version (
  id           TEXT PRIMARY KEY,
  approval_id  TEXT NOT NULL,
  version_no   INTEGER NOT NULL,
  content_json TEXT NOT NULL,
  created_by   TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_closure_approval_version_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_closure_approval_version_no_ck CHECK (version_no >= 1),
  CONSTRAINT case_closure_approval_version_fkey FOREIGN KEY (approval_id) REFERENCES case_closure_approval (id),
  CONSTRAINT case_closure_approval_version_actor_fkey FOREIGN KEY (created_by) REFERENCES personnel (id)
);
CREATE UNIQUE INDEX case_closure_approval_version_uq ON case_closure_approval_version (approval_id, version_no);
CREATE INDEX case_closure_approval_version_approval_idx ON case_closure_approval_version (approval_id);

CREATE TRIGGER case_closure_approval_version_append_only
  BEFORE UPDATE OR DELETE ON case_closure_approval_version
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

COMMENT ON TABLE case_closure_approval_version IS '#270 结案呈批正文版本。只追加。';

CREATE TABLE case_closure_approval_step (
  id          TEXT PRIMARY KEY,
  approval_id TEXT NOT NULL,
  version_no  INTEGER NOT NULL,
  step        TEXT NOT NULL,
  actor_id    TEXT NOT NULL,
  opinion     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_closure_approval_step_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_closure_approval_step_step_ck CHECK (step IN ('submit', 'review', 'approve')),
  CONSTRAINT case_closure_approval_step_fkey FOREIGN KEY (approval_id) REFERENCES case_closure_approval (id),
  CONSTRAINT case_closure_approval_step_actor_fkey FOREIGN KEY (actor_id) REFERENCES personnel (id)
);
CREATE INDEX case_closure_approval_step_approval_idx ON case_closure_approval_step (approval_id);

CREATE TRIGGER case_closure_approval_step_append_only
  BEFORE UPDATE OR DELETE ON case_closure_approval_step
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

COMMENT ON TABLE case_closure_approval_step IS '#270 结案呈批步骤。只追加。';

CREATE TABLE case_closure (
  id                    TEXT PRIMARY KEY,
  case_id               TEXT NOT NULL,
  approval_id           TEXT NOT NULL,
  branch                TEXT NOT NULL,
  checklist_json        TEXT NOT NULL,
  materials_rule_id     TEXT NOT NULL,
  materials_rule_version TEXT NOT NULL,
  closed_by             TEXT NOT NULL,
  closed_at             TIMESTAMPTZ NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_closure_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_closure_branch_ck CHECK (branch IN ('penalty', 'no-penalty')),
  CONSTRAINT case_closure_case_uq UNIQUE (case_id),
  CONSTRAINT case_closure_approval_uq UNIQUE (approval_id),
  CONSTRAINT case_closure_case_fkey FOREIGN KEY (case_id) REFERENCES case_record (id),
  CONSTRAINT case_closure_actor_fkey FOREIGN KEY (closed_by) REFERENCES personnel (id)
);
CREATE INDEX case_closure_case_idx ON case_closure (case_id);

CREATE TRIGGER case_closure_append_only
  BEFORE UPDATE OR DELETE ON case_closure
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

COMMENT ON TABLE case_closure IS '#270 结案记录。一案一行；清单与规则版本随结案冻结。';