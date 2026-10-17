// 事务前置（#105「事务前置」，#119）：业务行与留痕同成同败。
// 本文件不碰数据库。事务由调用方打开，留痕经工厂按事务客户端取得。
import type { AuditAppend, AuditTrailPort, AuthzDeniedEntry } from './port.ts';

/** 一行可追加的留痕。 */
export type AuditEntry = AuditAppend | AuthzDeniedEntry;

/**
 * 留痕工厂（接缝①）。按事务客户端交出写入接口。
 * client 是调用方打开的事务客户端，本包不认识它的具体类型。
 * 测试可覆写为「业务写完后抛错」，断言业务行随之回滚。
 */
export interface AuditTrailFactory {
  forClient(client: unknown): AuditTrailPort;
}

const REJECTED = Symbol('REJECTED');

/**
 * 被拒绝的业务动作。outcome 是返回给调用方的结果。
 * audits 是拒绝类留痕（authz.denied、outcome=failed 的业务拒绝），
 * 在业务事务回滚之后另起事务写入。
 */
export interface Rejected<T> {
  readonly [REJECTED]: true;
  readonly outcome: T;
  readonly audits: readonly AuditEntry[];
}

export function rejected<T>(outcome: T, ...audits: AuditEntry[]): Rejected<T> {
  return { [REJECTED]: true, outcome, audits };
}

export function isRejected(value: unknown): value is Rejected<unknown> {
  return typeof value === 'object' && value != null && REJECTED in value;
}

/** 打开一个事务，在其中执行 body。body 抛错则整体回滚。 */
export type OpenTransaction<C> = (body: (tx: C) => Promise<unknown>) => Promise<unknown>;

class RollbackSignal extends Error {
  constructor() {
    super('业务拒绝，回滚本事务');
    this.name = 'RollbackSignal';
  }
}

/**
 * 在一个事务里执行 work，业务行与留痕同成同败。
 * - work 正常返回：提交。
 * - work 抛错（含留痕写入失败）：回滚，错误原样抛出。
 * - work 返回 rejected(...)：回滚，再另起一个事务写拒绝类留痕，返回 outcome。
 * 本函数必须是最外层事务。open 不得复用外层事务，否则拒绝留痕会随外层一起回滚。
 */
export async function runAuditedTransaction<C, T>(
  open: OpenTransaction<C>,
  clientOf: (tx: C) => unknown,
  factory: AuditTrailFactory,
  work: (tx: C, audit: AuditTrailPort) => Promise<T | Rejected<T>>,
): Promise<T> {
  let rejection: Rejected<T> | undefined;
  try {
    return (await open(async (tx) => {
      const result = await work(tx, factory.forClient(clientOf(tx)));
      if (isRejected(result)) {
        rejection = result as Rejected<T>;
        throw new RollbackSignal();
      }
      return result;
    })) as T;
  } catch (error) {
    if (!(error instanceof RollbackSignal) || rejection === undefined) throw error;
  }
  const { outcome, audits } = rejection;
  if (audits.length > 0) {
    await open(async (tx) => {
      const audit = factory.forClient(clientOf(tx));
      for (const entry of audits) await audit.append(entry);
    });
  }
  return outcome;
}
