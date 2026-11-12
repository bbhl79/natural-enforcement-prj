// 用途：集成测试共用的 ULID 生成器出口，主键算法只在 identity 一处维护。
// 集成层共用的技术主键生成（#16 §1.1：ULID = 48bit 毫秒时间 + 80bit 随机，26 位大写 Crockford Base32）。
//
// 收敛自 22 个测试文件各自复制的本地实现：算法与 identity 公共出口的 newUlid 逐项等价
// （同 Crockford 字符集、同 48bit 毫秒时间部、同 80bit 随机部、同形制自检），差别只在
// 写法与是否带自检。生成器本体只在 identity 一处维护，本文件只做再出口。
//
// integration 层按 #47 验收矩阵做跨模块装配：直接引各模块 src 深路径是设计而非违规
// （豁免只覆盖 module-public-entry 一问，名单见 tools/structural-test.sh 的 ASSEMBLY_EXEMPT）。
// 本文件因此需要一条 ASSEMBLY_EXEMPT 记录；引它的测试文件走 './ulid-helpers.ts' 同目录
// 相对导入，不触发该规则。
/**
 * 再出口 identity 的 ULID 生成器，供集成测试构造技术主键。
 * 调用方：integration 下各测试文件，例如 integration/login-lock.test.ts。
 */
export { newUlid } from '../backend/identity/src/index.ts';
