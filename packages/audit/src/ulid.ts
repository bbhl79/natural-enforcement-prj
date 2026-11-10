// 留痕编号生成器（#16 §1.1 ULID / #114）：实现统一收敛到契约包 packages/shield
// （身份模块、地理字典模块与种子通道共用同一份），本文件只持本进程的一个生成器实例。
// 留痕包不依赖身份模块（避免与授权写入形成循环），改依赖无任何依赖的契约包。
import { createMonotonicUlidGenerator } from '@natural-enforcement/shield';

/** 本进程的留痕编号。同一进程内严格递增。 */
export const newAuditId = createMonotonicUlidGenerator();
