-- #119 修正（ADR 0011，按 #105）：授权拒绝行归对象所属机构。
-- 新加两列。target_org_unit_id 是查阅范围套用的目标机构，target_org_unit_basis 说明它从哪来：
--   object         = 对象所属机构；
--   actor-fallback = 对象机构解析不出（如对象不存在），取操作者当时任职机构。
-- org_unit_id 照旧记操作者当时任职机构，不再用来套拒绝行的范围。
-- 旧行不补：两列为空的拒绝行查阅时按 org_unit_id 套（系统未上线，只有开发和测试数据）。
-- 只加列，不改已有行；留痕表的只追加触发器不受影响。

ALTER TABLE audit_trail ADD COLUMN target_org_unit_id TEXT;
ALTER TABLE audit_trail ADD COLUMN target_org_unit_basis TEXT;

ALTER TABLE audit_trail ADD CONSTRAINT audit_trail_target_org_unit_basis_check
  CHECK (target_org_unit_basis IS NULL OR target_org_unit_basis IN ('object', 'actor-fallback'));

-- 只有授权拒绝行带这两列；其他动作两列都空。
ALTER TABLE audit_trail ADD CONSTRAINT audit_trail_target_org_unit_action_check
  CHECK (target_org_unit_basis IS NULL OR action = 'authz.denied');

COMMENT ON COLUMN audit_trail.target_org_unit_id IS '授权拒绝行的目标机构，查阅范围按它套（ADR 0011 修正）';
COMMENT ON COLUMN audit_trail.target_org_unit_basis IS 'object=对象所属机构；actor-fallback=对象机构解析不出，取操作者机构';
