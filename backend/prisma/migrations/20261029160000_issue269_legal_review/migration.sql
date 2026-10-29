-- #269 法制审核与集体讨论（E07、E08）：法审轮次、法审意见、集体讨论触发与记录。
-- 意见、勾选、记录只追加；轮次表头随两级签字推进，负责人签出通过后不再改写。

CREATE TABLE case_legal_review (
  id                  TEXT PRIMARY KEY,
  case_id             TEXT NOT NULL,
  round_no            INTEGER NOT NULL,
  phase               TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'drafting',
  receiver_id         TEXT NOT NULL,
  designated_by       TEXT NOT NULL,
  determination_json  TEXT NOT NULL,
  latest_opinion_id   TEXT,
  conclusion          TEXT,
  head_id             TEXT,
  head_signed_at      TIMESTAMPTZ,
  concluded_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_legal_review_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_legal_review_round_ck CHECK (round_no >= 1),
  CONSTRAINT case_legal_review_phase_ck CHECK (phase IN ('pre-notice', 'pre-decision')),
  CONSTRAINT case_legal_review_status_ck CHECK (status IN ('drafting', 'pending_head', 'concluded')),
  CONSTRAINT case_legal_review_conclusion_ck CHECK (conclusion IS NULL OR conclusion IN ('pass', 'fail')),
  CONSTRAINT case_legal_review_concluded_ck CHECK (
    (status = 'concluded' AND conclusion IS NOT NULL AND head_id IS NOT NULL
      AND head_signed_at IS NOT NULL AND concluded_at IS NOT NULL)
    OR (status <> 'concluded' AND conclusion IS NULL AND head_id IS NULL
      AND head_signed_at IS NULL AND concluded_at IS NULL)
  ),
  CONSTRAINT case_legal_review_case_fkey FOREIGN KEY (case_id) REFERENCES case_record (id),
  CONSTRAINT case_legal_review_receiver_fkey FOREIGN KEY (receiver_id) REFERENCES personnel (id),
  CONSTRAINT case_legal_review_designer_fkey FOREIGN KEY (designated_by) REFERENCES personnel (id),
  CONSTRAINT case_legal_review_head_fkey FOREIGN KEY (head_id) REFERENCES personnel (id)
);
CREATE INDEX case_legal_review_case_idx ON case_legal_review (case_id);
CREATE UNIQUE INDEX case_legal_review_round_uq ON case_legal_review (case_id, round_no);

CREATE OR REPLACE FUNCTION case_legal_review_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% 拒绝 DELETE（#269：法审轮次不物理删除）', TG_TABLE_NAME;
  END IF;
  IF OLD.status = 'concluded' AND OLD.conclusion = 'pass' THEN
    RAISE EXCEPTION '% 已通过定稿的法审轮次不能再改（#269）', TG_TABLE_NAME;
  END IF;
  IF NEW.case_id IS DISTINCT FROM OLD.case_id
     OR NEW.round_no IS DISTINCT FROM OLD.round_no
     OR NEW.phase IS DISTINCT FROM OLD.phase
     OR NEW.designated_by IS DISTINCT FROM OLD.designated_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION '% 拒绝改写法审轮次归属（#269）', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER case_legal_review_guard
  BEFORE UPDATE OR DELETE ON case_legal_review
  FOR EACH ROW EXECUTE FUNCTION case_legal_review_guard();

CREATE TABLE case_legal_review_opinion (
  id                   TEXT PRIMARY KEY,
  legal_review_id      TEXT NOT NULL,
  case_id              TEXT NOT NULL,
  round_no             INTEGER NOT NULL,
  conclusion           TEXT NOT NULL,
  fail_route           TEXT,
  content              TEXT NOT NULL,
  signed_by            TEXT NOT NULL,
  signed_at            TIMESTAMPTZ NOT NULL,
  frozen_decision_id   TEXT,
  discussion_record_id TEXT,
  head_id              TEXT,
  head_signed_at       TIMESTAMPTZ,
  head_opinion         TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_legal_review_opinion_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_legal_review_opinion_round_ck CHECK (round_no >= 1),
  CONSTRAINT case_legal_review_opinion_conclusion_ck CHECK (conclusion IN ('pass', 'fail')),
  CONSTRAINT case_legal_review_opinion_route_ck CHECK (
    (conclusion = 'fail' AND fail_route IN ('accept-revise', 'collective-discussion'))
    OR (conclusion = 'pass' AND fail_route IS NULL)
  ),
  CONSTRAINT case_legal_review_opinion_head_ck CHECK (
    (head_signed_at IS NULL AND head_id IS NULL)
    OR (head_signed_at IS NOT NULL AND head_id IS NOT NULL)
  ),
  CONSTRAINT case_legal_review_opinion_review_fkey FOREIGN KEY (legal_review_id) REFERENCES case_legal_review (id),
  CONSTRAINT case_legal_review_opinion_case_fkey FOREIGN KEY (case_id) REFERENCES case_record (id),
  CONSTRAINT case_legal_review_opinion_signer_fkey FOREIGN KEY (signed_by) REFERENCES personnel (id),
  CONSTRAINT case_legal_review_opinion_head_fkey FOREIGN KEY (head_id) REFERENCES personnel (id)
);
CREATE INDEX case_legal_review_opinion_review_idx ON case_legal_review_opinion (legal_review_id);
CREATE INDEX case_legal_review_opinion_case_idx ON case_legal_review_opinion (case_id);

