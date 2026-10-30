-- #243 定型（E13／T27）：卷宗材料入卷登记、归档呈批、定型记录。
-- 材料、版本、步骤、定型记录只追加；归档呈批表头只允许推进状态与版本号。

CREATE TABLE case_dossier_material (
  id            TEXT PRIMARY KEY,
  case_id       TEXT NOT NULL,
  item_code     INTEGER NOT NULL,
  title         TEXT NOT NULL,
  note          TEXT,
  stage         TEXT,
  entry_seq     INTEGER,
  evidence_json TEXT,
  recorded_by   TEXT NOT NULL,
  recorded_at   TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_dossier_material_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_dossier_material_item_ck CHECK (item_code BETWEEN 1 AND 21),
  CONSTRAINT case_dossier_material_stage_ck CHECK ((stage IS NULL) = (entry_seq IS NULL)),
  CONSTRAINT case_dossier_material_title_ck CHECK (btrim(title) <> ''),
  CONSTRAINT case_dossier_material_case_fkey FOREIGN KEY (case_id) REFERENCES case_record (id),
  CONSTRAINT case_dossier_material_actor_fkey FOREIGN KEY (recorded_by) REFERENCES personnel (id)
);
CREATE INDEX case_dossier_material_case_item_idx ON case_dossier_material (case_id, item_code);

CREATE TRIGGER case_dossier_material_append_only
  BEFORE UPDATE OR DELETE ON case_dossier_material
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

COMMENT ON TABLE case_dossier_material IS '#243 卷宗材料入卷登记。只追加；失效实例上的材料标非当前。';

CREATE TABLE case_finalize_approval (
  id                 TEXT PRIMARY KEY,
  case_id            TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'drafting',
  current_version_no INTEGER NOT NULL DEFAULT 0,
  drafter_id         TEXT NOT NULL,
  approval_chain_id  TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_finalize_approval_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_finalize_approval_status_ck CHECK (status IN ('drafting', 'pending_review', 'pending_approval', 'approved')),
  CONSTRAINT case_finalize_approval_version_ck CHECK (current_version_no >= 0),
  CONSTRAINT case_finalize_approval_case_fkey FOREIGN KEY (case_id) REFERENCES case_record (id),
  CONSTRAINT case_finalize_approval_drafter_fkey FOREIGN KEY (drafter_id) REFERENCES personnel (id)
);
CREATE INDEX case_finalize_approval_case_idx ON case_finalize_approval (case_id);
-- 一案同时至多一张未批准的归档呈批。
CREATE UNIQUE INDEX case_finalize_approval_open_uq
  ON case_finalize_approval (case_id) WHERE status <> 'approved';

CREATE OR REPLACE FUNCTION case_finalize_approval_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% 拒绝 DELETE（#243：归档呈批不物理删除）', TG_TABLE_NAME;
  END IF;
  IF NEW.case_id IS DISTINCT FROM OLD.case_id
     OR NEW.drafter_id IS DISTINCT FROM OLD.drafter_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION '% 拒绝改写归档呈批归属（#243）', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER case_finalize_approval_guard
  BEFORE UPDATE OR DELETE ON case_finalize_approval
  FOR EACH ROW EXECUTE FUNCTION case_finalize_approval_guard();

COMMENT ON TABLE case_finalize_approval IS '#243 归档（定型）呈批。批准后落 T27 与定型记录。';

CREATE TABLE case_finalize_approval_version (
  id           TEXT PRIMARY KEY,
  approval_id  TEXT NOT NULL,
  version_no   INTEGER NOT NULL,
  content_json TEXT NOT NULL,
  created_by   TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_finalize_approval_version_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_finalize_approval_version_no_ck CHECK (version_no >= 1),
  CONSTRAINT case_finalize_approval_version_fkey FOREIGN KEY (approval_id) REFERENCES case_finalize_approval (id),
  CONSTRAINT case_finalize_approval_version_actor_fkey FOREIGN KEY (created_by) REFERENCES personnel (id)
);
CREATE UNIQUE INDEX case_finalize_approval_version_uq ON case_finalize_approval_version (approval_id, version_no);
CREATE INDEX case_finalize_approval_version_approval_idx ON case_finalize_approval_version (approval_id);

CREATE TRIGGER case_finalize_approval_version_append_only
  BEFORE UPDATE OR DELETE ON case_finalize_approval_version
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

COMMENT ON TABLE case_finalize_approval_version IS '#243 归档呈批正文版本。只追加。';

CREATE TABLE case_finalize_approval_step (
  id          TEXT PRIMARY KEY,
  approval_id TEXT NOT NULL,
  version_no  INTEGER NOT NULL,
  step        TEXT NOT NULL,
  actor_id    TEXT NOT NULL,
  opinion     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_finalize_approval_step_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_finalize_approval_step_step_ck CHECK (step IN ('submit', 'review', 'approve')),
  CONSTRAINT case_finalize_approval_step_fkey FOREIGN KEY (approval_id) REFERENCES case_finalize_approval (id),
  CONSTRAINT case_finalize_approval_step_actor_fkey FOREIGN KEY (actor_id) REFERENCES personnel (id)
);
CREATE INDEX case_finalize_approval_step_approval_idx ON case_finalize_approval_step (approval_id);

CREATE TRIGGER case_finalize_approval_step_append_only
  BEFORE UPDATE OR DELETE ON case_finalize_approval_step
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

COMMENT ON TABLE case_finalize_approval_step IS '#243 归档呈批步骤。只追加。';

CREATE TABLE case_finalize (
  id                       TEXT PRIMARY KEY,
  case_id                  TEXT NOT NULL,
  approval_id              TEXT NOT NULL,
  generation_no            INTEGER NOT NULL,
  conclusion               TEXT NOT NULL,
  checklist_json           TEXT NOT NULL,
  missing_reason           TEXT,
  receipt_deficient        BOOLEAN NOT NULL DEFAULT FALSE,
  materials_rule_id        TEXT NOT NULL,
  materials_rule_version   TEXT NOT NULL,
  exemptions_rule_id       TEXT NOT NULL,
  exemptions_rule_version  TEXT NOT NULL,
  finalized_by             TEXT NOT NULL,
  finalized_at             TIMESTAMPTZ NOT NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_finalize_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_finalize_generation_ck CHECK (generation_no >= 1),
  CONSTRAINT case_finalize_conclusion_ck CHECK (conclusion IN ('complete', 'approved-missing')),
  CONSTRAINT case_finalize_case_fkey FOREIGN KEY (case_id) REFERENCES case_record (id),
  CONSTRAINT case_finalize_approval_fkey FOREIGN KEY (approval_id) REFERENCES case_finalize_approval (id),
  CONSTRAINT case_finalize_actor_fkey FOREIGN KEY (finalized_by) REFERENCES personnel (id)
);
CREATE UNIQUE INDEX case_finalize_approval_uq ON case_finalize (approval_id);
CREATE UNIQUE INDEX case_finalize_generation_uq ON case_finalize (case_id, generation_no);
CREATE INDEX case_finalize_case_idx ON case_finalize (case_id);

CREATE TRIGGER case_finalize_append_only
  BEFORE UPDATE OR DELETE ON case_finalize
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

COMMENT ON TABLE case_finalize IS '#243 定型记录。每次定型一个归档代次；清单与规则版本随代次冻结。';
