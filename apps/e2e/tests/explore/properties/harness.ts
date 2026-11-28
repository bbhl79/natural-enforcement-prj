// P0 属性探索 harness（#107）：fast-check 引擎与 Playwright 探索轨道的胶水层。
//
// 引擎用法沿用原型实证（prototype/e2e-dualtrack charter-create-input-space）：
// fast-check 在 Playwright 用例内运行（非 @fast-check/vitest）；fc.check 返回
// 结构化 RunDetails（seed / 收缩后反例 / counterexamplePath / numShrinks），
// 违规时以附件写入 results.json，供 report（#109）机械提取登记与反例重放。
//
// 属性命名 ↔ charter 联动口径（#107 预留；charter 认领机制归 #114）：
// - property 全名：`P0/<RULE-ID>/<slug>`——P0=引擎阶段（Spec-e2e §14），
//   RULE-ID=业务规则标识（EV-STATE/EV-NAME/EV-BYTES/PT-GEO/PT-BOUND/PT-NAME；
//   GAP-*=规则缺席探针，FORCE-*=验收夹具，SELF-*=harness 自检），slug=可读短名。
// - rule：RULE-ID，report 归因与 charter 选题的稳定锚点。
// - charter：探索任务书联动预留位——#114 落地认领后填所认领 charter 的标识；
//   当前为规则分组 slug（占位），finding 载荷原样携带以便后续机械回填。
//
// 违规产物（Spec-e2e §4 reproducibility kind=property/seed 的消费面）：
//   results.json → 该用例 results[].attachments[]，name=property-finding，
//   body=base64(JSON PropertyFinding)。提取示例：
//   jq -r '.. | objects | select(.name? == "property-finding") | .body' results.json | base64 -d
//   绿跑时每个属性用例另带 name=property-run 摘要附件（seed/numRuns，审计与重放域复现）。
import fc from 'fast-check'
import type { IAsyncProperty, RunDetails } from 'fast-check'
import type { TestInfo } from '@playwright/test'

export const PROPERTY_FINDING_ATTACHMENT = 'property-finding'
export const PROPERTY_RUN_ATTACHMENT = 'property-run'

export interface PropertyRef {
  /** 属性全名：P0/<RULE-ID>/<slug> */
  readonly property: string
  /** 业务规则标识（RULE-ID） */
  readonly rule: string
  /** charter 联动预留位（认领机制归 #114；当前为规则分组 slug） */
  readonly charter: string
}

/** 机械转写友好的失败请求描述（#110 转写模板消费；二进制上传用 bodyBase64） */
export interface PropertyFindingRequest {
  readonly method: 'get' | 'post' | 'put' | 'patch' | 'delete'
  readonly path: string
  readonly headers?: Readonly<Record<string, string>>
  readonly body?: unknown
  readonly bodyBase64?: string
}

/** 结构化违规产物（写入 results.json 附件；report 登记与毕业反例重放的消费面） */
export interface PropertyFinding {
  readonly schemaVersion: 1
  readonly engine: 'fast-check'
  readonly property: string
  readonly rule: string
  readonly charter: string
  readonly seed: number
  /** 收缩后的最小反例（fc.check counterexample，JSON 可序列化域） */
  readonly counterexample: unknown
  readonly counterexamplePath: string | null
  readonly numRuns: number
  readonly numShrinks: number
  readonly request?: PropertyFindingRequest
}

/** fc.check 失败详情中归因所需的最小结构（RunDetails 失败分支的结构子集） */
export interface FailureDetails {
  readonly seed: number
  readonly counterexample: unknown
  readonly counterexamplePath: string | null
  readonly numRuns: number
  readonly numShrinks: number
}

/** 纯函数：归因载荷构造（无损保留 seed/反例/标识；harness 自检覆盖） */
export function buildPropertyFinding(
  ref: PropertyRef,
  details: FailureDetails,
  request?: PropertyFindingRequest,
): PropertyFinding {
  return {
    schemaVersion: 1,
    engine: 'fast-check',
    property: ref.property,
    rule: ref.rule,
    charter: ref.charter,
    seed: details.seed,
    counterexample: details.counterexample,
    counterexamplePath: details.counterexamplePath,
    numRuns: details.numRuns,
    numShrinks: details.numShrinks,
    ...(request === undefined ? {} : { request }),
  }
}

export interface RunPropertyOptions {
  readonly numRuns?: number
  /** 固定 seed（验收夹具/重放用）；缺省由 fast-check 随机取并记录进产物 */
  readonly seed?: number
  /** 从收缩反例导出失败请求（API 级属性；机械转写友好） */
  readonly requestOf?: (counterexample: unknown) => PropertyFindingRequest | undefined
}

/**
 * 运行一条属性并收口探索语义：
 * - 通过 → 附 property-run 摘要（seed/numRuns），返回 RunDetails；
 * - 违反 → 附 property-finding 结构化反例，再抛错使用例失败
 *   （探索轨道 retries=0，失败=产出 → devenv explore exit 4 + 产物路径）。
 * 反例域必须 JSON 可序列化（base64 字节/码点字符串），保证附件 body 无损。
 */
export async function runProperty<Ts extends unknown[]>(
  testInfo: TestInfo,
  ref: PropertyRef,
  property: IAsyncProperty<Ts>,
  options: RunPropertyOptions = {},
): Promise<RunDetails<Ts>> {
  const params: { numRuns: number; seed?: number } = { numRuns: options.numRuns ?? 25 }
  if (options.seed !== undefined) params.seed = options.seed
  const details = await fc.check(property, params)
  if (details.failed) {
    const request =
      details.counterexample === null ? undefined : options.requestOf?.(details.counterexample)
    const finding = buildPropertyFinding(ref, details, request)
    await testInfo.attach(PROPERTY_FINDING_ATTACHMENT, {
      body: JSON.stringify(finding),
      contentType: 'application/json',
    })
    const cause =
      details.errorInstance instanceof Error
        ? details.errorInstance.message
        : details.errorInstance === null
          ? ''
          : String(details.errorInstance)
    throw new Error(
      `属性违反 ${ref.property}：seed=${details.seed} 反例=${JSON.stringify(details.counterexample)}` +
        ` path=${details.counterexamplePath ?? '-'} shrinks=${details.numShrinks}` +
        (cause === '' ? '' : ` cause=${cause}`),
    )
  }
  await testInfo.attach(PROPERTY_RUN_ATTACHMENT, {
    body: JSON.stringify({
      schemaVersion: 1,
      engine: 'fast-check',
      property: ref.property,
      rule: ref.rule,
      charter: ref.charter,
      seed: details.seed,
      numRuns: details.numRuns,
      failed: false,
    }),
    contentType: 'application/json',
  })
  return details
}