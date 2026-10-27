-- #263 机关层利害关系勾选。只追加。一案至多一行。
-- 登记过渡复用 doc.draft。不新增操作码。取消勾选不写业务行。

CREATE TABLE case_agency_conflict (
  id          TEXT PRIMARY KEY,
  case_id     TEXT NOT NULL UNIQUE,
  org_unit_id TEXT NOT NULL,
  marked_by   TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_agency_conflict_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT case_agency_conflict_case_fkey FOREIGN KEY (case_id) REFERENCES case_record (id),
  CONSTRAINT case_agency_conflict_org_fkey FOREIGN KEY (org_unit_id) REFERENCES org_unit (id),
  CONSTRAINT case_agency_conflict_actor_fkey FOREIGN KEY (marked_by) REFERENCES personnel (id)
);
CREATE TRIGGER case_agency_conflict_append_only
  BEFORE UPDATE OR DELETE ON case_agency_conflict
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

COMMENT ON TABLE case_agency_conflict IS '#263 机关层利害关系勾选（追加式）。一案一行。过渡写入复用 doc.draft。只提示，不阻断。';
