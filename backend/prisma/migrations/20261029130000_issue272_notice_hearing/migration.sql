-- #272 告知／陈述申辩／听证：告知书呈批、当事人陈述申辩与放弃、听证。
-- 正文版本、步骤、当事人提交只追加；告知与听证表头按步骤推进，已送达／已结束后不再改写。

CREATE TABLE case_notice (
  id                  TEXT PRIMARY KEY,
  case_id             TEXT NOT NULL,
  entry_seq           INTEGER NOT NULL,
  kind                TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'drafting',
  admin_review        TEXT,
  current_version_no  INTEGER NOT NULL DEFAULT 0,
  drafter_id          TEXT NOT NULL,
  approval_chain_id   TEXT,
  content_json        TEXT NOT NULL,
  served_by           TEXT,
  served_at           TIMESTAMPTZ,
  served_on           DATE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_notice_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_notice_entry_ck CHECK (entry_seq >= 1),
  CONSTRAINT case_notice_kind_ck CHECK (kind IN ('penalty', 'no-penalty')),
  CONSTRAINT case_notice_status_ck CHECK (
    status IN ('drafting', 'pending_review', 'pending_approval', 'approved', 'served')
  ),
  CONSTRAINT case_notice_served_ck CHECK (
    (status = 'served' AND served_by IS NOT NULL AND served_at IS NOT NULL AND served_on IS NOT NULL)
    OR (status <> 'served' AND served_by IS NULL AND served_at IS NULL AND served_on IS NULL)
  ),
  CONSTRAINT case_notice_case_fkey FOREIGN KEY (case_id) REFERENCES case_record (id),
  CONSTRAINT case_notice_drafter_fkey FOREIGN KEY (drafter_id) REFERENCES personnel (id),
  CONSTRAINT case_notice_server_fkey FOREIGN KEY (served_by) REFERENCES personnel (id)
);
CREATE INDEX case_notice_case_idx ON case_notice (case_id);
CREATE UNIQUE INDEX case_notice_entry_uq ON case_notice (case_id, entry_seq);

CREATE OR REPLACE FUNCTION case_notice_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% 拒绝 DELETE（#272：告知不物理删除）', TG_TABLE_NAME;
  END IF;
  IF OLD.status = 'served' THEN
    RAISE EXCEPTION '% 已送达的告知不能再改（#272）', TG_TABLE_NAME;
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
CREATE TRIGGER case_notice_guard
  BEFORE UPDATE OR DELETE ON case_notice
  FOR EACH ROW EXECUTE FUNCTION case_notice_guard();

COMMENT ON TABLE case_notice IS '#272 告知书。T10／T11 进入 E05 时创建；T13 送达后置 served。';

CREATE TABLE case_notice_version (
  id            TEXT PRIMARY KEY,
  notice_id     TEXT NOT NULL,
  version_no    INTEGER NOT NULL,
  content_json  TEXT NOT NULL,
  created_by    TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_notice_version_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_notice_version_no_ck CHECK (version_no >= 1),
  CONSTRAINT case_notice_version_notice_fkey FOREIGN KEY (notice_id) REFERENCES case_notice (id),
  CONSTRAINT case_notice_version_actor_fkey FOREIGN KEY (created_by) REFERENCES personnel (id),
  CONSTRAINT case_notice_version_uq UNIQUE (notice_id, version_no)
);
CREATE TRIGGER case_notice_version_append_only
  BEFORE UPDATE OR DELETE ON case_notice_version
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

CREATE TABLE case_notice_step (
  id          TEXT PRIMARY KEY,
  notice_id   TEXT NOT NULL,
  version_no  INTEGER NOT NULL,
  step        TEXT NOT NULL,
  actor_id    TEXT NOT NULL,
  opinion     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_notice_step_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_notice_step_ck CHECK (step IN ('submit', 'review', 'approve', 'serve', 'complete', 'return')),
  CONSTRAINT case_notice_step_notice_fkey FOREIGN KEY (notice_id) REFERENCES case_notice (id),
  CONSTRAINT case_notice_step_actor_fkey FOREIGN KEY (actor_id) REFERENCES personnel (id)
);
CREATE INDEX case_notice_step_notice_idx ON case_notice_step (notice_id);
CREATE TRIGGER case_notice_step_append_only
  BEFORE UPDATE OR DELETE ON case_notice_step
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

