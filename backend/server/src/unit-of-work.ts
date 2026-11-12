// 用途：定义事务工作单元的类型、事务内可用存储与注入令牌，保证业务行与留痕同成同败。
// 调用方：各业务服务经令牌 UNIT_OF_WORK 注入并调用 run；Prisma 实现在 backend/server/src/persistence.module.ts 装配。
// 边界：run 不可嵌套；口令散列等耗时计算放在 run 之外；rejected 结果回滚后另起事务写拒绝留痕。
// 依据：Issue #105，Issue #119。
//
// 事务前置（#105「事务前置」，#119）：管理动作的业务行与留痕同成同败。
// 本文件只定类型和令牌。Prisma 实现在 persistence.module.ts 装配。
import type { AuditTrailPort, AuditTrailReader, Rejected } from '@natural-enforcement/audit';
import type { CaseStore, ClueStore } from '@natural-enforcement/case';
import type { IdentityTransaction } from '@natural-enforcement/identity';

import type { LoginDirectory } from './login-directory.ts';
import type { RememberMeStore } from './remember-me-store.ts';
import type { SessionStore } from './session-store.ts';

/**
 * 绑定到同一个交互式事务的存储与留痕写入接口。
 * store、client 来自 IdentityTransaction，可直接传给 PersonnelService.transferPersonnel 等。
 * audit 由留痕工厂（AUDIT_TRAIL_FACTORY）按本事务客户端取得。
 */
export interface TxScope extends IdentityTransaction {
  directory: LoginDirectory;
  sessions: SessionStore;
  remember: RememberMeStore;
  audit: AuditTrailPort;
  /** 管理台留痕查阅（#126），读同一事务连接。 */
  auditReader: AuditTrailReader;
  /** 线索存储（#211）：写同一事务连接，业务行与留痕同成同败。 */
  clues: ClueStore;
  /** 立案呈批与案件最小模型（#234）。 */
  cases: CaseStore;
}

/** 事务工作单元端口：在一次交互式事务里执行业务写与留痕，拒绝时另行落留痕。 */
export interface UnitOfWork {
  /**
   * 在一个交互式事务里执行 work。
   * - 正常返回：业务行与留痕一起提交。
   * - 抛错（含留痕写入失败）：整体回滚，错误原样抛出。
   * - 返回 rejected(outcome, ...留痕)：回滚，再另起事务写入拒绝类留痕，返回 outcome。
   * 口令散列等耗时计算放在 run 之外。run 不可嵌套。
   */
  run<T>(work: (tx: TxScope) => Promise<T | Rejected<T>>): Promise<T>;
}

/** 注入令牌：事务工作单元的实现，装配在 backend/server/src/persistence.module.ts。 */
export const UNIT_OF_WORK = Symbol('UNIT_OF_WORK');
