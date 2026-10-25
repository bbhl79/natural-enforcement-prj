-- #217：结案提醒本期无超期、催办或升级口径（规格 D 节）。
-- 时限不写，故 due_at 放宽为可空：提醒只表达「旧线索已结案、待处理」，不带期限。
ALTER TABLE clue_closure_reminder ALTER COLUMN due_at DROP NOT NULL;
