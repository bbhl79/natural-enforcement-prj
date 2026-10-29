-- #248 有效性确认与重新告知（#28 A／B／C）。
-- 告知撤销：served → revoked，仅改状态，已送达字段不动；基线、有效性确认、复核三表只追加。
-- 重新告知仍由 T32 推进 E05 进入次序号，旧期限行与旧基线保留。

-- 1) 告知状态增加 revoked，并放开 served 行的唯一合法迁移。
ALTER TABLE case_notice DROP CONSTRAINT case_notice_status_ck;
ALTER TABLE case_notice ADD CONSTRAINT case_notice_status_ck CHECK (
  status IN ('drafting', 'pending_review', 'pending_approval', 'approved', 'served', 'revoked')
);
ALTER TABLE case_notice DROP CONSTRAINT case_notice_served_ck;
ALTER TABLE case_notice ADD CONSTRAINT case_notice_served_ck CHECK (
  (status = 'served' AND served_by IS NOT NULL AND served_at IS NOT NULL AND served_on IS NOT NULL)
  OR (status IN ('drafting', 'pending_review', 'pending_approval', 'approved')
      AND served_by IS NULL AND served_at IS NULL AND served_on IS NULL)
  OR (status = 'revoked' AND served_by IS NOT NULL AND served_at IS NOT NULL AND served_on IS NOT NULL)
);

ALTER TABLE case_notice_step DROP CONSTRAINT case_notice_step_ck;
ALTER TABLE case_notice_step ADD CONSTRAINT case_notice_step_ck CHECK (
  step IN ('submit', 'review', 'approve', 'serve', 'complete', 'return', 'revoke')
);

