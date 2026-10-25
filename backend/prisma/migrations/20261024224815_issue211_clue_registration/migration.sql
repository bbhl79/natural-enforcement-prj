-- #211 线索登记：18 张 case 业务表 + 线索编号 sequence + 留痕 detail 列。
--
-- 归属（规格 F）：18 张表归 case 模块，是线索业务事实。空间三表
-- （clue_spatial_object / clue_spatial_part / clue_spatial_hit）的几何读写在 case 内走
-- $queryRaw：clue_spatial_part 与 clue_spatial_hit 禁 ORM create/update（执行纪律 2）。
-- 与 #54 的 geo_dict_land_boundary / geo_dict_survey_point 不复用、不替代、不改动。
--
-- 主键形制（#16 §1.1）：TEXT 技术主键，ULID 由应用侧生成，库内无默认值。
-- 业务编号（clue.code）与主键分离：取值来自 clue_code_seq（PostgreSQL sequence，迁移创建，
-- 不算 model），形如 CL0000000001。编号永不当引用键。
--
-- 留痕列：audit_trail 只新增可空 detail TEXT（规格 F：只写不回）。加列不改已有行，
-- 追加式触发器 audit_trail_append_only 不受影响。

-- 线索编号序列：业务编号的取值来源（应用侧 nextval 后按 CL + 10 位补零格式化）。
CREATE SEQUENCE clue_code_seq AS BIGINT START 1 INCREMENT BY 1;

-- 线索主体
CREATE TABLE clue (
  id                    TEXT PRIMARY KEY,
  code                  TEXT NOT NULL,
  source_code           TEXT NOT NULL,
  domain                TEXT NOT NULL,
  received_at           TIMESTAMPTZ NOT NULL,
  narrative             TEXT NOT NULL,
  subject_unknown       BOOLEAN NOT NULL DEFAULT false,
  anonymity_confirmed   BOOLEAN NOT NULL DEFAULT false,
  status                TEXT NOT NULL DEFAULT 'in_pool',
  verification_status   TEXT NOT NULL DEFAULT 'not_required',
  registered_by         TEXT NOT NULL,
  entered_org_id        TEXT NOT NULL,
  idempotency_key       TEXT NOT NULL,
  request_digest        TEXT NOT NULL,
  session_id            TEXT NOT NULL,
  registered_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (code),
  UNIQUE (idempotency_key),
  -- 一条线索一个法域（ADR 0020）
  CONSTRAINT clue_domain_ck CHECK (domain IN ('land', 'mineral', 'survey', 'planning')),
  -- 主状态八值（规格 A）
  CONSTRAINT clue_status_ck CHECK (status IN (
    'pending_decision', 'in_pool', 'org_assigned', 'handler_assigned',
    'held', 'transferred_out', 'closed', 'filed'
  )),
  -- 核查状态四值（正交属性，不进三级校验）
  CONSTRAINT clue_verification_status_ck CHECK (verification_status IN ('not_required', 'running', 'done', 'failed'))
);
CREATE INDEX clue_status_idx ON clue (status);
CREATE INDEX clue_registered_at_idx ON clue (registered_at);

-- 空间对象：线索持有 1..1 空间对象，逻辑对象可含 N 个几何部件
CREATE TABLE clue_spatial_object (
  id                TEXT PRIMARY KEY,
  clue_id           TEXT NOT NULL,
  domain            TEXT NOT NULL,
  kind              TEXT NOT NULL,
  part_count        INTEGER NOT NULL DEFAULT 0,
  dup_computed_at   TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (clue_id),
  CONSTRAINT clue_spatial_object_clue_id_fkey FOREIGN KEY (clue_id) REFERENCES clue (id),
  CONSTRAINT clue_spatial_object_domain_ck CHECK (domain IN ('land', 'mineral', 'survey', 'planning')),
  -- 几何形态：面（土地/矿产）或点（测绘/规划）
  CONSTRAINT clue_spatial_object_kind_ck CHECK (kind IN ('face', 'point')),
  CONSTRAINT clue_spatial_object_part_count_ck CHECK (part_count >= 0)
);

