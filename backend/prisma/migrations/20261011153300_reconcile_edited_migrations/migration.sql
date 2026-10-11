-- 已经应用过的开发库不会重放事后被改过的迁移文件。
-- migrate deploy 看到迁移名在 _prisma_migrations 里就跳过，旧卷因此仍是：
--   migration_probe / 两张空间表的自增整数主键，
--   personnel_assignment 只有禁删除触发器，没有「至多一条当前任职」。
-- 本迁移把现存库补到与当前迁移文件相同的结果。从零建库时这些对象已经是目标形态，再跑是空操作。

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['migration_probe', 'geo_dict_land_boundary', 'geo_dict_survey_point']
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = tbl
        AND column_name = 'id'
        AND data_type = 'integer'
    ) THEN
      EXECUTE format('ALTER TABLE %I ALTER COLUMN id DROP DEFAULT', tbl);
      EXECUTE format('ALTER TABLE %I ALTER COLUMN id TYPE text USING id::text', tbl);
      EXECUTE format('DROP SEQUENCE IF EXISTS %I CASCADE', tbl || '_id_seq');
    END IF;
  END LOOP;
END $$;

-- 整数主键转成的 '1' 不是 ULID。删掉后由种子按现行契约重写探针行。
DELETE FROM migration_probe
WHERE id !~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$';

CREATE UNIQUE INDEX IF NOT EXISTS personnel_assignment_one_current
  ON personnel_assignment (personnel_id)
  WHERE ended_at IS NULL;

CREATE OR REPLACE FUNCTION personnel_assignment_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% 拒绝 DELETE（#52：任职记录只失效不删除）', TG_TABLE_NAME;
  END IF;
  IF OLD.ended_at IS NOT NULL THEN
    RAISE EXCEPTION '% 拒绝 UPDATE（#52：已关止任职不可改）', TG_TABLE_NAME;
  END IF;
  IF NEW.ended_at IS NULL
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.personnel_id IS DISTINCT FROM OLD.personnel_id
     OR NEW.org_unit_id IS DISTINCT FROM OLD.org_unit_id
     OR NEW.started_at IS DISTINCT FROM OLD.started_at THEN
    RAISE EXCEPTION '% 拒绝 UPDATE（#52：任职记录只允许一次 ended_at 从空到非空）', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS personnel_assignment_no_physical_delete ON personnel_assignment;
DROP TRIGGER IF EXISTS personnel_assignment_guard ON personnel_assignment;
CREATE TRIGGER personnel_assignment_guard
  BEFORE UPDATE OR DELETE ON personnel_assignment
  FOR EACH ROW EXECUTE FUNCTION personnel_assignment_guard();
