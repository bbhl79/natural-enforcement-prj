-- #239 改派呈批（T33）与回避后材料效力认定。
-- 改派：一案至多一条待批准；批准后关闭旧承办人员行、追加新行。
-- 效力认定：只追加，触发器拒 UPDATE/DELETE。
-- case_handler 的唯一性收窄为「未结束的行至多一条同案同人同角色」，
-- 以便同一人换下后再次被指派时保留履历。

CREATE TABLE case_reassignment (
  id                  TEXT PRIMARY KEY,
  case_id             TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending_approval',
  reason_code         TEXT NOT NULL,
  note                TEXT NOT NULL DEFAULT '',
  conflict_lineage_id TEXT,
  requested_by        TEXT NOT NULL,
  requested_at        TIMESTAMPTZ NOT NULL,
  approved_by         TEXT,
  approved_at         TIMESTAMPTZ,
  approval_chain_id   TEXT,
  proposed_json       TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_reassignment_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_reassignment_status_ck CHECK (status IN ('pending_approval', 'approved')),
  CONSTRAINT case_reassignment_reason_ck CHECK (reason_code IN ('transfer', 'leave', 'recusal', 'other')),
  CONSTRAINT case_reassignment_case_fkey FOREIGN KEY (case_id) REFERENCES case_record (id),
  CONSTRAINT case_reassignment_requester_fkey FOREIGN KEY (requested_by) REFERENCES personnel (id),
  CONSTRAINT case_reassignment_approver_fkey FOREIGN KEY (approved_by) REFERENCES personnel (id),
  CONSTRAINT case_reassignment_chain_fkey FOREIGN KEY (approval_chain_id) REFERENCES case_approval_chain (id)
);
CREATE INDEX case_reassignment_case_idx ON case_reassignment (case_id, requested_at);
CREATE UNIQUE INDEX case_reassignment_pending_uq ON case_reassignment (case_id) WHERE status = 'pending_approval';

COMMENT ON TABLE case_reassignment IS '#239 改派呈批（T33）。发起即待批准；批准后才换人。一案至多一条待批准。';

CREATE TABLE case_material_effectiveness (
  id              TEXT PRIMARY KEY,
  case_id         TEXT NOT NULL,
  material_id     TEXT NOT NULL,
  reassignment_id TEXT NOT NULL,
  conclusion      TEXT NOT NULL,
  reason          TEXT NOT NULL,
  determined_by   TEXT NOT NULL,
  determined_at   TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_material_effectiveness_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_material_effectiveness_conclusion_ck CHECK (conclusion IN ('valid', 'invalid', 'needs-correction')),
  CONSTRAINT case_material_effectiveness_case_fkey FOREIGN KEY (case_id) REFERENCES case_record (id),
  CONSTRAINT case_material_effectiveness_material_fkey FOREIGN KEY (material_id) REFERENCES case_material (id),
  CONSTRAINT case_material_effectiveness_reassignment_fkey FOREIGN KEY (reassignment_id) REFERENCES case_reassignment (id),
  CONSTRAINT case_material_effectiveness_actor_fkey FOREIGN KEY (determined_by) REFERENCES personnel (id)
);
CREATE INDEX case_material_effectiveness_case_idx ON case_material_effectiveness (case_id, material_id);
CREATE TRIGGER case_material_effectiveness_append_only
  BEFORE UPDATE OR DELETE ON case_material_effectiveness
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

COMMENT ON TABLE case_material_effectiveness IS '#239 调查材料效力认定（追加式）。回避改派生效后由接手主办逐件认定，不另设呈批。';

DROP INDEX case_handler_uq;
CREATE UNIQUE INDEX case_handler_active_uq ON case_handler (case_id, personnel_id, role) WHERE ended_at IS NULL;
CREATE INDEX case_handler_history_idx ON case_handler (case_id, ended_at);