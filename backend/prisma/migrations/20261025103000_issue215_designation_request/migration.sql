-- #215 报请指定管辖：拟归属机构改可空、受理机构、驳回理由，以及「每条线索至多一个待处理报请」的部分唯一索引。
ALTER TABLE clue_designation_request
  ALTER COLUMN proposed_org_id DROP NOT NULL;

ALTER TABLE clue_designation_request
  ADD COLUMN reviewer_org_id TEXT,
  ADD COLUMN decision_reason TEXT;

-- 报请期间的主状态不变：同一时刻每条线索至多一条待处理（pending）报请。
-- 并发同报请由该索引挡下，调用方判 409 designation-pending。
CREATE UNIQUE INDEX clue_designation_request_pending_uq
  ON clue_designation_request (clue_id) WHERE status = 'pending';

COMMENT ON COLUMN clue_designation_request.proposed_org_id IS '拟归属机构（#215，规格 D）：可选；为空时受理人为报请方直接上级内勤。';
COMMENT ON COLUMN clue_designation_request.reviewer_org_id IS '受理机构（#215，规格 D）：报请方与拟归属机构最近共同上级（有内勤的最近一级）；报请事项进该机构内勤的待办。';
COMMENT ON COLUMN clue_designation_request.decision_reason IS '驳回理由（#215，规格 D）：理由必填，自由文本留业务行，不进留痕。';
COMMENT ON INDEX clue_designation_request_pending_uq IS '每条线索至多一条待处理报请（#215）：报请期间的指定锁（designation-pending）由它承载并发挡板。';
