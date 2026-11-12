import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  SOURCE_GATE_ALLOWED_SOURCES_ENV,
  SOURCE_GATE_DEPLOYMENT_ENV,
  SourceGate,
  resolveSourceGateAllowlist,
  sourceGateForProcess,
} from './source-gate.ts';

const manifestPath = fileURLToPath(new URL('../../../infra/runtime.env', import.meta.url));
const composePath = fileURLToPath(new URL('../../../infra/docker-compose.yml', import.meta.url));

const NOW = new Date('2026-11-07T12:00:00.000Z');
const HARNESS = '203.0.113.10';
const OTHER = '203.0.113.11';

function fill(gate: SourceGate, ip: string): void {
  for (let i = 0; i < 10; i += 1) gate.record(ip, NOW);
}

// 来源地址闸的允许名单与计数规则（#317）。
describe('来源地址闸允许名单', () => {
  it('未注入名单时，第十次失败记下拒绝，下一次拒绝', () => {
    const gate = new SourceGate();
    for (let i = 0; i < 9; i += 1) gate.record(HARNESS, NOW);
    expect(gate.blocked(HARNESS, NOW)).toBe(false);
    gate.record(HARNESS, NOW);
    expect(gate.blocked(HARNESS, NOW)).toBe(true);
  });

  it('dev 档名单内地址记满后仍不拒绝，名单外地址仍拒绝', () => {
    const gate = sourceGateForProcess({
      NODE_ENV: 'development',
      [SOURCE_GATE_DEPLOYMENT_ENV]: 'dev',
      [SOURCE_GATE_ALLOWED_SOURCES_ENV]: ` ${HARNESS}, 2001:db8::10 `,
    });
    fill(gate, HARNESS);
    fill(gate, '2001:db8::10');
    fill(gate, OTHER);
    expect(gate.blocked(HARNESS, NOW)).toBe(false);
    expect(gate.blocked('2001:db8::10', NOW)).toBe(false);
    expect(gate.blocked(OTHER, NOW)).toBe(true);
  });

  it('verify 档同样放行名单内地址', () => {
    const gate = sourceGateForProcess({
      [SOURCE_GATE_DEPLOYMENT_ENV]: ' verify ',
      [SOURCE_GATE_ALLOWED_SOURCES_ENV]: HARNESS,
    });
    fill(gate, HARNESS);
    expect(gate.blocked(HARNESS, NOW)).toBe(false);
  });

  it('NODE_ENV=production 时忽略 verify 档与名单，闸维持原规则', () => {
    const env = {
      NODE_ENV: ' production ',
      [SOURCE_GATE_DEPLOYMENT_ENV]: 'verify',
      [SOURCE_GATE_ALLOWED_SOURCES_ENV]: HARNESS,
    };
    expect(resolveSourceGateAllowlist(env).size).toBe(0);
    const gate = sourceGateForProcess(env);
    fill(gate, HARNESS);
    expect(gate.blocked(HARNESS, NOW)).toBe(true);
  });

  it('未设部署档时名单不生效', () => {
    const gate = sourceGateForProcess({
      [SOURCE_GATE_ALLOWED_SOURCES_ENV]: HARNESS,
    });
    fill(gate, HARNESS);
    expect(gate.blocked(HARNESS, NOW)).toBe(true);
  });

  it('部署档不是 dev 或 verify 时名单不生效', () => {
    const gate = sourceGateForProcess({
      [SOURCE_GATE_DEPLOYMENT_ENV]: 'staging',
      [SOURCE_GATE_ALLOWED_SOURCES_ENV]: HARNESS,
    });
    fill(gate, HARNESS);
    expect(gate.blocked(HARNESS, NOW)).toBe(true);
  });

  it('空名单、空白或星号都不放行其他地址', () => {
    for (const list of ['', '   ', '*', ' , ']) {
      const gate = sourceGateForProcess({
        [SOURCE_GATE_DEPLOYMENT_ENV]: 'verify',
        [SOURCE_GATE_ALLOWED_SOURCES_ENV]: list,
      });
      fill(gate, HARNESS);
      expect(gate.blocked(HARNESS, NOW)).toBe(true);
    }
  });

  it('空来源地址仍然不拒绝', () => {
    const gate = sourceGateForProcess({
      [SOURCE_GATE_DEPLOYMENT_ENV]: 'dev',
      [SOURCE_GATE_ALLOWED_SOURCES_ENV]: HARNESS,
    });
    expect(gate.blocked(null, NOW)).toBe(false);
    expect(gate.blocked('', NOW)).toBe(false);
    gate.record(null, NOW);
    gate.record('', NOW);
    expect(gate.blocked(null, NOW)).toBe(false);
  });

  it('运行参数清单默认空，compose 以空值把两个名字送进 server', () => {
    const manifest = readFileSync(manifestPath, 'utf8');
    const compose = readFileSync(composePath, 'utf8');
    expect(manifest).toMatch(new RegExp(`^${SOURCE_GATE_DEPLOYMENT_ENV}=$`, 'm'));
    expect(manifest).toMatch(new RegExp(`^${SOURCE_GATE_ALLOWED_SOURCES_ENV}=$`, 'm'));
    expect(compose).toContain(`\${${SOURCE_GATE_DEPLOYMENT_ENV}:-}`);
    expect(compose).toContain(`\${${SOURCE_GATE_ALLOWED_SOURCES_ENV}:-}`);
  });
});