CREATE OR REPLACE FUNCTION case_legal_review_opinion_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% 拒绝 DELETE（#269：法审意见只追加）', TG_TABLE_NAME;
  END IF;
  IF OLD.head_signed_at IS NOT NULL THEN
    RAISE EXCEPTION '% 已由负责人签出的法审意见不能再改（#269）', TG_TABLE_NAME;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.legal_review_id IS DISTINCT FROM OLD.legal_review_id
     OR NEW.case_id IS DISTINCT FROM OLD.case_id
     OR NEW.round_no IS DISTINCT FROM OLD.round_no
     OR NEW.conclusion IS DISTINCT FROM OLD.conclusion
     OR NEW.fail_route IS DISTINCT FROM OLD.fail_route
     OR NEW.content IS DISTINCT FROM OLD.content
     OR NEW.signed_by IS DISTINCT FROM OLD.signed_by
     OR NEW.signed_at IS DISTINCT FROM OLD.signed_at
     OR NEW.frozen_decision_id IS DISTINCT FROM OLD.frozen_decision_id
     OR NEW.discussion_record_id IS DISTINCT FROM OLD.discussion_record_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION '% 只允许写入负责人签出字段（#269）', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER case_legal_review_opinion_guard
  BEFORE UPDATE OR DELETE ON case_legal_review_opinion
  FOR EACH ROW EXECUTE FUNCTION case_legal_review_opinion_guard();

CREATE TABLE case_discussion_mark (
  id            TEXT PRIMARY KEY,
  case_id       TEXT NOT NULL,
  criteria_json TEXT NOT NULL,
  reason        TEXT NOT NULL,
  marked_by     TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_discussion_mark_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_discussion_mark_case_fkey FOREIGN KEY (case_id) REFERENCES case_record (id),
  CONSTRAINT case_discussion_mark_actor_fkey FOREIGN KEY (marked_by) REFERENCES personnel (id)
);
CREATE INDEX case_discussion_mark_case_idx ON case_discussion_mark (case_id);

CREATE OR REPLACE FUNCTION case_discussion_mark_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% 只追加（#269）', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER case_discussion_mark_guard
  BEFORE UPDATE OR DELETE ON case_discussion_mark
  FOR EACH ROW EXECUTE FUNCTION case_discussion_mark_guard();

CREATE TABLE case_discussion_record (
  id            TEXT PRIMARY KEY,
  case_id       TEXT NOT NULL,
  purposes_json TEXT NOT NULL,
  criteria_json TEXT NOT NULL,
  note          TEXT NOT NULL,
  recorded_by   TEXT NOT NULL,
  recorded_at   TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_discussion_record_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_discussion_record_case_fkey FOREIGN KEY (case_id) REFERENCES case_record (id),
  CONSTRAINT case_discussion_record_actor_fkey FOREIGN KEY (recorded_by) REFERENCES personnel (id)
);
CREATE INDEX case_discussion_record_case_idx ON case_discussion_record (case_id);

CREATE OR REPLACE FUNCTION case_discussion_record_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% 只追加（#269）', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER case_discussion_record_guard
  BEFORE UPDATE OR DELETE ON case_discussion_record
  FOR EACH ROW EXECUTE FUNCTION case_discussion_record_guard();

COMMENT ON TABLE case_legal_review IS '#269 法制审核轮次。T10a 进入 E07 时创建；T10b 通过后进 E05。';
COMMENT ON TABLE case_legal_review_opinion IS '#269 法审意见。审核人签出后由法制审核负责人再签；只追加。';
COMMENT ON TABLE case_discussion_mark IS '#269 集体讨论触发勾选。经办勾选标准并写理由。';
COMMENT ON TABLE case_discussion_record IS '#269 集体讨论记录。case.discussion.record 录入，入卷。';