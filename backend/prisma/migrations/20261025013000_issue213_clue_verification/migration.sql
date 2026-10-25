-- #213 内业核查编排：运行行补齐失败类别、缺图层与每层事实。
--
-- 尝试次数列改名为 attempts_used（语义＝已用尝试次数），并放宽下限到 0：
-- 运行行在任务真正开始执行前就已建好，已用尝试次数此时为 0。
--
-- 每条线索至多一个活动核查：活动核查＝status 为 running 的运行。
-- 用部分唯一索引承载，库内直接挡住并发手动重跑。
ALTER TABLE clue_verification_run RENAME COLUMN attempts TO attempts_used;

ALTER TABLE clue_verification_run
  ALTER COLUMN attempts_used SET DEFAULT 0;

ALTER TABLE clue_verification_run
  DROP CONSTRAINT clue_verification_run_attempts_ck;

ALTER TABLE clue_verification_run
  ADD CONSTRAINT clue_verification_run_attempts_used_ck CHECK (attempts_used >= 0);

ALTER TABLE clue_verification_run
  ADD COLUMN failure_category TEXT;

ALTER TABLE clue_verification_run
  ADD CONSTRAINT clue_verification_run_failure_category_ck
  CHECK (failure_category IS NULL OR failure_category IN ('transient', 'deterministic'));

ALTER TABLE clue_verification_run
  ADD COLUMN missing_layers TEXT;

ALTER TABLE clue_verification_run
  ADD COLUMN layers_json TEXT;

CREATE UNIQUE INDEX clue_verification_run_active_idx
  ON clue_verification_run (clue_id)
  WHERE status = 'running';
