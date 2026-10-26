-- #226 不予立案经立案呈批落点：呈批引用主键 + 理由快照。
ALTER TABLE clue_disposition ADD COLUMN filing_approval_ref TEXT;
ALTER TABLE clue_disposition ADD COLUMN no_case_reason_json TEXT;

COMMENT ON COLUMN clue_disposition.filing_approval_ref IS '#226 立案呈批／审批记录技术主键；仅 disposition=no-case 经呈批落点有值。';
COMMENT ON COLUMN clue_disposition.no_case_reason_json IS '#226 不予立案理由快照 JSON（non-filing-grounds｜minor-corrected-no-harm）；仅经呈批落点有值。';
