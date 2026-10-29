-- #282 审理异议窗口（裁 B）：签出补充调查或修改纠正后开窗，不立即执行 T09。
-- 窗口到期、明示放弃或 T09a 决定后关闭；关闭后不再改写。

CREATE TABLE case_review_objection_window (
  id          TEXT PRIMARY KEY,
  case_id     TEXT NOT NULL,
  entry_seq   INTEGER NOT NULL,
  opinion_id  TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open',
  due_at      TIMESTAMPTZ NOT NULL,
  opened_at   TIMESTAMPTZ NOT NULL,
  closed_at   TIMESTAMPTZ,
  close_kind  TEXT,
  closed_by   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_review_objection_window_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_review_objection_window_entry_ck CHECK (entry_seq >= 1),
  CONSTRAINT case_review_objection_window_status_ck CHECK (status IN ('open', 'closed')),
  CONSTRAINT case_review_objection_window_close_ck CHECK (
    (status = 'open' AND closed_at IS NULL AND close_kind IS NULL)
    OR (status = 'closed' AND closed_at IS NOT NULL AND close_kind IS NOT NULL)
  ),
  CONSTRAINT case_review_objection_window_kind_ck CHECK (
    close_kind IS NULL OR close_kind IN ('expired', 'waived', 'support-review', 'support-handler')
  ),
  CONSTRAINT case_review_objection_window_case_fkey FOREIGN KEY (case_id) REFERENCES case_record (id),
  CONSTRAINT case_review_objection_window_opinion_fkey FOREIGN KEY (opinion_id) REFERENCES case_review_opinion (id),
  CONSTRAINT case_review_objection_window_closer_fkey FOREIGN KEY (closed_by) REFERENCES personnel (id)
);
CREATE INDEX case_review_objection_window_case_idx ON case_review_objection_window (case_id);
CREATE UNIQUE INDEX case_review_objection_window_opinion_uq
  ON case_review_objection_window (opinion_id);
CREATE UNIQUE INDEX case_review_objection_window_open_uq
  ON case_review_objection_window (case_id, entry_seq) WHERE status = 'open';

CREATE OR REPLACE FUNCTION case_review_objection_window_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% 拒绝 DELETE（#282：异议窗口不物理删除）', TG_TABLE_NAME;
  END IF;
  IF OLD.status = 'closed' THEN
    RAISE EXCEPTION '% 已关闭的异议窗口不能再改（#282）', TG_TABLE_NAME;
  END IF;
  IF NEW.case_id IS DISTINCT FROM OLD.case_id
     OR NEW.entry_seq IS DISTINCT FROM OLD.entry_seq
     OR NEW.opinion_id IS DISTINCT FROM OLD.opinion_id
     OR NEW.due_at IS DISTINCT FROM OLD.due_at
     OR NEW.opened_at IS DISTINCT FROM OLD.opened_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION '% 拒绝改写异议窗口归属（#282）', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER case_review_objection_window_guard
  BEFORE UPDATE OR DELETE ON case_review_objection_window
  FOR EACH ROW EXECUTE FUNCTION case_review_objection_window_guard();

COMMENT ON TABLE case_review_objection_window IS '#282 审理异议窗口（裁 B）。签出补充调查或修改纠正后开窗，窗口结束后执行 T09 或按负责人决定结束。';