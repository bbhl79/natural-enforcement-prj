// 用途：定义「记住我」令牌的存储端口与行形状，支持链式轮换与按人／按链作废。
// 调用方：backend/server/src/auth.service.ts、backend/server/src/unit-of-work.ts；实现装配在 backend/server/src/persistence.module.ts。
// 边界：先结束旧行再插入后继的轮换由存储保证唯一约束，竞争失败返回 lost-race。
//
/** 「记住我」令牌行：同一 chainId 串成一条链，predecessorId 指向被轮换的前一行。 */
export interface RememberMeRow {
  id: string;
  personnelId: string;
  chainId: string;
  secretHash: string;
  absoluteEndsAt: Date;
  predecessorId: string | null;
  endedAt: Date | null;
  endReason: string | null;
  createdAt: Date;
}

/** 待插入的「记住我」令牌：已由调用方生成 id、链号与散列。 */
export interface NewRememberMe {
  id: string;
  personnelId: string;
  chainId: string;
  secretHash: string;
  absoluteEndsAt: Date;
  predecessorId: string | null;
  createdAt: Date;
}

/** 「记住我」存储端口：插入、按散列或后继查找、结束与轮换。 */
export interface RememberMeStore {
  insert(row: NewRememberMe): Promise<void>;
  findBySecretHash(secretHash: string): Promise<RememberMeRow | null>;
  findSuccessor(predecessorId: string): Promise<RememberMeRow | null>;
  end(id: string, endedAt: Date, reason: string): Promise<void>;
  endActiveOnChain(chainId: string, endedAt: Date, reason: string): Promise<void>;
  endActiveForPersonnel(personnelId: string, endedAt: Date, reason: string): Promise<void>;
  /** 先结束旧行，再插入后继。第二次插入被唯一约束卡住时返回 lost-race。 */
  rotate(currentId: string, next: NewRememberMe, endedAt: Date): Promise<'rotated' | 'lost-race'>;
}

/** 注入令牌：根客户端上的「记住我」存储，事务内用 TxScope 上的 remember。 */
export const REMEMBER_ME_STORE = Symbol('REMEMBER_ME_STORE');
