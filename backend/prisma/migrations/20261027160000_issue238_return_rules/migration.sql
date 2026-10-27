-- #238 退回：审批意见、退回记录、环节失效、签字、材料。都只追加。
-- 立案呈批退回步骤补原因码、退回点、接收人。环节实例仍不改行。

ALTER TABLE filing_approval_step
  ADD COLUMN reason_code TEXT,
  ADD COLUMN return_target TEXT,
  ADD COLUMN receiver_id TEXT;

ALTER TABLE filing_approval_step
  ADD CONSTRAINT filing_approval_step_return_code_ck CHECK (
    reason_code IS NULL OR reason_code IN ('R1','R2','R3','R4','R5','R6','R7','R8','R9','R10')
  ),
  ADD CONSTRAINT filing_approval_step_receiver_fkey FOREIGN KEY (receiver_id) REFERENCES personnel (id);

COMMENT ON COLUMN filing_approval_step.reason_code IS '#238 退回原因。非退回步骤为空。';
COMMENT ON COLUMN filing_approval_step.opinion IS '签署意见，或退回说明。自由文本留本列，不进留痕 detail。';

CREATE TABLE case_approval_opinion (
  id            TEXT PRIMARY KEY,
  case_id       TEXT NOT NULL,
  reason_code   TEXT NOT NULL,
  note          TEXT NOT NULL,
  target_key    TEXT NOT NULL,
  actor_id      TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_approval_opinion_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_approval_opinion_reason_ck CHECK (
    reason_code IN ('R1','R2','R3','R4','R5','R6','R7','R8','R9','R10')
  ),
  CONSTRAINT case_approval_opinion_note_ck CHECK (length(btrim(note)) > 0),
  CONSTRAINT case_approval_opinion_case_fkey FOREIGN KEY (case_id) REFERENCES case_record (id),
  CONSTRAINT case_approval_opinion_actor_fkey FOREIGN KEY (actor_id) REFERENCES personnel (id)
);
CREATE INDEX case_approval_opinion_case_idx ON case_approval_opinion (case_id);
CREATE TRIGGER case_approval_opinion_append_only
  BEFORE UPDATE OR DELETE ON case_approval_opinion
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
COMMENT ON TABLE case_approval_opinion IS '#238 审批意见（追加式）。退回原因写在本表。';

CREATE TABLE case_return (
  id                   TEXT PRIMARY KEY,
  case_id              TEXT NOT NULL,
  opinion_id           TEXT NOT NULL,
  reason_code          TEXT NOT NULL,
  inherited_code       TEXT,
  target_key           TEXT NOT NULL,
  receiver_id          TEXT NOT NULL,
  reflow               BOOLEAN NOT NULL,
  n5                   BOOLEAN NOT NULL,
  entry_seq_before     INTEGER,
  entry_seq_after      INTEGER,
  exit_code            TEXT,
  rehearing_required   BOOLEAN NOT NULL,
  revoke_notice        BOOLEAN NOT NULL,
  actor_id             TEXT NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_return_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_return_reason_ck CHECK (
    reason_code IN ('R1','R2','R3','R4','R5','R6','R7','R8','R9','R10')
  ),
  CONSTRAINT case_return_inherited_ck CHECK (
    inherited_code IS NULL OR inherited_code IN ('R1','R2','R3','R4','R5','R6','R7','R8','R9')
  ),
  CONSTRAINT case_return_exit_ck CHECK (
    exit_code IS NULL OR exit_code IN ('withdraw-after-terminate', 'no-penalty', 'transfer')
  ),
  CONSTRAINT case_return_case_fkey FOREIGN KEY (case_id) REFERENCES case_record (id),
  CONSTRAINT case_return_opinion_fkey FOREIGN KEY (opinion_id) REFERENCES case_approval_opinion (id),
  CONSTRAINT case_return_receiver_fkey FOREIGN KEY (receiver_id) REFERENCES personnel (id),
  CONSTRAINT case_return_actor_fkey FOREIGN KEY (actor_id) REFERENCES personnel (id)
);
CREATE INDEX case_return_case_idx ON case_return (case_id);
CREATE TRIGGER case_return_append_only
  BEFORE UPDATE OR DELETE ON case_return
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
COMMENT ON TABLE case_return IS '#238 退回记录（追加式）。';

CREATE TABLE case_stage_invalidation (
  id           TEXT PRIMARY KEY,
  case_id      TEXT NOT NULL,
  instance_id  TEXT NOT NULL,
  return_id    TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_stage_invalidation_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_stage_invalidation_case_fkey FOREIGN KEY (case_id) REFERENCES case_record (id),
  CONSTRAINT case_stage_invalidation_instance_fkey FOREIGN KEY (instance_id) REFERENCES case_stage_instance (id),
  CONSTRAINT case_stage_invalidation_return_fkey FOREIGN KEY (return_id) REFERENCES case_return (id)
);
CREATE UNIQUE INDEX case_stage_invalidation_instance_uq ON case_stage_invalidation (instance_id);
CREATE INDEX case_stage_invalidation_case_idx ON case_stage_invalidation (case_id);
CREATE TRIGGER case_stage_invalidation_append_only
  BEFORE UPDATE OR DELETE ON case_stage_invalidation
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
COMMENT ON TABLE case_stage_invalidation IS '#238 环节实例失效（追加式）。不改环节实例行。';

CREATE TABLE case_stage_signature (
  id           TEXT PRIMARY KEY,
  case_id      TEXT NOT NULL,
  instance_id  TEXT NOT NULL,
  actor_id     TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_stage_signature_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_stage_signature_case_fkey FOREIGN KEY (case_id) REFERENCES case_record (id),
  CONSTRAINT case_stage_signature_instance_fkey FOREIGN KEY (instance_id) REFERENCES case_stage_instance (id),
  CONSTRAINT case_stage_signature_actor_fkey FOREIGN KEY (actor_id) REFERENCES personnel (id)
);
CREATE INDEX case_stage_signature_case_idx ON case_stage_signature (case_id);
CREATE INDEX case_stage_signature_instance_idx ON case_stage_signature (instance_id);
CREATE TRIGGER case_stage_signature_append_only
  BEFORE UPDATE OR DELETE ON case_stage_signature
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
COMMENT ON TABLE case_stage_signature IS '#238 审核、审批签字（追加式）。失效实例上的签字不能用于新一轮。';

CREATE TABLE case_material (
  id          TEXT PRIMARY KEY,
  case_id     TEXT NOT NULL,
  kind        TEXT NOT NULL,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_material_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_material_kind_ck CHECK (kind IN ('investigation-record', 'notice')),
  CONSTRAINT case_material_case_fkey FOREIGN KEY (case_id) REFERENCES case_record (id)
);
CREATE INDEX case_material_case_idx ON case_material (case_id);
CREATE TRIGGER case_material_append_only
  BEFORE UPDATE OR DELETE ON case_material
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
COMMENT ON TABLE case_material IS '#238 案件材料（追加式）。退回不改已有行。';