-- 空间部件：形制沿用 GeoDictLandBoundary（geom 为 EPSG:4490，source_srid + source_geom 保留来源坐标）
CREATE TABLE clue_spatial_part (
  id                 TEXT PRIMARY KEY,
  spatial_object_id  TEXT NOT NULL,
  part_index         INTEGER NOT NULL,
  geom               geometry(Geometry,4490) NOT NULL,
  source_srid        INTEGER NOT NULL,
  source_geom        geometry NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (spatial_object_id, part_index),
  CONSTRAINT clue_spatial_part_object_fkey FOREIGN KEY (spatial_object_id) REFERENCES clue_spatial_object (id),
  CONSTRAINT clue_spatial_part_index_ck CHECK (part_index >= 0),
  CONSTRAINT clue_spatial_part_source_srid_ck CHECK (source_srid > 0),
  -- 面部件（土地/矿产）或点部件（测绘/规划）
  CONSTRAINT clue_spatial_part_geom_type_ck CHECK (
    ST_GeometryType(geom) IN ('ST_Polygon', 'ST_MultiPolygon', 'ST_Point')
  )
);
CREATE INDEX clue_spatial_part_object_idx ON clue_spatial_part (spatial_object_id);

-- 录入要件快照：登记时快照要件键集合，老线索按登记当时判断
CREATE TABLE clue_requirement_snapshot (
  id                   TEXT PRIMARY KEY,
  clue_id              TEXT NOT NULL,
  key                  TEXT NOT NULL,
  layer                TEXT NOT NULL,
  "group"              TEXT NOT NULL,
  label                TEXT NOT NULL,
  required             BOOLEAN NOT NULL,
  consequence          TEXT NOT NULL,
  timing               TEXT NOT NULL,
  declaration_version  TEXT NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (clue_id, key),
  CONSTRAINT clue_requirement_snapshot_clue_fkey FOREIGN KEY (clue_id) REFERENCES clue (id),
  CONSTRAINT clue_requirement_snapshot_layer_ck CHECK (layer IN ('public', 'source', 'type')),
  CONSTRAINT clue_requirement_snapshot_consequence_ck CHECK (consequence IN ('阻断', '警告', '提示')),
  CONSTRAINT clue_requirement_snapshot_timing_ck CHECK (timing IN ('录入时', '核查前补齐', '只提示'))
);
CREATE INDEX clue_requirement_snapshot_clue_idx ON clue_requirement_snapshot (clue_id);

-- 要件取值
CREATE TABLE clue_item_value (
  id          TEXT PRIMARY KEY,
  clue_id     TEXT NOT NULL,
  key         TEXT NOT NULL,
  value       TEXT,
  value_json  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (clue_id, key),
  CONSTRAINT clue_item_value_clue_fkey FOREIGN KEY (clue_id) REFERENCES clue (id)
);
CREATE INDEX clue_item_value_clue_idx ON clue_item_value (clue_id);

-- 缺件：类型层缺件为常驻事实行；补齐后清单消失，行仍保留（filled_at 记补齐时间）
CREATE TABLE clue_item_gap (
  id           TEXT PRIMARY KEY,
  clue_id      TEXT NOT NULL,
  key          TEXT NOT NULL,
  layer        TEXT NOT NULL,
  label        TEXT NOT NULL,
  required     BOOLEAN NOT NULL,
  timing       TEXT NOT NULL,
  consequence  TEXT NOT NULL,
  filled_at    TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (clue_id, key),
  CONSTRAINT clue_item_gap_clue_fkey FOREIGN KEY (clue_id) REFERENCES clue (id),
  CONSTRAINT clue_item_gap_layer_ck CHECK (layer IN ('public', 'source', 'type')),
  CONSTRAINT clue_item_gap_consequence_ck CHECK (consequence IN ('阻断', '警告', '提示')),
  CONSTRAINT clue_item_gap_timing_ck CHECK (timing IN ('录入时', '核查前补齐', '只提示'))
);
CREATE INDEX clue_item_gap_clue_idx ON clue_item_gap (clue_id, filled_at);

-- 初步涉嫌违法类型：可空可多个
CREATE TABLE clue_initial_type (
  id          TEXT PRIMARY KEY,
  clue_id     TEXT NOT NULL,
  type_code   TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (clue_id, type_code),
  CONSTRAINT clue_initial_type_clue_fkey FOREIGN KEY (clue_id) REFERENCES clue (id)
);
CREATE INDEX clue_initial_type_clue_idx ON clue_initial_type (clue_id);

-- 标签库：登记时 create-on-use，库里没有的当场新建
CREATE TABLE clue_tag_library (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (name)
);

-- 线索标签
CREATE TABLE clue_tag (
  id          TEXT PRIMARY KEY,
  clue_id     TEXT NOT NULL,
  library_id  TEXT NOT NULL,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (clue_id, name),
  CONSTRAINT clue_tag_clue_fkey FOREIGN KEY (clue_id) REFERENCES clue (id),
  CONSTRAINT clue_tag_library_fkey FOREIGN KEY (library_id) REFERENCES clue_tag_library (id)
);
CREATE INDEX clue_tag_clue_idx ON clue_tag (clue_id);

