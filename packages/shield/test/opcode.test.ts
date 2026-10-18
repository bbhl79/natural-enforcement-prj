// 操作码名册（#71 决议的独立字面）。期望不从实现推导。
import { describe, expect, it } from 'vitest';

import {
  OPCODES,
  effectiveOpcodeRequirements,
  opcodeRequirements,
} from '../src/index.js';

const CASE_OPCODES = [
  'clue.org.assign',
  'clue.handler.assign',
  'clue.verify.start',
  'case.open',
  'doc.draft',
  'doc.submit',
  'case.reassign.submit',
  'legal.review.request',
  'legal.opinion.draft',
  'legal.opinion.submit',
  'doc.admin.review',
  'doc.approve',
  'clue.read',
  'case.read',
  'doc.read',
  'clue.export',
  'case.export',
  'doc.export',
] as const;

const ADMIN_OPCODES = [
  ...['template', 'rule', 'calendar', 'metric'].flatMap((object) =>
    ['submit', 'approve', 'void', 'withdraw', 'read'].map((action) => `cfg.${object}.${action}`),
  ),
  'org.tree.read',
  'org.unit.register',
  'org.unit.rename',
  'org.unit.deactivate',
  'personnel.profile.read',
  'personnel.profile.register',
  'personnel.cert.update',
  'personnel.profile.update',
  'personnel.profile.deactivate',
  'personnel.profile.restore',
  'personnel.sessions.end',
  'personnel.locked.read',
  'personnel.locked.release',
  'personnel.password.reset',
  'personnel.profile.export',
  'audit.admin.read',
  'audit.admin.export',
  'authz.binding.submit',
  'authz.binding.approve',
] as const;

