-- #235 案件状态机：环节实例、迁移历史、审批链；主状态放开到五态。
-- 环节实例与迁移历史只追加。承办机构仍由 #234 的 case_record_guard 拒绝修改。

ALTER TABLE case_record DROP CONSTRAINT case_record_status_ck;
ALTER TABLE case_record ADD CONSTRAINT case_record_status_ck CHECK (
  status IN ('in_progress', 'terminated_pending', 'withdrawn', 'closed', 'finalized')
);

CREATE TABLE case_stage_instance (
  id                TEXT PRIMARY KEY,
  case_id           TEXT NOT NULL,
  stage             TEXT NOT NULL,
  entry_seq         INTEGER NOT NULL,
  status            TEXT NOT NULL,
  entered_at        TIMESTAMPTZ NOT NULL,
  entered_by        TEXT NOT NULL,
  transition_code   TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_stage_instance_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_stage_instance_stage_ck CHECK (
    stage IN ('E01','E02','E03','E04','E05','E06','E07','E08','E09','E10','E11','E12','E13')
  ),
  CONSTRAINT case_stage_instance_seq_ck CHECK (entry_seq >= 1),
  CONSTRAINT case_stage_instance_status_ck CHECK (
    status IN ('drafting', 'pending_approval', 'waiting_prerequisite', 'completed')
  ),
  CONSTRAINT case_stage_instance_case_fkey FOREIGN KEY (case_id) REFERENCES case_record (id),
  CONSTRAINT case_stage_instance_actor_fkey FOREIGN KEY (entered_by) REFERENCES personnel (id)
);
CREATE UNIQUE INDEX case_stage_instance_seq_uq ON case_stage_instance (case_id, stage, entry_seq);
CREATE INDEX case_stage_instance_case_idx ON case_stage_instance (case_id);
CREATE TRIGGER case_stage_instance_append_only
  BEFORE UPDATE OR DELETE ON case_stage_instance
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

COMMENT ON TABLE case_stage_instance IS '#235 环节实例（追加式）。再次进入时新行次序号加 1，旧行只读。';

CREATE TABLE case_transition (
  id                TEXT PRIMARY KEY,
  case_id           TEXT,
  clue_id           TEXT,
  transition_code   TEXT NOT NULL,
  actor_id          TEXT NOT NULL,
  from_json         TEXT NOT NULL,
  to_json           TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_transition_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_transition_subject_ck CHECK (case_id IS NOT NULL OR clue_id IS NOT NULL),
  CONSTRAINT case_transition_case_fkey FOREIGN KEY (case_id) REFERENCES case_record (id),
  CONSTRAINT case_transition_clue_fkey FOREIGN KEY (clue_id) REFERENCES clue (id),
  CONSTRAINT case_transition_actor_fkey FOREIGN KEY (actor_id) REFERENCES personnel (id)
);
CREATE INDEX case_transition_case_idx ON case_transition (case_id);
CREATE INDEX case_transition_clue_idx ON case_transition (clue_id);
CREATE TRIGGER case_transition_append_only
  BEFORE UPDATE OR DELETE ON case_transition
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

COMMENT ON TABLE case_transition IS '#235 迁移历史（追加式）。T02 可以只有线索、没有案件。';

CREATE TABLE case_approval_chain (
  id          TEXT PRIMARY KEY,
  case_id     TEXT NOT NULL,
  kind        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'in_flight',
  opened_by   TEXT NOT NULL,
  opened_at   TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_approval_chain_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_approval_chain_kind_ck CHECK (kind ~ '^[a-z0-9-]{1,40}$'),
  CONSTRAINT case_approval_chain_status_ck CHECK (status IN ('in_flight', 'closed')),
  CONSTRAINT case_approval_chain_case_fkey FOREIGN KEY (case_id) REFERENCES case_record (id),
  CONSTRAINT case_approval_chain_actor_fkey FOREIGN KEY (opened_by) REFERENCES personnel (id)
);
CREATE INDEX case_approval_chain_case_idx ON case_approval_chain (case_id, status);
-- X18：同一案件同时至多一条进行中的审批链（立案呈批的在途另由 filing_approval 部分唯一索引保证）。
CREATE UNIQUE INDEX case_approval_chain_inflight_uq ON case_approval_chain (case_id) WHERE status = 'in_flight';

COMMENT ON TABLE case_approval_chain IS '#235 案件审批链。进行中至多一条；立案呈批计入 X18 时与本表一起数。';