-- 已登记材料：只在登记事务中写入，没有待关联状态；含 GeoJSON 来源文件
CREATE TABLE clue_material (
  id            TEXT PRIMARY KEY,
  clue_id       TEXT NOT NULL,
  kind          TEXT NOT NULL,
  file_key      TEXT NOT NULL,
  version_id    TEXT NOT NULL,
  file_name     TEXT NOT NULL,
  content_type  TEXT NOT NULL,
  byte_size     INTEGER NOT NULL,
  digest        TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT clue_material_clue_fkey FOREIGN KEY (clue_id) REFERENCES clue (id),
  CONSTRAINT clue_material_kind_ck CHECK (kind IN ('attachment', 'spatial-source')),
  CONSTRAINT clue_material_byte_size_ck CHECK (byte_size >= 0)
);
CREATE INDEX clue_material_clue_idx ON clue_material (clue_id);

-- 疑似重复命中：每个合格面对一行，只存当前命中集，重算整体替换
CREATE TABLE clue_spatial_hit (
  id                 TEXT PRIMARY KEY,
  clue_id            TEXT NOT NULL,
  spatial_part_id    TEXT NOT NULL,
  other_clue_id      TEXT NOT NULL,
  other_part_id      TEXT NOT NULL,
  self_ratio         DOUBLE PRECISION NOT NULL,
  other_ratio        DOUBLE PRECISION NOT NULL,
  intersection_area  DOUBLE PRECISION NOT NULL,
  computed_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (clue_id, spatial_part_id, other_clue_id, other_part_id),
  CONSTRAINT clue_spatial_hit_clue_fkey FOREIGN KEY (clue_id) REFERENCES clue (id),
  CONSTRAINT clue_spatial_hit_part_fkey FOREIGN KEY (spatial_part_id) REFERENCES clue_spatial_part (id),
  CONSTRAINT clue_spatial_hit_other_part_fkey FOREIGN KEY (other_part_id) REFERENCES clue_spatial_part (id),
  CONSTRAINT clue_spatial_hit_self_ratio_ck CHECK (self_ratio >= 0 AND self_ratio <= 1),
  CONSTRAINT clue_spatial_hit_other_ratio_ck CHECK (other_ratio >= 0 AND other_ratio <= 1),
  CONSTRAINT clue_spatial_hit_area_ck CHECK (intersection_area >= 0)
);
CREATE INDEX clue_spatial_hit_clue_idx ON clue_spatial_hit (clue_id);
CREATE INDEX clue_spatial_hit_other_clue_idx ON clue_spatial_hit (other_clue_id);

-- 内业核查运行：土地/矿产录入保存后自动入队，点状不跑
CREATE TABLE clue_verification_run (
  id              TEXT PRIMARY KEY,
  clue_id         TEXT NOT NULL,
  run_no          INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'running',
  attempts        INTEGER NOT NULL DEFAULT 1,
  trigger         TEXT NOT NULL DEFAULT 'auto',
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at        TIMESTAMPTZ,
  artifacts_json  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (clue_id, run_no),
  CONSTRAINT clue_verification_run_clue_fkey FOREIGN KEY (clue_id) REFERENCES clue (id),
  CONSTRAINT clue_verification_run_status_ck CHECK (status IN ('running', 'done', 'failed')),
  CONSTRAINT clue_verification_run_trigger_ck CHECK (trigger IN ('auto', 'manual')),
  CONSTRAINT clue_verification_run_attempts_ck CHECK (attempts >= 1)
);
CREATE INDEX clue_verification_run_clue_idx ON clue_verification_run (clue_id);

-- 承办人：主办/协办
CREATE TABLE clue_handler (
  id            TEXT PRIMARY KEY,
  clue_id       TEXT NOT NULL,
  personnel_id  TEXT NOT NULL,
  role          TEXT NOT NULL,
  assigned_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at      TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (clue_id, personnel_id, role),
  CONSTRAINT clue_handler_clue_fkey FOREIGN KEY (clue_id) REFERENCES clue (id),
  CONSTRAINT clue_handler_role_ck CHECK (role IN ('main', 'assist'))
);
CREATE INDEX clue_handler_clue_idx ON clue_handler (clue_id);

