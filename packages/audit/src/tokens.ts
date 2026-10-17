/** 留痕写入注入令牌（ADR 0012）。业务侧只许经此令牌追加，不得碰留痕表。 */
export const AUDIT_TRAIL_PORT = Symbol('AUDIT_TRAIL_PORT');
