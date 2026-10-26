-- #224 涉密误传标记与 quarantined 隔离：按 storage 对象（file_key + version_id）登记隔离态。
-- 原 WORM 对象仍保留在桶内；本表不触发、不表达 DeleteObject／物理删除。
-- 一期状态仅 quarantined；销毁通道另票（#222 草案 §2）。

CREATE TABLE storage_object_quarantine (
  id              TEXT PRIMARY KEY,
  file_key        TEXT NOT NULL,
  version_id      TEXT NOT NULL,
  material_id     TEXT,
  clue_id         TEXT,
  summary         TEXT NOT NULL,
  discovered_by   TEXT NOT NULL,
  discovered_at   TIMESTAMPTZ NOT NULL,
  status          TEXT NOT NULL DEFAULT 'quarantined',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT storage_object_quarantine_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT storage_object_quarantine_status_ck CHECK (status = 'quarantined'),
  CONSTRAINT storage_object_quarantine_summary_ck CHECK (char_length(btrim(summary)) > 0),
  CONSTRAINT storage_object_quarantine_material_fkey FOREIGN KEY (material_id) REFERENCES clue_material (id),
  CONSTRAINT storage_object_quarantine_clue_fkey FOREIGN KEY (clue_id) REFERENCES clue (id)
);

CREATE UNIQUE INDEX storage_object_quarantine_object_uidx
  ON storage_object_quarantine (file_key, version_id);

CREATE INDEX storage_object_quarantine_material_idx
  ON storage_object_quarantine (material_id)
  WHERE material_id IS NOT NULL;

CREATE INDEX storage_object_quarantine_clue_idx
  ON storage_object_quarantine (clue_id)
  WHERE clue_id IS NOT NULL;

COMMENT ON TABLE storage_object_quarantine IS '#224 涉密误传隔离登记：对象标 quarantined 后业务读路径拒绝；桶内 WORM 对象保留，无应用侧物理删除。';
COMMENT ON COLUMN storage_object_quarantine.summary IS '发现人填写的简述（必填）。';
COMMENT ON COLUMN storage_object_quarantine.discovered_by IS '发现人（人员 id）。';
COMMENT ON COLUMN storage_object_quarantine.status IS '一期仅 quarantined；destroyed_per_order 等另票。';
