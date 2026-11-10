-- 验证夹具：一条 transferred_out peer。
-- disposition.recorded_at 与 registered_at 在插入时写成夹具时刻。
-- letter_date 写成同一时刻，只为行内一致。回看断言看 recorded_at。
-- 已有同幂等键的行保持不动。本文件不改写已有行。
-- 占位符由 seed-ancient-historical-peer.mjs 替换。替换值经过格式校验。

BEGIN;

DO $$
BEGIN
  IF timestamptz '__RECORDED_AT__' > clock_timestamp() - interval '4 years' THEN
    RAISE EXCEPTION 'recorded_at is younger than 4 years';
  END IF;
END $$;

INSERT INTO clue (
  id,
  code,
  source_code,
  domain,
  received_at,
  narrative,
  subject_unknown,
  anonymity_confirmed,
  status,
  verification_status,
  registered_by,
  entered_org_id,
  idempotency_key,
  request_digest,
  session_id,
  registered_at
)
SELECT
  '__CLUE_ID__',
  '__CODE__',
  '__SOURCE_CODE__',
  '__DOMAIN__',
  timestamptz '__RECORDED_AT__',
  '__NARRATIVE__',
  false,
  false,
  '__STATUS__',
  'not_required',
  actor.id,
  org.id,
  '__IDEMPOTENCY_KEY__',
  '__REQUEST_DIGEST__',
  '__SESSION_ID__',
  timestamptz '__RECORDED_AT__'
FROM personnel actor
JOIN org_unit org ON org.code = '__ORG_CODE__'
WHERE actor.code = '__ACTOR_CODE__'
  AND NOT EXISTS (
    SELECT 1 FROM clue existing WHERE existing.idempotency_key = '__IDEMPOTENCY_KEY__'
  );

INSERT INTO clue_spatial_object (
  id,
  clue_id,
  domain,
  kind,
  part_count,
  created_at
)
SELECT
  '__OBJECT_ID__',
  c.id,
  '__DOMAIN__',
  'face',
  1,
  timestamptz '__RECORDED_AT__'
FROM clue c
WHERE c.idempotency_key = '__IDEMPOTENCY_KEY__'
  AND NOT EXISTS (
    SELECT 1 FROM clue_spatial_object existing WHERE existing.clue_id = c.id
  );

INSERT INTO clue_spatial_part (
  id,
  spatial_object_id,
  part_index,
  geom,
  source_srid,
  source_geom,
  created_at
)
SELECT
  '__PART_ID__',
  o.id,
  0,
  ST_Transform(ST_GeomFromGeoJSON('__GEOJSON__'), 4490),
  4326,
  ST_GeomFromGeoJSON('__GEOJSON__'),
  timestamptz '__RECORDED_AT__'
FROM clue c
JOIN clue_spatial_object o ON o.clue_id = c.id
WHERE c.idempotency_key = '__IDEMPOTENCY_KEY__'
  AND NOT EXISTS (
    SELECT 1 FROM clue_spatial_part existing WHERE existing.spatial_object_id = o.id
  );

INSERT INTO clue_disposition (
  id,
  clue_id,
  disposition,
  transferred_org,
  document_no,
  letter_date,
  note,
  recorded_by,
  recorded_at,
  created_at
)
SELECT
  '__DISPOSITION_ID__',
  c.id,
  '__DISPOSITION__',
  '__TRANSFERRED_ORG__',
  '__DOCUMENT_NO__',
  timestamptz '__RECORDED_AT__',
  '__NOTE__',
  c.registered_by,
  timestamptz '__RECORDED_AT__',
  timestamptz '__RECORDED_AT__'
FROM clue c
WHERE c.idempotency_key = '__IDEMPOTENCY_KEY__'
  AND NOT EXISTS (
    SELECT 1 FROM clue_disposition existing WHERE existing.clue_id = c.id
  );

INSERT INTO clue_item_value (
  id,
  clue_id,
  key,
  value,
  created_at
)
SELECT
  '__VALUE_ID__',
  c.id,
  'clue.location',
  '__LOCATION__',
  timestamptz '__RECORDED_AT__'
FROM clue c
WHERE c.idempotency_key = '__IDEMPOTENCY_KEY__'
  AND NOT EXISTS (
    SELECT 1
    FROM clue_item_value existing
    WHERE existing.clue_id = c.id AND existing.key = 'clue.location'
  );

