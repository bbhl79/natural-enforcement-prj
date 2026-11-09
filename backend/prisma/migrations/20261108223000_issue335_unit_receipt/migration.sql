-- #335 手工单位签收确认：分派事实行上持久化签收时间/人/模式；不改线索主状态，不挪用 clue.received_at。
ALTER TABLE clue_assignment
  ADD COLUMN unit_received_at TIMESTAMPTZ,
  ADD COLUMN unit_received_by TEXT,
  ADD COLUMN unit_received_mode TEXT;
ALTER TABLE clue_assignment
  ADD CONSTRAINT clue_assignment_unit_received_mode_ck
  CHECK (unit_received_mode IS NULL OR unit_received_mode = 'manual');
