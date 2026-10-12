-- #69 认证记录：会话与记住我分两张表。
-- 技术主键 = ULID（#16 §1.1，应用侧生成）。只失效不删除。两表只引用 personnel.id。
-- 不存组织、角色、数据范围、执法资格（#64）。
-- secret_hash 是发给浏览器的 256 位随机数的 SHA-256，64 位小写十六进制，不存随机数本身。
-- 寿命、Cookie、并发与结束条件以 #63 为准，不在本迁移重写数值。
--
-- 一台设备 = 一个 chain_id（首行 id，换新秘密时原样复制）。
-- 换新秘密的写入顺序：先结束旧行（end_reason = rotated），再插入 predecessor_id 指向旧行的新行。
-- 后继只接受 end_reason = rotated 的前驱。退出、未勾选、挤掉、停用不是换新，不能再延长这条链。
-- predecessor_id 唯一：每个前驱至多一个后继，并发提交不能签发第二枚新秘密。
-- 带记住我的会话，absolute_ends_at 必须等于该链首行的绝对终点。
-- 部分唯一索引：同一 chain 同时至多一行未结束。按设备作废 = 结束该 chain 上未结束的那一行。
-- 旧秘密再次出现：按 secret_hash 命中 end_reason = rotated 的行，再结束该人员的全部会话和全部记住我。

