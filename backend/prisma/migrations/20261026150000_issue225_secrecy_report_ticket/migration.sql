-- #225 保密报告工单：对已隔离（quarantined）对象生成工单，状态 待报／已报／已回执。
-- 工单 → 对象：quarantine_id 外键；对象 → 工单：quarantine_id 唯一，一个隔离对象至多一张工单。
-- 系统只提醒（默认发现后 24 小时），不对外发文、不代替审批。
-- 本表不表达销毁：没有销毁状态，没有超时自动动作；销毁通道属二期／另票。

CREATE TABLE secrecy_report_ticket (
  id                        TEXT PRIMARY KEY,
  quarantine_id             TEXT NOT NULL,
  status                    TEXT NOT NULL DEFAULT 'pending_report',
  responsible_personnel_id  TEXT NOT NULL,
  created_by                TEXT NOT NULL,
  created_at                TIMESTAMPTZ NOT NULL,
  report_due_at             TIMESTAMPTZ NOT NULL,
  reported_by               TEXT,
  reported_at               TIMESTAMPTZ,
  report_note               TEXT,
  instruction_summary       TEXT,
  receipt_file_key          TEXT,
  receipt_version_id        TEXT,
  receipt_file_name         TEXT,
  receipted_by              TEXT,
  receipted_at              TIMESTAMPTZ,
  CONSTRAINT secrecy_report_ticket_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT secrecy_report_ticket_status_ck CHECK (status IN ('pending_report', 'reported', 'receipted')),
  -- 已报及以后必须有已报登记；待报不得有。
  CONSTRAINT secrecy_report_ticket_reported_ck CHECK (
    (status = 'pending_report' AND reported_at IS NULL AND reported_by IS NULL AND report_note IS NULL)
    OR (status IN ('reported', 'receipted') AND reported_at IS NOT NULL AND reported_by IS NOT NULL
        AND char_length(btrim(report_note)) > 0)
  ),
  -- 已回执必须同时有指令摘要与回执附件；此前一律为空。
  CONSTRAINT secrecy_report_ticket_receipt_ck CHECK (
    (status <> 'receipted' AND instruction_summary IS NULL AND receipt_file_key IS NULL
       AND receipt_version_id IS NULL AND receipt_file_name IS NULL
       AND receipted_by IS NULL AND receipted_at IS NULL)
    OR (status = 'receipted' AND char_length(btrim(instruction_summary)) > 0
       AND receipt_file_key IS NOT NULL AND receipt_version_id IS NOT NULL
       AND receipt_file_name IS NOT NULL AND receipted_by IS NOT NULL AND receipted_at IS NOT NULL)
  ),
  CONSTRAINT secrecy_report_ticket_quarantine_fkey FOREIGN KEY (quarantine_id) REFERENCES storage_object_quarantine (id)
);

CREATE UNIQUE INDEX secrecy_report_ticket_quarantine_uidx
  ON secrecy_report_ticket (quarantine_id);

CREATE INDEX secrecy_report_ticket_pending_idx
  ON secrecy_report_ticket (responsible_personnel_id, report_due_at)
  WHERE status = 'pending_report';

COMMENT ON TABLE secrecy_report_ticket IS '#225 保密报告工单：待报／已报／已回执；只提醒不代发；无销毁状态，无超时自动动作。';
COMMENT ON COLUMN secrecy_report_ticket.report_due_at IS '报告时限到期时刻＝发现时刻＋24 小时（默认）。只用于系统内提醒。';
COMMENT ON COLUMN secrecy_report_ticket.report_note IS '责任人按规程报告后人工登记的报告说明（报告对象、方式、文号等）。';
COMMENT ON COLUMN secrecy_report_ticket.instruction_summary IS '人工录入的保密部门指令摘要。';
COMMENT ON COLUMN secrecy_report_ticket.receipt_file_key IS '回执附件存储文件键（WORM 追加写入）。';
