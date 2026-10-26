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
  // #210 新增 11 个线索操作码（#207 协议 A 节「操作码终稿」）。
  'clue.register',
  'clue.dispatch.decide',
  'clue.withdraw.undo',
  'clue.disposition.record',
  'clue.reminder.resolve',
  'clue.item.supplement',
  'clue.verify.retry',
  'clue.reference.read',
  'clue.geometry.update',
  'clue.designate.request',
  'clue.pool.reassign',
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
  'storage.quarantine.mark',
] as const;

/** #210 新增的 11 个线索操作码（#207 协议 A 节「操作码终稿」）。 */
const NEW_CLUE_OPCODES = [
  'clue.register',
  'clue.dispatch.decide',
  'clue.withdraw.undo',
  'clue.disposition.record',
  'clue.reminder.resolve',
  'clue.item.supplement',
  'clue.verify.retry',
  'clue.reference.read',
  'clue.geometry.update',
  'clue.designate.request',
  'clue.pool.reassign',
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

describe('#210 新增 11 个线索操作码', () => {
  it('名册里都有条目，且不另造平行名册（复用码仍是那四个）', () => {
    for (const code of NEW_CLUE_OPCODES) {
      expect(OPCODES, code).toContain(code);
    }
    // 复用码不另造平行名册：派机构、派主办、读、导出各只有一条。
    expect(OPCODES.filter((code) => code.startsWith('clue.')).sort()).toEqual(
      [
        ...NEW_CLUE_OPCODES,
        'clue.export',
        'clue.handler.assign',
        'clue.org.assign',
        'clue.read',
        'clue.verify.start',
      ].sort(),
    );
  });

  it('登记、决定、撤回、处置、提醒处理、重绘、重新指定接收机构改变主状态', () => {
    for (const code of [
      'clue.register',
      'clue.dispatch.decide',
      'clue.withdraw.undo',
      'clue.disposition.record',
      'clue.reminder.resolve',
      'clue.geometry.update',
      'clue.pool.reassign',
    ]) {
      expect(opcodeRequirements(code)?.changesPrimaryState, code).toBe(true);
    }
  });

  it('补齐要件、手动重跑、实名查阅、报请指定管辖、涉密误传隔离不改变主状态', () => {
    for (const code of [
      'clue.item.supplement',
      'clue.verify.retry',
      'clue.reference.read',
      'clue.designate.request',
      'storage.quarantine.mark',
    ]) {
      expect(opcodeRequirements(code)?.changesPrimaryState, code).toBe(false);
    }
  });

  it('新增 11 码一律不要求执法资格、不必是主办人（对象级校验归 case 服务）', () => {
    for (const code of NEW_CLUE_OPCODES) {
      expect(opcodeRequirements(code), code).toEqual({
        qualification: 'none',
        mustBeCaseHandler: false,
        changesPrimaryState: opcodeRequirements(code)?.changesPrimaryState,
      });
    }
  });

  it('监督角色贡献的允许行不改变主状态的码时仍可放行，改变主状态的码不放行', () => {
    const notChanging = NEW_CLUE_OPCODES.filter((code) => !opcodeRequirements(code)?.changesPrimaryState);
    for (const code of notChanging) {
      expect(effectiveOpcodeRequirements(code, ['监督'])?.changesPrimaryState, code).toBe(false);
    }
    for (const code of NEW_CLUE_OPCODES.filter((c) => opcodeRequirements(c)?.changesPrimaryState)) {
      // 监督的允许行对改变主状态的码不生效：effectiveOpcodeRequirements 仍返回宽要求，
      // 但 AccessControlService 的 effectiveGrantingRoles 会把监督过滤掉。
      expect(opcodeRequirements(code)?.changesPrimaryState, code).toBe(true);
    }
  });

  it('启动核查的名册条目保留（本期只移除种子授权，不改名册）', () => {
    expect(opcodeRequirements('clue.verify.start')).toEqual({
      qualification: 'operator',
      mustBeCaseHandler: true,
      changesPrimaryState: true,
    });
  });
});
