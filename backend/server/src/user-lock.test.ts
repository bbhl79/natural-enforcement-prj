import { describe, it } from 'vitest';

// 锁清单断言登记（docs/user-lock.md，原文出处 #111）。
// 结构测试 user-lock-assertions 按断言编号核对：锁清单里的每个编号，测试代码里必须有对应断言或「待实现」登记。
// 尚无承载模块的条目登记为「待实现」（it.todo）。
// 承载该条的切片 PR 在承载模块的测试里写真断言（标题以断言编号开头），并删掉这里的登记。
describe('USER LOCK 断言登记', () => {
  it.todo('USER-LOCK-L1 听证申请期：待实现');
  it.todo('USER-LOCK-L2 线索分派前自动核查：待实现');
  it.todo('USER-LOCK-L3 应听证不得自免：待实现');
  it.todo('USER-LOCK-L4 037：待实现');
  it.todo('USER-LOCK-L5 超十日：待实现');
});
