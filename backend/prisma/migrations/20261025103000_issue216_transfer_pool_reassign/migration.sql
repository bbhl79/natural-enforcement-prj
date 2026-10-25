-- #216 移送与停用机构池重新指定：处置行补发函日期列。
-- letter_date：移送登记的发函日期（规格 D：默认北京当日、允许补录）。
-- 移送必填，故对 disposition='transfer' 的行恒有值；不予立案与随旧线索办结的行留空。
ALTER TABLE clue_disposition ADD COLUMN letter_date TIMESTAMPTZ;

COMMENT ON COLUMN clue_disposition.letter_date IS '移送发函日期（#216，规格 D）：默认北京当日，允许补录；仅移送的处置行有值。';
