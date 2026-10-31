// 口令强度与公开规则清单（#292）：前端复刻本机校验口径，与后端 password-policy 对齐。
// 历史比对只在提交后由服务端揭示（ADR 0015），这里不做任何历史判断。
import { PASSWORD_HISTORY_HINT, PASSWORD_RULE_TEXT } from './loginSlice';

export const PUBLIC_PASSWORD_RULES = [
  'too-short',
  'too-long',
  'insufficient-classes',
  'sequential',
  'repeated',
  'common',
  'contains-code',
] as const;

export type PublicPasswordRule = (typeof PUBLIC_PASSWORD_RULES)[number];
export type PasswordStrengthLevel = 'weak' | 'medium' | 'strong';

export interface PasswordStrengthResult {
  level: PasswordStrengthLevel;
  passed: boolean;
  failedRules: Array<PublicPasswordRule | 'same-as-current'>;
  classCount: number;
}

const MIN_LENGTH = 10;
const MAX_LENGTH = 64;
const MIN_CLASSES = 3;

const COMMON_PASSWORDS = new Set([
  '123456',
  '12345678',
  '123456789',
  '1234567890',
  '1234',
  'password',
  'password1',
  'password123',
  'password1!',
  'qwerty',
  'qwerty123',
  'qwerty123!',
  '111111',
  '000000',
  'abc123',
  'iloveyou',
  'iloveyou1!',
  'admin',
  'admin123',
  'admin123!',
  'admin123456',
  'root123',
  'passw0rd',
  'passw0rd!',
  'p@ssw0rd',
  'p@ssw0rd1',
  'p@ssword',
  'changeme',
  'changeme1!',
  'welcome',
  'welcome1',
  'welcome1!',
  'letmein',
  'aaaa',
]);

function classCount(password: string): number {
  let upper = false;
  let lower = false;
  let digit = false;
  let special = false;
  for (const char of password) {
    if (char >= 'A' && char <= 'Z') upper = true;
    else if (char >= 'a' && char <= 'z') lower = true;
    else if (char >= '0' && char <= '9') digit = true;
    else special = true;
  }
  return Number(upper) + Number(lower) + Number(digit) + Number(special);
}

function isStep(codes: number[]): boolean {
  let ascending = true;
  let descending = true;
  for (let index = 1; index < codes.length; index += 1) {
    const previous = codes[index - 1] ?? 0;
    const current = codes[index] ?? 0;
    if (current - previous !== 1) ascending = false;
    if (previous - current !== 1) descending = false;
  }
  return ascending || descending;
}

function hasSequential(password: string): boolean {
  const chars = Array.from(password);
  for (let index = 0; index <= chars.length - 4; index += 1) {
    const window = chars.slice(index, index + 4);
    if (window.every((char) => char >= '0' && char <= '9')) {
      if (isStep(window.map((char) => char.charCodeAt(0)))) return true;
    }
    if (window.every((char) => (char >= 'A' && char <= 'Z') || (char >= 'a' && char <= 'z'))) {
      if (isStep(window.map((char) => char.toLowerCase().charCodeAt(0)))) return true;
    }
  }
  return false;
}

function hasRepeated(password: string): boolean {
  const chars = Array.from(password);
  let run = 1;
  for (let index = 1; index < chars.length; index += 1) {
    if (chars[index] === chars[index - 1]) {
      run += 1;
      if (run >= 4) return true;
    } else {
      run = 1;
    }
  }
  return false;
}

