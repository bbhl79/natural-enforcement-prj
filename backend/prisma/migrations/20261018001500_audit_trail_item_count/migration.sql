-- #125 人员导出写入共用留痕表（ADR 0013）。
-- 留痕表追加可空整数列 item_count，记导出条数（Lei Hu 7-7）。只有带条数的动作写值，其余为空。
-- 加列不改已有行，追加式触发器 audit_trail_append_only 不受影响。
-- export_audit 只停写：表、追加式触发器 export_audit_append_only、G1 白名单条目都保留，已有行永久可查。

ALTER TABLE audit_trail
  ADD COLUMN item_count INTEGER;

ALTER TABLE audit_trail
  ADD CONSTRAINT audit_trail_item_count_non_negative CHECK (item_count IS NULL OR item_count >= 0);

COMMENT ON COLUMN audit_trail.item_count IS '导出条数（ADR 0013）。只有带条数的动作写值，其余为空。';

COMMENT ON TABLE export_audit IS '冻结（ADR 0013，#125）：不再写入。人员导出改写 audit_trail 的 personnel.exported。表、追加式触发器、G1 白名单条目保留，已有行永久可查。';
