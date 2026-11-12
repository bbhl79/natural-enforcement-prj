// 用途：声明 ancient-peer-age.cjs 的导出类型，供 TypeScript 探针调用。
/** 按 365.25 天一年把毫秒差换算成年数。 */
export function ageYears(instantMs: number, nowMs: number): number;
/** 判断时间点是否不早于 minYears 年；非有限值返回 false。 */
export function isAncient(instantMs: number, nowMs: number, minYears: number): boolean;
/** 查重接口把登记时间收成 UTC 日或月。无法识别时返回 null。 */
export function parseRegisteredAt(text: string): number | null;