CREATE OR REPLACE FUNCTION case_notice_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% 拒绝 DELETE（#272：告知不物理删除）', TG_TABLE_NAME;
  END IF;
  IF OLD.status = 'served' THEN
    IF NEW.status IS DISTINCT FROM 'revoked'
       OR NEW.served_by IS DISTINCT FROM OLD.served_by
       OR NEW.served_at IS DISTINCT FROM OLD.served_at
       OR NEW.served_on IS DISTINCT FROM OLD.served_on
       OR NEW.content_json IS DISTINCT FROM OLD.content_json
    THEN
      RAISE EXCEPTION '% 已送达的告知只能撤销（#248）', TG_TABLE_NAME;
    END IF;
  END IF;
  IF NEW.case_id IS DISTINCT FROM OLD.case_id
     OR NEW.entry_seq IS DISTINCT FROM OLD.entry_seq
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.drafter_id IS DISTINCT FROM OLD.drafter_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION '% 拒绝改写告知归属（#272）', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2) 原告知基线：送达时冻结，一条告知至多一行。
CREATE TABLE case_notice_validity_baseline (
  id                       TEXT PRIMARY KEY,
  case_id                  TEXT NOT NULL,
  notice_id                TEXT NOT NULL,
  entry_seq                INTEGER NOT NULL,
  kind                     TEXT NOT NULL,
  party_type               TEXT NOT NULL,
  hearing_notice_attached  BOOLEAN NOT NULL,
  confiscation_value       DOUBLE PRECISION,
  summary_json             TEXT NOT NULL,
  summary_digest           TEXT NOT NULL,
  captured_by              TEXT NOT NULL,
  captured_at              TIMESTAMPTZ NOT NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_notice_validity_baseline_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_notice_validity_baseline_entry_ck CHECK (entry_seq >= 1),
  CONSTRAINT case_notice_validity_baseline_kind_ck CHECK (kind IN ('penalty', 'no-penalty')),
  CONSTRAINT case_notice_validity_baseline_party_ck CHECK (party_type IN ('citizen', 'legal-person')),
  CONSTRAINT case_notice_validity_baseline_digest_ck CHECK (summary_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT case_notice_validity_baseline_case_fkey FOREIGN KEY (case_id) REFERENCES case_record (id),
  CONSTRAINT case_notice_validity_baseline_notice_fkey FOREIGN KEY (notice_id) REFERENCES case_notice (id),
  CONSTRAINT case_notice_validity_baseline_capturer_fkey FOREIGN KEY (captured_by) REFERENCES personnel (id),
  CONSTRAINT case_notice_validity_baseline_notice_uq UNIQUE (notice_id)
);
CREATE INDEX case_notice_validity_baseline_case_idx ON case_notice_validity_baseline (case_id);
CREATE TRIGGER case_notice_validity_baseline_append_only
  BEFORE UPDATE OR DELETE ON case_notice_validity_baseline
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

COMMENT ON TABLE case_notice_validity_baseline IS '#248 告知送达时冻结的拟决定摘要基线。重新告知产生新基线，旧基线保留。';

-- 3) 有效性确认：只追加。
CREATE TABLE case_validity_confirmation (
  id                     TEXT PRIMARY KEY,
  case_id                TEXT NOT NULL,
  notice_id              TEXT NOT NULL,
  decision_digest        TEXT NOT NULL,
  system_hits_json       TEXT NOT NULL,
  differences_json       TEXT NOT NULL,
  conclusion             TEXT NOT NULL,
  reason                 TEXT NOT NULL,
  reason_changed         BOOLEAN NOT NULL DEFAULT FALSE,
  aggravation_source     TEXT,
  aggravation_reference  TEXT,
  aggravation_reason     TEXT,
  confirmed_by           TEXT NOT NULL,
  confirmed_at           TIMESTAMPTZ NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_validity_confirmation_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_validity_confirmation_digest_ck CHECK (decision_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT case_validity_confirmation_conclusion_ck CHECK (conclusion IN ('valid', 'invalid')),
  CONSTRAINT case_validity_confirmation_reason_ck CHECK (length(btrim(reason)) > 0),
  CONSTRAINT case_validity_confirmation_aggravation_ck CHECK (
    (aggravation_source IS NULL AND aggravation_reference IS NULL AND aggravation_reason IS NULL)
    OR (
      aggravation_source IN ('reflow-new-evidence', 'r4-qualification-correction')
      AND aggravation_reference IS NOT NULL
      AND length(btrim(aggravation_reference)) > 0
      AND aggravation_reason IS NOT NULL
      AND length(btrim(aggravation_reason)) > 0
    )
  ),
  CONSTRAINT case_validity_confirmation_case_fkey FOREIGN KEY (case_id) REFERENCES case_record (id),
  CONSTRAINT case_validity_confirmation_notice_fkey FOREIGN KEY (notice_id) REFERENCES case_notice (id),
  CONSTRAINT case_validity_confirmation_confirmer_fkey FOREIGN KEY (confirmed_by) REFERENCES personnel (id)
);
CREATE INDEX case_validity_confirmation_case_idx ON case_validity_confirmation (case_id, notice_id, confirmed_at);
CREATE TRIGGER case_validity_confirmation_append_only
  BEFORE UPDATE OR DELETE ON case_validity_confirmation
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

COMMENT ON TABLE case_validity_confirmation IS '#248 主办有效性确认。差异清单按违法记录分组；只追加。';

-- 4) 有效性确认复核：只追加。
CREATE TABLE case_validity_review (
  id               TEXT PRIMARY KEY,
  case_id          TEXT NOT NULL,
  confirmation_id  TEXT NOT NULL,
  conclusion       TEXT NOT NULL,
  opinion          TEXT,
  reviewed_by      TEXT NOT NULL,
  reviewed_at      TIMESTAMPTZ NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_validity_review_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_validity_review_conclusion_ck CHECK (conclusion IN ('pass', 'fail')),
  CONSTRAINT case_validity_review_case_fkey FOREIGN KEY (case_id) REFERENCES case_record (id),
  CONSTRAINT case_validity_review_confirmation_fkey FOREIGN KEY (confirmation_id) REFERENCES case_validity_confirmation (id),
  CONSTRAINT case_validity_review_reviewer_fkey FOREIGN KEY (reviewed_by) REFERENCES personnel (id)
);
CREATE INDEX case_validity_review_case_idx ON case_validity_review (case_id, confirmation_id, reviewed_at);
CREATE TRIGGER case_validity_review_append_only
  BEFORE UPDATE OR DELETE ON case_validity_review
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

COMMENT ON TABLE case_validity_review IS '#248 有效性确认复核。审理或法审复核；只追加。';