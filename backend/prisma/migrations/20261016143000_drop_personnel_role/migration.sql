-- #96：迁移完成后去掉人员表的旧 role 列。
-- 允许和拒绝改由角色、权限和人员—角色决定。

ALTER TABLE personnel DROP COLUMN role;
