import { describe, expect, it } from 'vitest'

// #71 CI 普通失败取证探针（一次性分支，不合入、不合 dev）：受控制造一次
// 集成测试失败——verify（无服务）仍应全绿，失败发生在起栈之后的 test 段，
// 用以验证「普通失败先取证（!cancelled()）再拆栈（always()）」与取证产物
// 完整性（服务日志/状态/ps 在失败现场被留存）。探针唯一使命：按预期失败。
describe('#71 CI 失败取证探针', () => {
  it('受控失败：断言故意不成立', () => {
    expect('probe').toBe('expected-to-fail')
  })
})
