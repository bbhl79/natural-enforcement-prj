-- #214 分派决定与两步分派：分派事实补两列。
-- assigned_by_org_id：操作人当时所属机构，指定管辖锁按它判定
-- 「指定者或其上级可再调整，下级返回 409 designated-lock」。旧行留空：只服务新写入。
-- reason：重新分派与指定管辖的必填理由（自由文本留业务行，不进留痕 detail）。
ALTER TABLE clue_assignment ADD COLUMN assigned_by_org_id TEXT;
ALTER TABLE clue_assignment ADD COLUMN reason TEXT;
