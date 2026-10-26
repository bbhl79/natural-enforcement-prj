-- #229 线索处置「其他」与「系统外移送」附加记录。
-- clue_external_transfer：挂在 disposition=other 的线索上，不改线索状态。
-- clue_material.external_transfer_id：附加记录的选填附件（0..n）。
-- 扩展既有 CHECK：disposition / reminder kind 允许 other。

ALTER TABLE clue_disposition DROP CONSTRAINT clue_disposition_type_ck;
ALTER TABLE clue_disposition
  ADD CONSTRAINT clue_disposition_type_ck
  CHECK (disposition IN ('no-case', 'with-old', 'transfer', 'other'));

ALTER TABLE clue_closure_reminder DROP CONSTRAINT clue_closure_reminder_kind_ck;
ALTER TABLE clue_closure_reminder
  ADD CONSTRAINT clue_closure_reminder_kind_ck
  CHECK (kind IN ('no-case', 'transfer', 'case', 'other'));

CREATE TABLE clue_external_transfer (
  id               TEXT PRIMARY KEY,
  clue_id          TEXT NOT NULL,
  transferred_org  TEXT NOT NULL,
  document_no      TEXT NOT NULL,
  letter_date      TIMESTAMPTZ NOT NULL,
  reason           TEXT NOT NULL,
  recorded_by      TEXT NOT NULL,
  recorded_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT clue_external_transfer_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT clue_external_transfer_org_ck CHECK (char_length(btrim(transferred_org)) > 0),
  CONSTRAINT clue_external_transfer_doc_ck CHECK (char_length(btrim(document_no)) > 0),
  CONSTRAINT clue_external_transfer_reason_ck CHECK (char_length(btrim(reason)) > 0),
  CONSTRAINT clue_external_transfer_clue_fkey FOREIGN KEY (clue_id) REFERENCES clue (id)
);

CREATE INDEX clue_external_transfer_clue_idx ON clue_external_transfer (clue_id);

COMMENT ON TABLE clue_external_transfer IS '#229 系统外移送附加记录：关联 disposition=other 的线索；不改状态、不跟踪回执；不分三类。';
COMMENT ON COLUMN clue_external_transfer.letter_date IS '发函日期：默认北京当日，允许补录（真实 YYYY-MM-DD）。';

ALTER TABLE clue_material ADD COLUMN external_transfer_id TEXT;
CREATE INDEX clue_material_external_transfer_idx ON clue_material (external_transfer_id);
ALTER TABLE clue_material
  ADD CONSTRAINT clue_material_external_transfer_fkey
  FOREIGN KEY (external_transfer_id) REFERENCES clue_external_transfer (id);

COMMENT ON COLUMN clue_material.external_transfer_id IS '#229 系统外移送附加记录附件外键；普通材料为空。';
