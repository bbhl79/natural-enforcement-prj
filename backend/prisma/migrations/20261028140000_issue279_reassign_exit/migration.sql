-- #279 X18 出口：改派呈批增加「已退回」（#238 不批）与「已撤回」两个终态。
-- 待批准的部分唯一索引 case_reassignment_pending_uq 保持不动：
-- 退回、撤回后该行不再是 pending_approval，待批准名额自然释放，可重新发起。

ALTER TABLE case_reassignment DROP CONSTRAINT case_reassignment_status_ck;
ALTER TABLE case_reassignment ADD CONSTRAINT case_reassignment_status_ck
  CHECK (status IN ('pending_approval', 'approved', 'returned', 'withdrawn'));

COMMENT ON TABLE case_reassignment IS '#239 改派呈批（T33）。发起即待批准；批准后才换人；不批走 #238 退回（#279）。一案至多一条待批准。';