CREATE TABLE auth_remember_me (
  id               TEXT PRIMARY KEY,
  personnel_id     TEXT NOT NULL REFERENCES personnel (id),
  chain_id         TEXT NOT NULL,
  secret_hash      TEXT NOT NULL UNIQUE,
  absolute_ends_at TIMESTAMPTZ NOT NULL,
  predecessor_id   TEXT UNIQUE,
  ended_at         TIMESTAMPTZ,
  end_reason       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT auth_remember_me_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT auth_remember_me_chain_ulid CHECK (chain_id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT auth_remember_me_chain_fk FOREIGN KEY (chain_id) REFERENCES auth_remember_me (id),
  CONSTRAINT auth_remember_me_predecessor_fk FOREIGN KEY (predecessor_id) REFERENCES auth_remember_me (id),
  CONSTRAINT auth_remember_me_predecessor_ulid CHECK (
    predecessor_id IS NULL OR predecessor_id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'
  ),
  CONSTRAINT auth_remember_me_secret_hash_sha256 CHECK (secret_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT auth_remember_me_end_pair CHECK ((ended_at IS NULL) = (end_reason IS NULL)),
  CONSTRAINT auth_remember_me_end_reason CHECK (
    end_reason IS NULL OR end_reason IN (
      'logout',
      'login-without-remember',
      'rotated',
      'displaced',
      'admin-ended',
      'personnel-deactivated',
      'remember-me-reuse',
      'absolute-timeout'
    )
  ),
  CONSTRAINT auth_remember_me_absolute_after_create CHECK (absolute_ends_at > created_at)
);

CREATE UNIQUE INDEX auth_remember_me_one_active_per_chain
  ON auth_remember_me (chain_id)
  WHERE ended_at IS NULL;

CREATE INDEX auth_remember_me_active_by_personnel
  ON auth_remember_me (personnel_id)
  WHERE ended_at IS NULL;

CREATE TABLE auth_session (
  id                   TEXT PRIMARY KEY,
  personnel_id         TEXT NOT NULL REFERENCES personnel (id),
  secret_hash          TEXT NOT NULL UNIQUE,
  remember_me_chain_id TEXT,
  authenticated_at     TIMESTAMPTZ NOT NULL,
  last_seen_at         TIMESTAMPTZ NOT NULL,
  absolute_ends_at     TIMESTAMPTZ NOT NULL,
  ended_at             TIMESTAMPTZ,
  end_reason           TEXT,
  CONSTRAINT auth_session_id_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  CONSTRAINT auth_session_chain_ulid CHECK (
    remember_me_chain_id IS NULL OR remember_me_chain_id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'
  ),
  CONSTRAINT auth_session_chain_fk FOREIGN KEY (remember_me_chain_id) REFERENCES auth_remember_me (id),
  CONSTRAINT auth_session_secret_hash_sha256 CHECK (secret_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT auth_session_clock CHECK (
    last_seen_at >= authenticated_at AND absolute_ends_at > authenticated_at
  ),
  CONSTRAINT auth_session_end_pair CHECK ((ended_at IS NULL) = (end_reason IS NULL)),
  CONSTRAINT auth_session_end_reason CHECK (
    end_reason IS NULL OR end_reason IN (
      'logout',
      'admin-ended',
      'personnel-deactivated',
      'idle-timeout',
      'absolute-timeout',
      'displaced',
      'remember-me-reuse'
    )
  )
);

CREATE INDEX auth_session_active_by_personnel
  ON auth_session (personnel_id, authenticated_at)
  WHERE ended_at IS NULL;

CREATE OR REPLACE FUNCTION auth_remember_me_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% 拒绝 DELETE（#69：记住我只失效不删除）', TG_TABLE_NAME;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.chain_id <> NEW.id AND NOT EXISTS (
      SELECT 1 FROM auth_remember_me AS root
      WHERE root.id = NEW.chain_id AND root.chain_id = NEW.chain_id
    ) THEN
      RAISE EXCEPTION '% 拒绝 INSERT（#69：chain_id 必须是本行 id，或一条已存在的链的首行 id）', TG_TABLE_NAME;
    END IF;
    IF NEW.predecessor_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM auth_remember_me AS prev
      WHERE prev.id = NEW.predecessor_id
        AND prev.chain_id = NEW.chain_id
        AND prev.personnel_id = NEW.personnel_id
        AND prev.ended_at IS NOT NULL
        AND prev.end_reason = 'rotated'
        AND prev.absolute_ends_at = NEW.absolute_ends_at
    ) THEN
      RAISE EXCEPTION '% 拒绝 INSERT（#69：前驱必须是同一人员、同一设备链上因换新秘密而结束的记住我，且绝对终点原样复制）', TG_TABLE_NAME;
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.ended_at IS NOT NULL THEN
    RAISE EXCEPTION '% 拒绝 UPDATE（#69：已结束的记住我不可改）', TG_TABLE_NAME;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.personnel_id IS DISTINCT FROM OLD.personnel_id
     OR NEW.chain_id IS DISTINCT FROM OLD.chain_id
     OR NEW.secret_hash IS DISTINCT FROM OLD.secret_hash
     OR NEW.absolute_ends_at IS DISTINCT FROM OLD.absolute_ends_at
     OR NEW.predecessor_id IS DISTINCT FROM OLD.predecessor_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION '% 拒绝 UPDATE（#69：记住我只允许一次写入 ended_at 与 end_reason）', TG_TABLE_NAME;
  END IF;
  IF NEW.ended_at IS NULL THEN
    IF NEW.end_reason IS NOT NULL THEN
      RAISE EXCEPTION '% 拒绝 UPDATE（#69：未结束的记住我不能带 end_reason）', TG_TABLE_NAME;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.end_reason IS NULL THEN
    RAISE EXCEPTION '% 拒绝 UPDATE（#69：结束记住我必须同时写入 end_reason）', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER auth_remember_me_guard
  BEFORE INSERT OR UPDATE OR DELETE ON auth_remember_me
  FOR EACH ROW EXECUTE FUNCTION auth_remember_me_guard();

CREATE OR REPLACE FUNCTION auth_session_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% 拒绝 DELETE（#69：会话只失效不删除）', TG_TABLE_NAME;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.remember_me_chain_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM auth_remember_me AS root
      WHERE root.id = NEW.remember_me_chain_id
        AND root.chain_id = NEW.remember_me_chain_id
        AND root.personnel_id = NEW.personnel_id
        AND root.absolute_ends_at = NEW.absolute_ends_at
    ) THEN
      RAISE EXCEPTION '% 拒绝 INSERT（#69：remember_me_chain_id 必须是同一人员的记住我链首行 id，且绝对终点原样复制）', TG_TABLE_NAME;
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.ended_at IS NOT NULL THEN
    RAISE EXCEPTION '% 拒绝 UPDATE（#69：已结束会话不可改）', TG_TABLE_NAME;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.personnel_id IS DISTINCT FROM OLD.personnel_id
     OR NEW.secret_hash IS DISTINCT FROM OLD.secret_hash
     OR NEW.remember_me_chain_id IS DISTINCT FROM OLD.remember_me_chain_id
     OR NEW.authenticated_at IS DISTINCT FROM OLD.authenticated_at
     OR NEW.absolute_ends_at IS DISTINCT FROM OLD.absolute_ends_at THEN
    RAISE EXCEPTION '% 拒绝 UPDATE（#69：会话只允许推进 last_seen_at，或一次写入 ended_at 与 end_reason）', TG_TABLE_NAME;
  END IF;
  IF NEW.last_seen_at < OLD.last_seen_at THEN
    RAISE EXCEPTION '% 拒绝 UPDATE（#69：last_seen_at 不可倒退）', TG_TABLE_NAME;
  END IF;
  IF NEW.ended_at IS NULL THEN
    IF NEW.end_reason IS NOT NULL THEN
      RAISE EXCEPTION '% 拒绝 UPDATE（#69：未结束会话不能带 end_reason）', TG_TABLE_NAME;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.end_reason IS NULL THEN
    RAISE EXCEPTION '% 拒绝 UPDATE（#69：结束会话必须同时写入 end_reason）', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER auth_session_guard
  BEFORE INSERT OR UPDATE OR DELETE ON auth_session
  FOR EACH ROW EXECUTE FUNCTION auth_session_guard();