CREATE TABLE case_party_submission (
  id           TEXT PRIMARY KEY,
  case_id      TEXT NOT NULL,
  notice_id    TEXT NOT NULL,
  kind         TEXT NOT NULL,
  note         TEXT NOT NULL,
  recorded_by  TEXT NOT NULL,
  recorded_at  TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_party_submission_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_party_submission_kind_ck CHECK (kind IN ('statement', 'notice-waiver')),
  CONSTRAINT case_party_submission_case_fkey FOREIGN KEY (case_id) REFERENCES case_record (id),
  CONSTRAINT case_party_submission_notice_fkey FOREIGN KEY (notice_id) REFERENCES case_notice (id),
  CONSTRAINT case_party_submission_actor_fkey FOREIGN KEY (recorded_by) REFERENCES personnel (id)
);
CREATE INDEX case_party_submission_case_idx ON case_party_submission (case_id);
CREATE TRIGGER case_party_submission_append_only
  BEFORE UPDATE OR DELETE ON case_party_submission
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

CREATE TABLE case_hearing (
  id                 TEXT PRIMARY KEY,
  case_id            TEXT NOT NULL,
  notice_id          TEXT NOT NULL,
  entry_seq          INTEGER NOT NULL,
  status             TEXT NOT NULL,
  host_personnel_id  TEXT,
  applied_at         TIMESTAMPTZ NOT NULL,
  accepted_at        TIMESTAMPTZ,
  scheduled_at       TIMESTAMPTZ,
  scheduled_for      TIMESTAMPTZ,
  ended_at           TIMESTAMPTZ,
  end_kind           TEXT,
  note               TEXT,
  recorded_by        TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_hearing_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_hearing_entry_ck CHECK (entry_seq >= 1),
  CONSTRAINT case_hearing_status_ck CHECK (status IN ('applied', 'accepted', 'scheduled', 'ended')),
  CONSTRAINT case_hearing_end_ck CHECK (
    (status = 'ended' AND ended_at IS NOT NULL AND end_kind IS NOT NULL)
    OR (status <> 'ended' AND ended_at IS NULL AND end_kind IS NULL)
  ),
  CONSTRAINT case_hearing_end_kind_ck CHECK (
    end_kind IS NULL OR end_kind IN ('concluded', 'withdrawn', 'waived', 'no-show', 'terminated', 'withdrawn-before-acceptance')
  ),
  CONSTRAINT case_hearing_case_fkey FOREIGN KEY (case_id) REFERENCES case_record (id),
  CONSTRAINT case_hearing_notice_fkey FOREIGN KEY (notice_id) REFERENCES case_notice (id),
  CONSTRAINT case_hearing_host_fkey FOREIGN KEY (host_personnel_id) REFERENCES personnel (id),
  CONSTRAINT case_hearing_recorder_fkey FOREIGN KEY (recorded_by) REFERENCES personnel (id)
);
CREATE INDEX case_hearing_case_idx ON case_hearing (case_id);
CREATE UNIQUE INDEX case_hearing_entry_uq ON case_hearing (case_id, entry_seq);
CREATE UNIQUE INDEX case_hearing_open_uq ON case_hearing (case_id) WHERE status <> 'ended';

CREATE OR REPLACE FUNCTION case_hearing_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% 拒绝 DELETE（#272：听证不物理删除）', TG_TABLE_NAME;
  END IF;
  IF OLD.status = 'ended' THEN
    RAISE EXCEPTION '% 已结束的听证不能再改（#272）', TG_TABLE_NAME;
  END IF;
  IF NEW.case_id IS DISTINCT FROM OLD.case_id
     OR NEW.notice_id IS DISTINCT FROM OLD.notice_id
     OR NEW.entry_seq IS DISTINCT FROM OLD.entry_seq
     OR NEW.applied_at IS DISTINCT FROM OLD.applied_at
     OR NEW.recorded_by IS DISTINCT FROM OLD.recorded_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION '% 拒绝改写听证归属（#272）', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER case_hearing_guard
  BEFORE UPDATE OR DELETE ON case_hearing
  FOR EACH ROW EXECUTE FUNCTION case_hearing_guard();

COMMENT ON TABLE case_hearing IS '#272 听证。T15 申请进入 E06；受理或排期置「进入听证程序」标记；T16 结束后按 T15 重新申请。';