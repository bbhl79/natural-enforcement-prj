// #236 调查环节纯规则：笔录两人、作废、原因枚举、停表参数。
import { describe, expect, it } from 'vitest';

import {
  EXTEND_DEADLINE_PROMPT,
  SUSPENSION_CLOCK_PARAMETER,
  LIMITATION_DISCOVERY_EXIT_V1,
  checkInquiryOfficers,
  checkLimitationDiscoveryExit,
  checkProcedureContent,
  checkProcedureState,
  checkVoidViolation,
  hearingHasStarted,
  inquiryOfficerBlock,
  suspensionClockEvent,
} from '../src/investigation/index.ts';

describe('笔录在场人员（X20）', () => {
  const handlers = ['main', 'assist'];

  it('少于两名本案承办人员为 X20，命中说明带处罚办法第 17 条第 2 款', () => {
    expect(checkInquiryOfficers(['main'], handlers).ok).toBe(false);
    expect(checkInquiryOfficers(['main', 'outsider'], handlers).ok).toBe(false);
    expect(checkInquiryOfficers(['main', 'main'], handlers).ok).toBe(false);
    const block = inquiryOfficerBlock();
    expect(block.citation).toBe('处罚办法第 17 条第 2 款');
  });

  it('两名不同的本案承办人员可以通过，外人不再计数', () => {
    const checked = checkInquiryOfficers(['main', 'assist', 'outsider'], handlers);
    expect(checked).toEqual({ ok: true, officerIds: ['main', 'assist'] });
  });
});

describe('违法记录作废', () => {
  it('理由空白拒绝；非主办拒绝；审理开始后拒绝', () => {
    expect(checkVoidViolation({ stage: 'E02', reason: '  ', isMainHandler: true }).ok).toBe(false);
    const notMain = checkVoidViolation({ stage: 'E02', reason: '记错了', isMainHandler: false });
    expect(notMain.ok).toBe(false);
    if (notMain.ok) throw new Error('应拒绝');
    expect(notMain.reason).toBe('not-main-handler');
    expect(hearingHasStarted('E03')).toBe(false);
    expect(hearingHasStarted('E04')).toBe(true);
    const hearing = checkVoidViolation({ stage: 'E04', reason: '记错了', isMainHandler: true });
    expect(hearing.ok).toBe(false);
    if (hearing.ok) throw new Error('应拒绝');
    expect(hearing.httpStatus).toBe(409);
    expect(hearing.reason).toBe('hearing-started');
  });

  it('调查环节主办可作废，理由去掉空白', () => {
    expect(checkVoidViolation({ stage: 'E02', reason: ' 记错当事人 ', isMainHandler: true })).toEqual({
      ok: true,
      reason: '记错当事人',
    });
  });
});

describe('呈批原因', () => {
  it('中止不带「是否同时办延长」也能通过', () => {
    expect(EXTEND_DEADLINE_PROMPT).toBe('是否同时办延长办案期限');
    expect(checkProcedureContent({ kind: 'suspend' })).toEqual({
      ok: true,
      content: { kind: 'suspend', extendTogether: false },
    });
    expect(checkProcedureContent({ kind: 'suspend', extendTogether: true }).ok).toBe(true);
  });

  it('终止原因不在五项内为 400；五项内通过', () => {
    const bad = checkProcedureContent({ kind: 'terminate', reason: 'death' });
    expect(bad.ok).toBe(false);
    if (bad.ok) throw new Error('应拒绝');
    expect(bad.hit.httpStatus).toBe(400);
    expect(checkProcedureContent({ kind: 'terminate', reason: 'other' }).ok).toBe(true);
    expect(checkProcedureContent({ kind: 'terminate', reason: 'force-majeure' }).ok).toBe(true);
  });

  it('撤案原因不是两项之一为 409', () => {
    const bad = checkProcedureContent({ kind: 'withdraw', reason: 'force-majeure' });
    expect(bad.ok).toBe(false);
    if (bad.ok) throw new Error('应拒绝');
    expect(bad.hit.httpStatus).toBe(409);
    expect(bad.hit.reason).toBe('invalid-withdraw-reason');
    expect(checkProcedureContent({ kind: 'withdraw', reason: 'fact-not-established' }).ok).toBe(true);
    expect(checkProcedureContent({ kind: 'withdraw', reason: 'limitation-expired' }).ok).toBe(true);
  });

  it('结案选不可抗力、不属本部门管辖均通过内容校验（#242 开放管辖支）', () => {
    expect(checkProcedureContent({ kind: 'close', reason: 'force-majeure' })).toEqual({
      ok: true,
      content: { kind: 'close', reason: 'force-majeure' },
    });
    expect(checkProcedureContent({ kind: 'close', reason: 'outside-jurisdiction' })).toEqual({
      ok: true,
      content: { kind: 'close', reason: 'outside-jurisdiction' },
    });
  });

  it('待收尾只允许撤案和结案；办理中不能直接撤案', () => {
    const blocked = checkProcedureState({
      kind: 'suspend',
      mainStatus: 'terminated_pending',
      stage: 'E02',
      suspended: false,
    });
    expect(blocked.ok).toBe(false);
    if (blocked.ok) throw new Error('应拒绝');
    expect(blocked.hit.reason).toBe('X03');
    expect(checkProcedureState({
      kind: 'withdraw',
      mainStatus: 'terminated_pending',
      stage: 'E02',
      suspended: false,
    }).ok).toBe(true);
    expect(checkProcedureState({
      kind: 'withdraw',
      mainStatus: 'in_progress',
      stage: 'E02',
      suspended: false,
    }).ok).toBe(false);
  });
});

