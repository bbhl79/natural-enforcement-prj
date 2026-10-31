import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import PasswordStrength, { evaluatePasswordStrength, PUBLIC_PASSWORD_RULES } from './PasswordStrength';

describe('口令强度（#292）', () => {
  it('公开规则未全过为弱，且 passed=false', () => {
    const result = evaluatePasswordStrength({ password: 'short' });
    expect(result.level).toBe('weak');
    expect(result.passed).toBe(false);
    expect(result.failedRules).toContain('too-short');
    expect(result.failedRules).toContain('insufficient-classes');
  });

  it('全过且仅 3 类为中', () => {
    const result = evaluatePasswordStrength({ password: 'Abc9x7y5z2' });
    expect(result.classCount).toBe(3);
    expect(result.level).toBe('medium');
    expect(result.passed).toBe(true);
    expect(result.failedRules).toEqual([]);
  });

  it('全过且 4 类为强', () => {
    const result = evaluatePasswordStrength({ password: 'Abc9x7y5z2!' });
    expect(result.classCount).toBe(4);
    expect(result.level).toBe('strong');
    expect(result.passed).toBe(true);
  });

  it('全过且长度达到 14 位为强', () => {
    const result = evaluatePasswordStrength({ password: 'Abc9x7y5z2q4w6' });
    expect(result.classCount).toBe(3);
    expect(result.level).toBe('strong');
    expect(result.passed).toBe(true);
  });

  it('长度阈值 10 与 64', () => {
    expect(evaluatePasswordStrength({ password: 'Abc9x7y5z' }).failedRules).toContain('too-short');
    expect(evaluatePasswordStrength({ password: 'Abc9x7y5z2' }).failedRules).not.toContain('too-short');
    expect(evaluatePasswordStrength({ password: 'Aa1!'.repeat(16) }).failedRules).not.toContain('too-long');
    expect(evaluatePasswordStrength({ password: `${'Aa1!'.repeat(16)}x` }).failedRules).toContain('too-long');
  });

  it('连续字符、重复字符、常见弱口令与工号命中均判弱', () => {
    const sequential = evaluatePasswordStrength({ password: 'Abcd9x7y5z2' });
    expect(sequential.failedRules).toContain('sequential');
    expect(sequential.level).toBe('weak');
    const repeated = evaluatePasswordStrength({ password: 'Aaaaa9x7y5z2' });
    expect(repeated.failedRules).toContain('repeated');
    expect(repeated.level).toBe('weak');
    const common = evaluatePasswordStrength({ password: 'P@ssw0rd1' });
    expect(common.failedRules).toContain('common');
    expect(common.level).toBe('weak');
    const containsCode = evaluatePasswordStrength({
      password: 'Abc9x7y5z2P-UNIT-1',
      personnelCode: 'P-UNIT-1',
    });
    expect(containsCode.failedRules).toContain('contains-code');
    expect(containsCode.level).toBe('weak');
  });

  it('提供当前口令时本地可查 same-as-current', () => {
    const result = evaluatePasswordStrength({
      password: 'Abc9x7y5z2!',
      currentPassword: 'Abc9x7y5z2!',
    });
    expect(result.failedRules).toEqual(['same-as-current']);
    expect(result.passed).toBe(false);
  });

  it('强度条与公开规则勾选清单齐全', () => {
    const html = renderToStaticMarkup(createElement(PasswordStrength, { password: 'Abc9x7y5z2!' }));
    expect(html).toContain('data-level="strong"');
    expect(html).toContain('口令强度');
    for (const rule of PUBLIC_PASSWORD_RULES) {
      expect(html).toContain(`data-rule="${rule}"`);
    }
    expect(html.match(/data-rule="[a-z-]+" data-passed="true"/g) ?? []).toHaveLength(PUBLIC_PASSWORD_RULES.length);
    expect(html).not.toMatch(/#[0-9]{2,4}/);
  });
});