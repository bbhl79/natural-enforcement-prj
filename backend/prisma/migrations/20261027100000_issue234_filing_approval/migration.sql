-- #234 立案呈批（《立案（不予立案）呈批表》，追加式版本＋审批步骤）与案件最小模型。
-- 审批链最小固定形态放在案件段（backend/approval 仍是 #51 空壳），字段供 #235 无损接管。

CREATE TABLE filing_approval (
  id                  TEXT PRIMARY KEY,
  clue_id             TEXT NOT NULL,
  drafter_id          TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'drafting',
  admin_review        TEXT,
  current_version_no  INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT filing_approval_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT filing_approval_status_ck CHECK (status IN ('drafting', 'pending_review', 'pending_approval', 'approved')),
  CONSTRAINT filing_approval_admin_review_ck CHECK (admin_review IS NULL OR admin_review IN ('skip', 'one-level')),
  CONSTRAINT filing_approval_clue_fkey FOREIGN KEY (clue_id) REFERENCES clue (id),
  CONSTRAINT filing_approval_drafter_fkey FOREIGN KEY (drafter_id) REFERENCES personnel (id)
);
CREATE INDEX filing_approval_clue_idx ON filing_approval (clue_id);
CREATE INDEX filing_approval_status_idx ON filing_approval (status);
-- 一条线索同时至多一张未批准的立案呈批（X18 同一思路）。
CREATE UNIQUE INDEX filing_approval_open_clue_uq ON filing_approval (clue_id) WHERE status <> 'approved';

COMMENT ON TABLE filing_approval IS '#234 立案（不予立案）呈批表表头：状态随审批链推进；正文在 filing_approval_version（追加式）。';
COMMENT ON COLUMN filing_approval.admin_review IS '提交时取用的行政审核配置：skip 跳过 | one-level 一级。';

CREATE TABLE filing_approval_version (
  id            TEXT PRIMARY KEY,
  approval_id   TEXT NOT NULL,
  version_no    INTEGER NOT NULL,
  conclusion    TEXT NOT NULL,
  content_json  TEXT NOT NULL,
  created_by    TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT filing_approval_version_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT filing_approval_version_conclusion_ck CHECK (conclusion IN ('file', 'no-case')),
  CONSTRAINT filing_approval_version_no_ck CHECK (version_no >= 1),
  CONSTRAINT filing_approval_version_approval_fkey FOREIGN KEY (approval_id) REFERENCES filing_approval (id)
);
CREATE UNIQUE INDEX filing_approval_version_no_uq ON filing_approval_version (approval_id, version_no);
CREATE TRIGGER filing_approval_version_append_only
  BEFORE UPDATE OR DELETE ON filing_approval_version
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

COMMENT ON TABLE filing_approval_version IS '#234 呈批正文版本（追加式，触发器拒 UPDATE/DELETE）：结论、当事人或不予立案理由快照。';

CREATE TABLE filing_approval_step (
  id           TEXT PRIMARY KEY,
  approval_id  TEXT NOT NULL,
  version_no   INTEGER NOT NULL,
  step         TEXT NOT NULL,
  actor_id     TEXT NOT NULL,
  opinion      TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT filing_approval_step_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT filing_approval_step_ck CHECK (step IN ('submit', 'review', 'approve', 'return', 'withdraw')),
  -- 退回、撤回理由必填（#234 范围 2）。
  CONSTRAINT filing_approval_step_reason_ck CHECK (
    step NOT IN ('return', 'withdraw') OR char_length(btrim(coalesce(opinion, ''))) > 0
  ),
  CONSTRAINT filing_approval_step_approval_fkey FOREIGN KEY (approval_id) REFERENCES filing_approval (id),
  CONSTRAINT filing_approval_step_actor_fkey FOREIGN KEY (actor_id) REFERENCES personnel (id)
);
CREATE INDEX filing_approval_step_approval_idx ON filing_approval_step (approval_id);
CREATE TRIGGER filing_approval_step_append_only
  BEFORE UPDATE OR DELETE ON filing_approval_step
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

COMMENT ON TABLE filing_approval_step IS '#234 审批步骤（追加式）：提交、行政审核、行政审批、退回、撤回；退回或撤回后已签意见保留。';

CREATE TABLE case_record (
  id                  TEXT PRIMARY KEY,
  handling_org_id     TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'in_progress',
  current_stage       TEXT NOT NULL,
  stage_entry_seq     INTEGER NOT NULL,
  party_names         TEXT[] NOT NULL,
  filing_approval_id  TEXT NOT NULL,
  opened_by           TEXT NOT NULL,
  opened_at           TIMESTAMPTZ NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_record_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_record_status_ck CHECK (status IN ('in_progress')),
  CONSTRAINT case_record_stage_entry_seq_ck CHECK (stage_entry_seq >= 1),
  CONSTRAINT case_record_party_ck CHECK (cardinality(party_names) >= 1),
  CONSTRAINT case_record_org_fkey FOREIGN KEY (handling_org_id) REFERENCES org_unit (id),
  CONSTRAINT case_record_filing_fkey FOREIGN KEY (filing_approval_id) REFERENCES filing_approval (id)
);
CREATE UNIQUE INDEX case_record_filing_uq ON case_record (filing_approval_id);
CREATE INDEX case_record_org_idx ON case_record (handling_org_id);

-- X13：立案后承办机构不可变；案件不可物理删除。
CREATE OR REPLACE FUNCTION case_record_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% 拒绝 DELETE（#234：案件不可物理删除）', TG_TABLE_NAME;
  END IF;
  IF NEW.handling_org_id IS DISTINCT FROM OLD.handling_org_id THEN
    RAISE EXCEPTION '% 拒绝修改承办机构（#234 X13：立案后承办机构不可变）', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER case_record_guard
  BEFORE UPDATE OR DELETE ON case_record
  FOR EACH ROW EXECUTE FUNCTION case_record_guard();

COMMENT ON TABLE case_record IS '#234 案件最小模型：承办机构（立案锁定）、主状态、当前环节、进入次序号、当事人、立案呈批引用；#235 接管状态机。';

CREATE TABLE case_source_clue (
  id          TEXT PRIMARY KEY,
  case_id     TEXT NOT NULL,
  clue_id     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_source_clue_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_source_clue_case_fkey FOREIGN KEY (case_id) REFERENCES case_record (id),
  CONSTRAINT case_source_clue_clue_fkey FOREIGN KEY (clue_id) REFERENCES clue (id)
);
-- 一条线索只能是一个案件的来源（#16：案件 1..N 条来源线索，用主键引用）。
CREATE UNIQUE INDEX case_source_clue_clue_uq ON case_source_clue (clue_id);
CREATE INDEX case_source_clue_case_idx ON case_source_clue (case_id);

CREATE TABLE case_handler (
  id            TEXT PRIMARY KEY,
  case_id       TEXT NOT NULL,
  personnel_id  TEXT NOT NULL,
  role          TEXT NOT NULL,
  assigned_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at      TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_handler_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_handler_role_ck CHECK (role IN ('main', 'assist')),
  CONSTRAINT case_handler_case_fkey FOREIGN KEY (case_id) REFERENCES case_record (id),
  CONSTRAINT case_handler_personnel_fkey FOREIGN KEY (personnel_id) REFERENCES personnel (id)
);
CREATE UNIQUE INDEX case_handler_uq ON case_handler (case_id, personnel_id, role);
CREATE INDEX case_handler_case_idx ON case_handler (case_id);
