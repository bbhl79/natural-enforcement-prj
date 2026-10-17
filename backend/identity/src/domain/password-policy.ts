// 口令策略（#97）。阈值硬编码。两处入口共用：本人改密、系统管理重设。
export const PASSWORD_RULES = [
  'too-short',
  'too-long',
  'insufficient-classes',
  'sequential',
  'repeated',
  'common',
  'contains-code',
  'same-as-current',
] as const;

export type PasswordRuleCode = (typeof PASSWORD_RULES)[number];

export interface PasswordCheck {
  password: string;
  personnelCode: string;
  /** 本人改密时传入当前口令。不传则不检查是否相同。 */
  currentPassword?: string;
}

const MIN_LENGTH = 10;
const MAX_LENGTH = 64;
const MIN_CLASSES = 3;

/** 整段相等才算常见弱口令，比较时不区分大小写。 */
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

/** 4 位及以上升序或降序的数字，或字母（不区分大小写）。 */
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

export function rejectedPasswordRules(input: PasswordCheck): PasswordRuleCode[] {
  const rules: PasswordRuleCode[] = [];
  if (input.password.length < MIN_LENGTH) rules.push('too-short');
  if (input.password.length > MAX_LENGTH) rules.push('too-long');
  if (classCount(input.password) < MIN_CLASSES) rules.push('insufficient-classes');
  if (hasSequential(input.password)) rules.push('sequential');
  if (hasRepeated(input.password)) rules.push('repeated');
  if (COMMON_PASSWORDS.has(input.password.toLowerCase())) rules.push('common');
  if (
    input.personnelCode !== ''
    && input.password.toLowerCase().includes(input.personnelCode.toLowerCase())
  ) {
    rules.push('contains-code');
  }
  if (input.currentPassword !== undefined && input.password === input.currentPassword) {
    rules.push('same-as-current');
  }
  return rules;
}