COMMIT;

-- 核对：不改行。比值模仿 listHistoricalHits。
-- 新面把已存 4490 几何再做一次 AsGeoJSON 后转回 4490。对方面用已存几何。
WITH target AS (
  SELECT c.id, c.status, c.registered_at, c.code
  FROM clue c
  WHERE c.idempotency_key = '__IDEMPOTENCY_KEY__'
),
disp AS (
  SELECT d.recorded_at, d.disposition
  FROM target t
  JOIN clue_disposition d ON d.clue_id = t.id
  ORDER BY d.recorded_at DESC
  LIMIT 1
),
part AS (
  SELECT p.geom
  FROM target t
  JOIN clue_spatial_object o ON o.clue_id = t.id
  JOIN clue_spatial_part p ON p.spatial_object_id = o.id
  WHERE p.part_index = 0
),
ratio AS (
  SELECT
    ST_SRID(part.geom) AS srid,
    ST_GeometryType(part.geom) AS gtype,
    ST_Equals(part.geom, ST_Transform(ST_GeomFromGeoJSON('__GEOJSON__'), 4490)) AS same_geom,
    ST_Area(
      ST_Intersection(
        ST_Transform(ST_GeomFromGeoJSON(ST_AsGeoJSON(part.geom)), 4490),
        part.geom
      )::geography
    ) / NULLIF(
      ST_Area(
        ST_Transform(ST_GeomFromGeoJSON(ST_AsGeoJSON(part.geom)), 4490)::geography
      ),
      0
    ) AS self_ratio
  FROM part
)
SELECT 'vf-hist-ancient-peer|' || concat_ws(
  '|',
  CASE
    WHEN NOT EXISTS (SELECT 1 FROM personnel WHERE code = '__ACTOR_CODE__') THEN 'missing-actor'
    WHEN NOT EXISTS (SELECT 1 FROM org_unit WHERE code = '__ORG_CODE__') THEN 'missing-org'
    WHEN NOT EXISTS (SELECT 1 FROM target) THEN 'missing-clue'
    WHEN (SELECT code FROM target) <> '__CODE__' THEN 'code-mismatch'
    WHEN NOT EXISTS (SELECT 1 FROM disp) THEN 'missing-disposition'
    WHEN NOT EXISTS (SELECT 1 FROM part) THEN 'missing-spatial'
    WHEN (SELECT status FROM target) <> '__STATUS__' THEN 'status-mismatch'
    WHEN (SELECT disposition FROM disp) <> '__DISPOSITION__' THEN 'disposition-mismatch'
    WHEN (SELECT recorded_at FROM disp) <> timestamptz '__RECORDED_AT__' THEN 'recorded-at-mismatch'
    WHEN (SELECT registered_at FROM target) <> timestamptz '__RECORDED_AT__' THEN 'registered-at-mismatch'
    WHEN (SELECT recorded_at FROM disp) > clock_timestamp() - interval '4 years' THEN 'recorded-at-not-ancient'
    WHEN (SELECT registered_at FROM target) > clock_timestamp() - interval '4 years' THEN 'registered-at-not-ancient'
    WHEN (SELECT same_geom FROM ratio) IS DISTINCT FROM true THEN 'geometry-mismatch'
    WHEN (SELECT srid FROM ratio) IS DISTINCT FROM 4490 THEN 'bad-srid'
    WHEN (SELECT gtype FROM ratio) IS DISTINCT FROM 'ST_Polygon' THEN 'bad-geometry-type'
    WHEN (SELECT self_ratio FROM ratio) IS NULL OR (SELECT self_ratio FROM ratio) < 0.6 THEN 'overlap-below-threshold'
    ELSE 'ok'
  END,
  COALESCE((SELECT status FROM target), ''),
  COALESCE((SELECT recorded_at FROM disp)::text, ''),
  COALESCE((SELECT registered_at FROM target)::text, ''),
  COALESCE((SELECT srid FROM ratio)::text, ''),
  COALESCE((SELECT gtype FROM ratio), ''),
  COALESCE((SELECT round(self_ratio::numeric, 4) FROM ratio)::text, '')
);