-- 分派事实：首次分派、重新分派、指定管辖、系统管理员重新指定都并入本表
CREATE TABLE clue_assignment (
  id            TEXT PRIMARY KEY,
  clue_id       TEXT NOT NULL,
  org_unit_id   TEXT NOT NULL,
  kind          TEXT NOT NULL,
  designate     BOOLEAN NOT NULL DEFAULT false,
  assigned_by   TEXT NOT NULL,
  assigned_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at      TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT clue_assignment_clue_fkey FOREIGN KEY (clue_id) REFERENCES clue (id),
  CONSTRAINT clue_assignment_kind_ck CHECK (kind IN ('initial', 'reassign', 'designate', 'pool-reassign'))
);
CREATE INDEX clue_assignment_clue_idx ON clue_assignment (clue_id);

-- 撤回不派：原因编码为数组列，至少一项；说明必填
CREATE TABLE clue_withdrawal (
  id             TEXT PRIMARY KEY,
  clue_id        TEXT NOT NULL,
  reason_codes   TEXT[] NOT NULL,
  note           TEXT NOT NULL,
  withdrawn_by   TEXT NOT NULL,
  withdrawn_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT clue_withdrawal_clue_fkey FOREIGN KEY (clue_id) REFERENCES clue (id),
  CONSTRAINT clue_withdrawal_reason_codes_ck CHECK (cardinality(reason_codes) >= 1),
  CONSTRAINT clue_withdrawal_note_ck CHECK (length(btrim(note)) > 0)
);
CREATE INDEX clue_withdrawal_clue_idx ON clue_withdrawal (clue_id);

-- 处置：不予立案、随旧线索办结、移送
CREATE TABLE clue_disposition (
  id               TEXT PRIMARY KEY,
  clue_id          TEXT NOT NULL,
  disposition      TEXT NOT NULL,
  transferred_org  TEXT,
  document_no      TEXT,
  note             TEXT,
  recorded_by      TEXT NOT NULL,
  recorded_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT clue_disposition_clue_fkey FOREIGN KEY (clue_id) REFERENCES clue (id),
  CONSTRAINT clue_disposition_type_ck CHECK (disposition IN ('no-case', 'with-old', 'transfer'))
);
CREATE INDEX clue_disposition_clue_idx ON clue_disposition (clue_id);

-- 结案提醒
CREATE TABLE clue_closure_reminder (
  id            TEXT PRIMARY KEY,
  clue_id       TEXT NOT NULL,
  kind          TEXT NOT NULL,
  other_clue_id TEXT,
  due_at        TIMESTAMPTZ NOT NULL,
  resolved_at   TIMESTAMPTZ,
  resolution    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT clue_closure_reminder_clue_fkey FOREIGN KEY (clue_id) REFERENCES clue (id),
  CONSTRAINT clue_closure_reminder_kind_ck CHECK (kind IN ('no-case', 'transfer', 'case'))
);
CREATE INDEX clue_closure_reminder_clue_idx ON clue_closure_reminder (clue_id, resolved_at);

-- 指定管辖报请
CREATE TABLE clue_designation_request (
  id                 TEXT PRIMARY KEY,
  clue_id            TEXT NOT NULL,
  requesting_org_id  TEXT NOT NULL,
  proposed_org_id    TEXT NOT NULL,
  reason             TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pending',
  decided_by         TEXT,
  decided_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT clue_designation_request_clue_fkey FOREIGN KEY (clue_id) REFERENCES clue (id),
  CONSTRAINT clue_designation_request_status_ck CHECK (status IN ('pending', 'approved', 'rejected'))
);
CREATE INDEX clue_designation_request_clue_idx ON clue_designation_request (clue_id, status);

-- 留痕结构化快照：只写不回（规格 G）
ALTER TABLE audit_trail
  ADD COLUMN detail TEXT;

COMMENT ON COLUMN audit_trail.detail IS '结构化快照（#211，规格 G）：只写不回。线索动作的编号、当前命中集摘要、缺件键写在这里。';

COMMENT ON TABLE clue IS '线索（#211）：业务编号与主键分离；幂等键与请求摘要同存两列。';
COMMENT ON TABLE clue_spatial_part IS '线索空间部件（#211）：geom 为 EPSG:4490，来源 SRID 与来源几何原样保留；禁 ORM create/update。';
COMMENT ON TABLE clue_spatial_hit IS '线索疑似重复当前命中集（#211）：每个合格面对一行，重算整体替换。';
COMMENT ON SEQUENCE clue_code_seq IS '线索业务编号取值序列（#211）：应用侧 nextval 后格式化为 CL + 10 位补零。';
