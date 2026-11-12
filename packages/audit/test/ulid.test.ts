// 留痕编号（#16 §1.1 ULID / #114）。纯函数，无库。
//
// 生成器的实现统一收敛到契约包 packages/shield（身份模块、地理字典模块与种子通道共用
// 同一份）；本包只持本进程的一个生成器实例，故此处断言的是「留痕编号用的是同一个实例、
// 跨多次追加严格递增」这一包内语义。生成器自身的形制与单调规则见
// packages/shield/test/ulid.test.ts。
import { describe, expect, it } from 'vitest';

import { newAuditId } from '../src/ulid.ts';

const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

// 留痕编号生成器：同一进程连续生成严格递增，且符合 ULID 形制。
describe('留痕编号生成', () => {
  it('同一进程连续生成的编号严格递增且合 ULID 形制', () => {
    const ids = Array.from({ length: 10_000 }, () => newAuditId(Date.now()));
    expect(ids.every((id) => ULID.test(id))).toBe(true);
    expect(ids.every((id, i) => i === 0 || ids[i - 1]! < id)).toBe(true);
  });
});
