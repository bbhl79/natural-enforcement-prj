-- #210 参照数据五张表（ADR 0016 参照数据随种子只追加写入）。
-- 只追加：库层触发器拒 UPDATE 与 DELETE（复用 0002_identity_org 建的 reject_row_mutation）。
-- 业务唯一键 =「业务编码 + 版本」；每一版带出处与启用状态。
-- 停用某编码 = 追加一版标 inactive，不改旧行；引用钉版本并冻结显示快照。
-- 上一级显式存「上级编码」，不按编码前缀推断。

CREATE TABLE geo_dict_source_code (
  id          TEXT PRIMARY KEY,
  code        TEXT NOT NULL,
  version     INTEGER NOT NULL,
  name        TEXT NOT NULL,
  parent_code TEXT,
  source      TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (code, version),
  CONSTRAINT geo_dict_source_code_status_ck CHECK (status IN ('active', 'inactive'))
);
CREATE INDEX geo_dict_source_code_code_idx ON geo_dict_source_code (code);

CREATE TABLE geo_dict_violation_type (
  id          TEXT PRIMARY KEY,
  code        TEXT NOT NULL,
  version     INTEGER NOT NULL,
  name        TEXT NOT NULL,
  domain      TEXT NOT NULL,
  parent_code TEXT,
  selectable  BOOLEAN NOT NULL DEFAULT true,
  appendix    TEXT,
  source      TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (code, version),
  CONSTRAINT geo_dict_violation_type_domain_ck CHECK (domain IN ('land', 'mineral', 'survey', 'planning')),
  CONSTRAINT geo_dict_violation_type_code_ck CHECK (code ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT geo_dict_violation_type_status_ck CHECK (status IN ('active', 'inactive'))
);
CREATE INDEX geo_dict_violation_type_code_idx ON geo_dict_violation_type (code);

CREATE TABLE geo_dict_document (
  id               TEXT PRIMARY KEY,
  code             TEXT NOT NULL,
  version          INTEGER NOT NULL,
  name             TEXT NOT NULL,
  hierarchy_level  TEXT NOT NULL,
  validity_status  TEXT NOT NULL,
  note             TEXT,
  source           TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'active',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (code, version),
  -- 效力层级九档（GLOSSARY「效力层级」）。
  CONSTRAINT geo_dict_document_hierarchy_ck CHECK (hierarchy_level IN (
    '法律', '行政法规', '司法解释', '部门规章', '部门规范性文件',
    '省级地方性法规', '设区的市地方性法规', '地方政府规章', '地方政府规范性文件'
  )),
  -- 效力状态三值（GLOSSARY「效力状态」）。
  CONSTRAINT geo_dict_document_validity_ck CHECK (validity_status IN ('现行有效', '已废止', '存疑')),
  CONSTRAINT geo_dict_document_status_ck CHECK (status IN ('active', 'inactive'))
);
CREATE INDEX geo_dict_document_code_idx ON geo_dict_document (code);

CREATE TABLE geo_dict_violation_type_basis (
  id                  TEXT PRIMARY KEY,
  violation_type_id   TEXT NOT NULL REFERENCES geo_dict_violation_type (id),
  violation_type_code TEXT NOT NULL,
  violation_type_name TEXT NOT NULL,
  document_id         TEXT NOT NULL REFERENCES geo_dict_document (id),
  document_code       TEXT NOT NULL,
  document_name       TEXT NOT NULL,
  article_no          TEXT NOT NULL,
  purpose             TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (violation_type_id, document_id, article_no, purpose),
  -- 依据用途四类（GLOSSARY「依据用途」）。
  CONSTRAINT geo_dict_violation_type_basis_purpose_ck CHECK (
    purpose IN ('处罚', '裁量基准', '移送处分', '认定标准')
  )
);
CREATE INDEX geo_dict_violation_type_basis_type_idx ON geo_dict_violation_type_basis (violation_type_id);
CREATE INDEX geo_dict_violation_type_basis_document_idx ON geo_dict_violation_type_basis (document_id);

CREATE TABLE geo_dict_jurisdiction (
  id         TEXT PRIMARY KEY,
  code       TEXT NOT NULL,
  version    INTEGER NOT NULL,
  name       TEXT NOT NULL,
  org_code   TEXT NOT NULL,
  org_name   TEXT NOT NULL,
  source     TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (code, version),
  CONSTRAINT geo_dict_jurisdiction_status_ck CHECK (status IN ('active', 'inactive'))
);
CREATE INDEX geo_dict_jurisdiction_code_idx ON geo_dict_jurisdiction (code);

CREATE TRIGGER geo_dict_source_code_immutable
  BEFORE UPDATE OR DELETE ON geo_dict_source_code
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
CREATE TRIGGER geo_dict_violation_type_immutable
  BEFORE UPDATE OR DELETE ON geo_dict_violation_type
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
CREATE TRIGGER geo_dict_document_immutable
  BEFORE UPDATE OR DELETE ON geo_dict_document
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
CREATE TRIGGER geo_dict_violation_type_basis_immutable
  BEFORE UPDATE OR DELETE ON geo_dict_violation_type_basis
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
CREATE TRIGGER geo_dict_jurisdiction_immutable
  BEFORE UPDATE OR DELETE ON geo_dict_jurisdiction
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