/** 与后端 rejectedPasswordRules 同一口径；personnelCode、currentPassword 未提供时不检查对应项。 */
export function evaluatePasswordStrength(input: {
  password: string;
  personnelCode?: string;
  currentPassword?: string;
}): PasswordStrengthResult {
  const { password } = input;
  const failedRules: Array<PublicPasswordRule | 'same-as-current'> = [];
  if (password.length < MIN_LENGTH) failedRules.push('too-short');
  if (password.length > MAX_LENGTH) failedRules.push('too-long');
  const count = classCount(password);
  if (count < MIN_CLASSES) failedRules.push('insufficient-classes');
  if (hasSequential(password)) failedRules.push('sequential');
  if (hasRepeated(password)) failedRules.push('repeated');
  if (COMMON_PASSWORDS.has(password.toLowerCase())) failedRules.push('common');
  const personnelCode = input.personnelCode ?? '';
  if (personnelCode !== '' && password.toLowerCase().includes(personnelCode.toLowerCase())) {
    failedRules.push('contains-code');
  }
  if (input.currentPassword !== undefined && password === input.currentPassword) {
    failedRules.push('same-as-current');
  }
  const publicFailed = failedRules.some((rule) => rule !== 'same-as-current');
  const level: PasswordStrengthLevel = publicFailed
    ? 'weak'
    : count >= 4 || password.length >= 14
      ? 'strong'
      : 'medium';
  return { level, passed: failedRules.length === 0, failedRules, classCount: count };
}

const LEVEL_LABEL: Record<PasswordStrengthLevel, string> = {
  weak: '弱',
  medium: '中',
  strong: '强',
};

const LEVEL_ORDER: PasswordStrengthLevel[] = ['weak', 'medium', 'strong'];

/** 弱／中／强三段条 + 公开规则勾选清单。 */
export default function PasswordStrength({
  password,
  personnelCode,
  currentPassword,
}: {
  password: string;
  personnelCode?: string;
  currentPassword?: string;
}) {
  const result = evaluatePasswordStrength({ password, personnelCode, currentPassword });
  const reached = LEVEL_ORDER.indexOf(result.level);
  return (
    <div
      className="pw-strength"
      data-level={result.level}
      data-passed={result.passed ? 'true' : 'false'}
      style={{ marginBottom: 12 }}
    >
      <div className="pw-strength-head">
        <span>口令强度</span>
        <strong aria-live="polite">{LEVEL_LABEL[result.level]}</strong>
      </div>
      <div className="pw-strength-bar" role="img" aria-label={`口令强度：${LEVEL_LABEL[result.level]}`}>
        {LEVEL_ORDER.map((level, index) => (
          <span
            key={level}
            data-level={level}
            className={index <= reached ? `on ${level}` : ''}
          />
        ))}
      </div>
      <ul className="pw-rules" aria-label="口令规则">
        {PUBLIC_PASSWORD_RULES.map((rule) => {
          const passed = !result.failedRules.includes(rule);
          return (
            <li
              key={rule}
              role="checkbox"
              aria-checked={passed}
              aria-readonly="true"
              data-rule={rule}
              data-passed={passed ? 'true' : 'false'}
              className={passed ? 'pass' : 'fail'}
            >
              <span aria-hidden="true">{passed ? '✓' : '○'}</span>
              {PASSWORD_RULE_TEXT[rule]}
            </li>
          );
        })}
      </ul>
      {result.failedRules.includes('same-as-current') ? (
        <div className="err" role="status">{PASSWORD_RULE_TEXT['same-as-current']}</div>
      ) : null}
    </div>
  );
}

/** 提交后的服务端反馈：历史命中只出单句，其余规则列清单，没有拒绝时常驻历史提示。 */
export function PasswordRuleFeedback({ ruleCodes }: { ruleCodes: readonly string[] }) {
  if (ruleCodes.includes('reused')) {
    return (
      <div className="err" data-reason="password-reused" style={{ marginBottom: 12 }}>
        {PASSWORD_RULE_TEXT.reused}
      </div>
    );
  }
  if (ruleCodes.length > 0) {
    return (
      <ul className="err" style={{ margin: '0 0 12px 18px' }}>
        {ruleCodes.map((code) => (
          <li key={code}>{PASSWORD_RULE_TEXT[code] ?? code}</li>
        ))}
      </ul>
    );
  }
  return <div className="help" style={{ marginBottom: 12 }}>{PASSWORD_HISTORY_HINT}</div>;
}