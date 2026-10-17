/** 留痕写入注入令牌（ADR 0012）。业务侧只许经此令牌追加，不得碰留痕表。 */
export const AUDIT_TRAIL_PORT = Symbol('AUDIT_TRAIL_PORT');

/** 留痕工厂注入令牌（#119 接缝①）。按事务客户端取得写入接口，测试可覆写。 */
export const AUDIT_TRAIL_FACTORY = Symbol('AUDIT_TRAIL_FACTORY');
