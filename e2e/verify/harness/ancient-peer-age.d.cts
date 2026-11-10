export function ageYears(instantMs: number, nowMs: number): number;
export function isAncient(instantMs: number, nowMs: number, minYears: number): boolean;
/** 查重接口把登记时间收成 UTC 日或月。无法识别时返回 null。 */
export function parseRegisteredAt(text: string): number | null;
