// 用途：解析规则确认请求体，构造确认类响应体，并追加 case.rule-confirmed 留痕。
// #258：确认留痕只追加。确认人、时间、步骤、规则键与当时的 warnings 快照写在 detail。

import type { AuditParties, AuditTrailPort } from '@natural-enforcement/audit';
import type { RuleConfirmation } from '@natural-enforcement/case';

/** 规整请求体里的确认规则键与逐键理由；空串与非字符串项丢弃。调用方：各案件控制器的请求解析。 */
export function readConfirmation(body: {
  readonly confirmedRuleKeys?: unknown;
  readonly confirmReasons?: unknown;
} | null | undefined): {
  readonly confirmedRuleKeys: readonly string[];
  readonly confirmReasons: Readonly<Record<string, string>>;
} {
  const confirmedRuleKeys = Array.isArray(body?.confirmedRuleKeys)
    ? body.confirmedRuleKeys
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => item !== '')
    : [];
  const confirmReasons: Record<string, string> = {};
  const raw = body?.confirmReasons;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === 'string' && key.trim() !== '') confirmReasons[key.trim()] = value;
    }
  }
  return { confirmedRuleKeys, confirmReasons };
}

/** 构造规则确认接口的 warnings 响应体；调用方：backend/server/src/case-decision.service.ts 等处理服务。 */
export function warningBody(warnings: RuleConfirmation['warnings']): {
  readonly result: 'warnings';
  readonly warnings: RuleConfirmation['warnings'];
} {
  return { result: 'warnings', warnings };
}

/** 构造规则确认接口的 non-compliant 响应体，附未满足的规则键与原因码。 */
export function ruleKeyBody(decision: {
  readonly reason: string;
  readonly message: string;
  readonly ruleKey: string;
}): {
  readonly result: 'non-compliant';
  readonly reason: string;
  readonly message: string;
  readonly ruleKey: string;
} {
  return { result: 'non-compliant', reason: decision.reason, message: decision.message, ruleKey: decision.ruleKey };
}

/**
 * 追加一条 case.rule-confirmed 留痕，detail 记录确认人、时间、步骤、规则键、warnings 快照与逐键理由。
 * 只追加，不修改既有留痕；在调用方事务内执行。
 * 调用方：backend/server/src/case-state.service.ts、case-filing.service.ts、investigation.service.ts 等。
 */
export async function appendRuleConfirmation(
  audit: AuditTrailPort,
  input: {
    readonly parties: AuditParties;
    readonly confirmation: RuleConfirmation;
    readonly at: Date;
    readonly step: string;
    readonly confirmReasons?: Readonly<Record<string, string>>;
  },
): Promise<void> {
  const reasons: Record<string, string> = {};
  for (const ref of input.confirmation.ruleKeys) {
    const text = input.confirmReasons?.[ref.ruleKey];
    if (typeof text === 'string' && text.trim() !== '') reasons[ref.ruleKey] = text.trim();
  }
  await audit.append({
    action: 'case.rule-confirmed',
    ...input.parties,
    detail: JSON.stringify({
      confirmerId: input.parties.actorId,
      at: input.at.toISOString(),
      step: input.step,
      ruleKeys: input.confirmation.ruleKeys,
      warnings: input.confirmation.warnings,
      reasons,
    }),
  });
}
