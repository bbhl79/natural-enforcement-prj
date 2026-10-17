import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { MissingRuntimeEnvError, readRequiredEnv, SERVER_REQUIRED_ENV } from './runtime-env.ts';

const manifestPath = fileURLToPath(new URL('../../../infra/runtime.env', import.meta.url));

describe('启动包必填环境变量', () => {
  it('缺必填项时抛错，并说明缺哪一项', () => {
    expect(() => readRequiredEnv({}, SERVER_REQUIRED_ENV)).toThrowError(
      /缺少必填环境变量 DATABASE_URL/,
    );
  });

  it('空串按缺项处理，一次列出全部缺项', () => {
    try {
      readRequiredEnv({ A: '', C: 'x' }, ['A', 'B', 'C'] as const);
      expect.unreachable('应当抛错');
    } catch (error) {
      expect(error).toBeInstanceOf(MissingRuntimeEnvError);
      expect((error as MissingRuntimeEnvError).missing).toEqual(['A', 'B']);
      expect((error as Error).message).toContain('A、B');
    }
  });

  it('齐全时原样返回', () => {
    expect(readRequiredEnv({ DATABASE_URL: 'postgresql://u@h/d' }, SERVER_REQUIRED_ENV)).toEqual({
      DATABASE_URL: 'postgresql://u@h/d',
    });
  });

  it('必填项都登记在运行参数清单里', () => {
    const manifest = readFileSync(manifestPath, 'utf8');
    for (const name of SERVER_REQUIRED_ENV) {
      expect(manifest).toMatch(new RegExp(`^(# @derived required ${name} |${name}=)`, 'm'));
    }
  });
});