describe('操作码名册', () => {
  it('覆盖决议表里的办案操作码和管理台操作码', () => {
    expect([...OPCODES].sort()).toEqual([...CASE_OPCODES, ...ADMIN_OPCODES].sort());
  });

  it('人员导出不要求执法资格，不必是主办人，不改变主状态', () => {
    expect(opcodeRequirements('personnel.profile.export')).toEqual({
      qualification: 'none',
      mustBeCaseHandler: false,
      changesPrimaryState: false,
    });
  });

  it('名册外的字符串没有要求', () => {
    expect(opcodeRequirements('menu.visible')).toBeNull();
    expect(effectiveOpcodeRequirements('menu.visible', ['经办'])).toBeNull();
  });

  it('继承属性名不算名册内操作码', () => {
    for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
      expect(opcodeRequirements(name)).toBeNull();
      expect(effectiveOpcodeRequirements(name, ['经办'])).toBeNull();
      expect(OPCODES).not.toContain(name);
    }
    expect(effectiveOpcodeRequirements('case.read', ['constructor', 'toString'])).toEqual(
      opcodeRequirements('case.read'),
    );
  });

  it('启动核查查操作的人，并且必须是主办人或协办人，并且改变主状态', () => {
    expect(opcodeRequirements('clue.verify.start')).toEqual({
      qualification: 'operator',
      mustBeCaseHandler: true,
      changesPrimaryState: true,
    });
  });

  it('指定主办人只查被指定的人', () => {
    expect(opcodeRequirements('clue.handler.assign')).toEqual({
      qualification: 'assignee',
      mustBeCaseHandler: false,
      changesPrimaryState: true,
    });
  });

  it('机构树四码（#123、#124）不要求执法资格，不必是主办人，不改变主状态', () => {
    for (const opcode of ['org.tree.read', 'org.unit.register', 'org.unit.rename', 'org.unit.deactivate']) {
      expect(opcodeRequirements(opcode), opcode).toEqual({
        qualification: 'none',
        mustBeCaseHandler: false,
        changesPrimaryState: false,
      });
    }
  });

  it('人员登记与查看两码（#128）不要求执法资格，不必是主办人，不改变主状态', () => {
    for (const opcode of ['personnel.profile.read', 'personnel.profile.register']) {
      expect(opcodeRequirements(opcode), opcode).toEqual({
        qualification: 'none',
        mustBeCaseHandler: false,
        changesPrimaryState: false,
      });
    }
  });

  it('执法证登记码（#133）不要求执法资格，不必是主办人，不改变主状态', () => {
    expect(opcodeRequirements('personnel.cert.update')).toEqual({
      qualification: 'none',
      mustBeCaseHandler: false,
      changesPrimaryState: false,
    });
  });

  it('人员编辑与调岗码（#129）不要求执法资格，不必是主办人，不改变主状态', () => {
    expect(opcodeRequirements('personnel.profile.update')).toEqual({
      qualification: 'none',
      mustBeCaseHandler: false,
      changesPrimaryState: false,
    });
  });

  it('管理台操作码一律三段「域.对象.动作」（GLOSSARY:77，#105）', () => {
    const THREE_SEGMENTS = /^[a-z]+\.[a-z]+(?:-[a-z]+)*\.[a-z]+(?:-[a-z]+)*$/;
    for (const opcode of ADMIN_OPCODES) {
      expect(THREE_SEGMENTS.test(opcode), opcode).toBe(true);
    }
    expect(OPCODES.filter((opcode) => opcode.startsWith('personnel.')).every((opcode) => THREE_SEGMENTS.test(opcode))).toBe(true);
    for (const bad of ['personnel.register', 'personnel.profile', 'personnel.profile.read.all', 'Personnel.profile.read']) {
      expect(THREE_SEGMENTS.test(bad), bad).toBe(false);
    }
  });

  it('阅读不要求执法资格，不必是主办人，不改变主状态', () => {
    expect(opcodeRequirements('clue.read')).toEqual({
      qualification: 'none',
      mustBeCaseHandler: false,
      changesPrimaryState: false,
    });
  });

  it('立案改变主状态，拟制不改变主状态', () => {
    expect(opcodeRequirements('case.open')?.changesPrimaryState).toBe(true);
    expect(opcodeRequirements('doc.draft')?.changesPrimaryState).toBe(false);
    expect(opcodeRequirements('doc.approve')?.changesPrimaryState).toBe(true);
  });

  it('case.reassign.submit：经办必须是主办人或协办人，内勤不必是', () => {
    expect(effectiveOpcodeRequirements('case.reassign.submit', ['经办'])).toEqual({
      qualification: 'operator',
      mustBeCaseHandler: true,
      changesPrimaryState: false,
    });
    expect(effectiveOpcodeRequirements('case.reassign.submit', ['内勤'])).toEqual({
      qualification: 'operator',
      mustBeCaseHandler: false,
      changesPrimaryState: false,
    });
  });

  it('case.reassign.submit：经办与内勤同时能放行时，取不必是主办人', () => {
    expect(effectiveOpcodeRequirements('case.reassign.submit', ['经办', '内勤'])).toEqual({
      qualification: 'operator',
      mustBeCaseHandler: false,
      changesPrimaryState: false,
    });
  });

  it('legal.review.request：经办查操作的人并且必须是主办人，行政审核都不要求', () => {
    expect(effectiveOpcodeRequirements('legal.review.request', ['经办'])).toEqual({
      qualification: 'operator',
      mustBeCaseHandler: true,
      changesPrimaryState: false,
    });
    expect(effectiveOpcodeRequirements('legal.review.request', ['行政审核'])).toEqual({
      qualification: 'none',
      mustBeCaseHandler: false,
      changesPrimaryState: false,
    });
  });

  it('legal.review.request：经办与行政审核同时能放行时，按行政审核的宽要求', () => {
    expect(effectiveOpcodeRequirements('legal.review.request', ['经办', '行政审核'])).toEqual({
      qualification: 'none',
      mustBeCaseHandler: false,
      changesPrimaryState: false,
    });
  });
});
