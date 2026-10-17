-- #123（#105「机构树」）：机构新增必填「层级」，取值市（city）、区（district）、所（station）。
-- 根机构固定为市。市下只能建区，区下只能建所，所下不能再建下级。
-- 加列与回填同一迁移：按到根的深度回填，0 = 市，1 = 区，2 = 所。深度超过 2 的机构回填不了，迁移失败。

ALTER TABLE org_unit ADD COLUMN level TEXT;

WITH RECURSIVE depth AS (
  SELECT id, 0 AS d FROM org_unit WHERE parent_id IS NULL
  UNION ALL
  SELECT child.id, parent.d + 1
  FROM org_unit child
  JOIN depth parent ON child.parent_id = parent.id
)
UPDATE org_unit
SET level = CASE depth.d WHEN 0 THEN 'city' WHEN 1 THEN 'district' WHEN 2 THEN 'station' END
FROM depth
WHERE org_unit.id = depth.id;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM org_unit WHERE level IS NULL) THEN
    RAISE EXCEPTION 'org_unit 层级回填失败：存在深度超过三级的机构（#123：机构树只分市、区、所三级）';
  END IF;
END;
$$;

ALTER TABLE org_unit ALTER COLUMN level SET NOT NULL;
ALTER TABLE org_unit
  ADD CONSTRAINT org_unit_level_known CHECK (level IN ('city', 'district', 'station'));
ALTER TABLE org_unit
  ADD CONSTRAINT org_unit_root_is_city CHECK (parent_id IS NOT NULL OR level = 'city');

-- 上下级层级的库层兜底（应用层先校验，返回 400 org-level-mismatch）。
-- 将来若提供移动或重挂上级，改 parent_id 时同样经过这道检查。
CREATE OR REPLACE FUNCTION org_unit_level_matches_parent() RETURNS trigger AS $$
DECLARE
  parent_level TEXT;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT level INTO parent_level FROM org_unit WHERE id = NEW.parent_id;
  IF (parent_level = 'city' AND NEW.level = 'district')
     OR (parent_level = 'district' AND NEW.level = 'station') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'org_unit 层级不符：上级 % 下不能有 %（#123：市下只能建区，区下只能建所，所下不能再建下级）',
    parent_level, NEW.level;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER org_unit_level_matches_parent
  BEFORE INSERT OR UPDATE OF parent_id, level ON org_unit
  FOR EACH ROW EXECUTE FUNCTION org_unit_level_matches_parent();

COMMENT ON COLUMN org_unit.level IS '机构层级（#123）：city 市、district 区、station 所。根机构为 city。';
