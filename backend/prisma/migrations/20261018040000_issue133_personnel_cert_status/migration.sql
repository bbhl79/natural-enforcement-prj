-- #133（#105「执法证（#85）」，Lei Hu 7-3）：人员新增必填「证件状态」，只取两项：
-- valid 有效、invalid 失效。临期（30 天内到期）与已过期不入库，按有效期推导。
-- 加列与回填同一迁移：存量人员一律回填 valid（此前没有状态列，已登记的执法证按有效处理）。
-- 执法资格 fail-closed：状态为 valid 且在有效期内（北京时间日界）才算有执法资格。
-- 列默认值 valid 承担两件事：本迁移的存量回填，以及登记人员时不填证件状态（#128 的新建页没有这一项，
-- 填了执法证即为有效）。执法证登记（personnel.cert.update）一律显式写入状态。

ALTER TABLE personnel ADD COLUMN enforcement_cert_status TEXT NOT NULL DEFAULT 'valid';

ALTER TABLE personnel
  ADD CONSTRAINT personnel_cert_status_known CHECK (enforcement_cert_status IN ('valid', 'invalid'));

COMMENT ON COLUMN personnel.enforcement_cert_status IS
  '证件状态（#133）：valid 有效、invalid 失效。只存这两项，临期与已过期按有效期推导。';