describe('追诉时效发现时点映射', () => {
  it('默认常量同时保留终止调查与撤案，审理后只记录出口', () => {
    expect(LIMITATION_DISCOVERY_EXIT_V1.ruleId).toBe('cfg.rule.limitation-discovery-exit.v1');
    expect(LIMITATION_DISCOVERY_EXIT_V1.beforeHearing.map((row) => row.kind)).toEqual(['terminate', 'withdraw']);
    expect(LIMITATION_DISCOVERY_EXIT_V1.afterHearing).toEqual({
      outcomeCode: 'O2',
      outcomeLabel: '不予行政处罚',
      transitionId: 'T12',
      applyInThisTicket: false,
    });
  });

  it('审理后的出口字段抄映射，本函数不放行', () => {
    const blocked = checkLimitationDiscoveryExit({
      stage: 'E04',
      kind: 'terminate',
      reason: 'limitation-expired',
      rule: {
        ruleId: 'cfg.rule.limitation-discovery-exit.test',
        beforeHearing: [{ kind: 'terminate', transitionId: 'T05' }],
        afterHearing: {
          outcomeCode: 'CFG',
          outcomeLabel: '配置出口',
          transitionId: 'configured-exit',
          applyInThisTicket: false,
        },
      },
    });
    expect(blocked.ok).toBe(false);
    if (blocked.ok) throw new Error('应拒绝');
    expect(blocked.hit).toMatchObject({
      reason: 'post-hearing-limitation',
      transitionId: 'configured-exit',
      outcomeCode: 'CFG',
      outlet: '配置出口',
      applyInThisTicket: false,
    });
  });

  it('调查阶段按映射放行终止调查与撤案；映射未列的种类拒绝', () => {
    expect(
      checkLimitationDiscoveryExit({
        stage: 'E02',
        kind: 'terminate',
        reason: 'limitation-expired',
        rule: LIMITATION_DISCOVERY_EXIT_V1,
      }).ok,
    ).toBe(true);
    expect(
      checkLimitationDiscoveryExit({
        stage: 'E02',
        kind: 'withdraw',
        reason: 'limitation-expired',
        rule: LIMITATION_DISCOVERY_EXIT_V1,
      }).ok,
    ).toBe(true);
    const dropped = checkLimitationDiscoveryExit({
      stage: 'E02',
      kind: 'withdraw',
      reason: 'limitation-expired',
      rule: {
        ...LIMITATION_DISCOVERY_EXIT_V1,
        beforeHearing: [{ kind: 'terminate', transitionId: 'T05' }],
      },
    });
    expect(dropped.ok).toBe(false);
    if (dropped.ok) throw new Error('应拒绝');
    expect(dropped.hit.reason).toBe('invalid-state');
  });

  it('审理开始后不能撤案', () => {
    const blocked = checkProcedureState({
      kind: 'withdraw',
      mainStatus: 'terminated_pending',
      stage: 'E04',
      suspended: false,
    });
    expect(blocked.ok).toBe(false);
    if (blocked.ok) throw new Error('应拒绝');
    expect(blocked.hit.reason).toBe('invalid-state');
    expect(blocked.hit.message).toBe('撤案只在审理开始前');
  });
});

describe('停表参数', () => {
  it('事件类别抄参数，不在函数里写死', () => {
    const drafted = suspensionClockEvent(
      { basisLabel: '参数类别', basisNote: '待确认' },
      { eventKind: 'stop', stage: 'E02', entrySeq: 1, transitionCode: 'T03' },
    );
    expect(drafted.basisLabel).toBe('参数类别');
    expect(drafted.basisNote).toBe('待确认');
    expect(drafted.eventKind).toBe('stop');
    expect(SUSPENSION_CLOCK_PARAMETER.basisLabel).toBe('业务不计入');
    expect(SUSPENSION_CLOCK_PARAMETER.basisNote).toBe('依据待法制部门确认');
  });
});
