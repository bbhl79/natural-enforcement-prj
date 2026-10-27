// #235 状态机常量与纯引擎。不碰数据库。
import { describe, expect, it } from 'vitest';

import {
  CASE_INSTANCE_STATUSES,
  CASE_MAIN_STATUSES,
  CASE_STAGE_CODES,
  CASE_TERMINAL_STATUSES,
  ILLEGAL_MIGRATIONS,
  TRANSITIONS,
  TRANSITION_GUARDS,
  X12_WHITELIST,
  buildTransitionEffects,
  decideTransition,
  findTransition,
  isX12Whitelisted,
  matchesFrom,
  nextEntrySeq,
  type TransitionSubject,
} from '../src/state-machine/index.ts';

const IDS = [
  'T01', 'T02', 'T03', 'T04', 'T05', 'T06', 'T07', 'T08', 'T09', 'T09a',
  'T10', 'T10a', 'T10b', 'T10c', 'T11', 'T12', 'T13', 'T14', 'T14a', 'T15',
  'T16', 'T16a', 'T17', 'T18', 'T19', 'T20', 'T21', 'T22', 'T23', 'T24',
  'T25', 'T26', 'T27', 'T28', 'T29', 'T30', 'T31', 'T32', 'T33', 'T34', 'T35',
];

function subject(partial: Partial<TransitionSubject> = {}): TransitionSubject {
  return {
    caseId: partial.caseId ?? null,
    mainStatus: partial.mainStatus ?? null,
    stage: partial.stage ?? null,
    stageEntrySeq: partial.stageEntrySeq ?? null,
    suspended: partial.suspended ?? false,
    markers: partial.markers ?? [],
    clueStatus: partial.clueStatus ?? null,
    handlingOrgId: partial.handlingOrgId ?? null,
    proposedHandlingOrgId: partial.proposedHandlingOrgId ?? null,
    actorRoles: partial.actorRoles ?? [],
    otherInFlightChains: partial.otherInFlightChains ?? 0,
    instances: partial.instances ?? [],
  };
}

describe('迁移表常量', () => {
  it('41 条、编号不重复、每条有起点和去向', () => {
    expect(TRANSITIONS).toHaveLength(41);
    expect(TRANSITIONS.map((item) => item.id)).toEqual(IDS);
    expect(new Set(TRANSITIONS.map((item) => item.id)).size).toBe(41);
    for (const item of TRANSITIONS) {
      expect(item.from).toBeTruthy();
      expect(item.to).toBeTruthy();
      expect(TRANSITION_GUARDS).toContain(item.guard);
    }
  });

  it('启用 T01、T02 与调查收尾 T03 至 T07，且已启用的边声明了守卫', () => {
    const enabled = TRANSITIONS.filter((item) => item.enabled).map((item) => item.id);
    expect(enabled).toEqual(['T01', 'T02', 'T03', 'T04', 'T05', 'T06', 'T07']);
    for (const item of TRANSITIONS) {
      if (!item.enabled) continue;
      expect(item.guard).not.toBe('none');
    }
  });

  it('环节、主状态、实例状态与终态清单完整', () => {
    expect(CASE_STAGE_CODES).toHaveLength(13);
    expect(CASE_MAIN_STATUSES).toEqual([
      'in_progress',
      'terminated_pending',
      'withdrawn',
      'closed',
      'finalized',
    ]);
    expect(CASE_INSTANCE_STATUSES).toEqual([
      'drafting',
      'pending_approval',
      'waiting_prerequisite',
      'completed',
    ]);
    expect(CASE_TERMINAL_STATUSES).toEqual(['withdrawn', 'closed', 'finalized']);
  });

  it('非法迁移 X01 到 X32 连续登记；X32 不实现；X12 白名单含阅读、导出、T27、结案后回证', () => {
    expect(ILLEGAL_MIGRATIONS.map((item) => item.id)).toEqual(
      Array.from({ length: 32 }, (_, index) => `X${String(index + 1).padStart(2, '0')}`),
    );
    expect(ILLEGAL_MIGRATIONS.find((item) => item.id === 'X02')?.enforcement).toBe('engine');
    expect(ILLEGAL_MIGRATIONS.find((item) => item.id === 'X03')?.enforcement).toBe('engine');
    expect(ILLEGAL_MIGRATIONS.find((item) => item.id === 'X32')?.enforcement).toBe('none');
    expect(ILLEGAL_MIGRATIONS.find((item) => item.id === 'X31')?.enforcement).toBe('filing');
    expect(X12_WHITELIST.map((item) => item.id)).toEqual(['read', 'export', 'T27', 'post-close-receipt']);
    expect(isX12Whitelisted('T28')).toBe(false);
    expect(isX12Whitelisted('T31')).toBe(false);
    expect(isX12Whitelisted('T35')).toBe(false);
  });
});

describe('起点匹配与次序号', () => {
  it('T01 只匹配已派承办人的线索', () => {
    const t01 = findTransition('T01');
    expect(t01).not.toBeNull();
    expect(matchesFrom(t01!, subject({ clueStatus: 'handler_assigned' }))).toBe(true);
    expect(matchesFrom(t01!, subject({ clueStatus: 'filed' }))).toBe(false);
  });

  it('T08 的起点是 E02，T06 的起点是待收尾，T27 的起点是已结案或已撤案', () => {
    expect(matchesFrom(findTransition('T08')!, subject({ stage: 'E02', mainStatus: 'in_progress' }))).toBe(true);
    expect(matchesFrom(findTransition('T08')!, subject({ stage: 'E05', mainStatus: 'in_progress' }))).toBe(false);
    expect(matchesFrom(findTransition('T06')!, subject({ mainStatus: 'terminated_pending' }))).toBe(true);
    expect(matchesFrom(findTransition('T06')!, subject({ mainStatus: 'in_progress' }))).toBe(false);
    expect(matchesFrom(findTransition('T27')!, subject({ mainStatus: 'closed' }))).toBe(true);
    expect(matchesFrom(findTransition('T27')!, subject({ mainStatus: 'withdrawn' }))).toBe(true);
    expect(matchesFrom(findTransition('T27')!, subject({ mainStatus: 'in_progress' }))).toBe(false);
  });

  it('再次进入同一环节时次序号加 1，没有旧实例时为 1', () => {
    expect(nextEntrySeq([], 'E02')).toBe(1);
    expect(nextEntrySeq([{ stage: 'E02', entrySeq: 1, status: 'drafting' }], 'E02')).toBe(2);
    expect(nextEntrySeq([{ stage: 'E01', entrySeq: 1, status: 'completed' }], 'E02')).toBe(1);
    const effects = buildTransitionEffects(findTransition('T09')!, subject({
      caseId: 'c1',
      stage: 'E04',
      mainStatus: 'in_progress',
      stageEntrySeq: 1,
      instances: [
        { stage: 'E02', entrySeq: 1, status: 'drafting' },
        { stage: 'E04', entrySeq: 1, status: 'drafting' },
      ],
    }));
    expect(effects?.instances).toEqual([
      { stage: 'E02', entrySeq: 2, status: 'drafting', transitionCode: 'T09' },
    ]);
    expect(effects?.stageEntrySeq).toBe(2);
    expect(effects?.instances.some((row) => row.entrySeq === 1)).toBe(false);
  });
});

describe('引擎 409 分支', () => {
  const openCase = subject({
    caseId: 'c1',
    mainStatus: 'in_progress',
    stage: 'E02',
    stageEntrySeq: 1,
    handlingOrgId: 'org-1',
    clueStatus: 'filed',
    instances: [{ stage: 'E02', entrySeq: 1, status: 'drafting' }],
  });

  it('未启用的边返回 transition-disabled，不产生效果', () => {
    const decision = decideTransition({ operation: { kind: 'transition', transitionId: 'T08' }, subject: openCase });
    expect(decision.ok).toBe(false);
    if (decision.ok || decision.level !== 'block') throw new Error('应为阻断');
    expect(decision.reason).toBe('transition-disabled');
    expect(decision.httpStatus).toBe(409);
  });

  it('已启用但起点不符返回 invalid-state', () => {
    const decision = decideTransition({ operation: { kind: 'transition', transitionId: 'T01' }, subject: openCase });
    expect(decision.ok).toBe(false);
    if (decision.ok || decision.level !== 'block') throw new Error('应为阻断');
    expect(decision.reason).toBe('invalid-state');
  });

  it('未知编号、终态写、白名单 T27、监督、改承办机构、第二条审批链', () => {
    const unknown = decideTransition({
      operation: { kind: 'transition', transitionId: 'T99' },
      subject: openCase,
    });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok && unknown.level === 'block') expect(unknown.reason).toBe('unknown-transition');

    const terminal = decideTransition({
      operation: { kind: 'transition', transitionId: 'T03' },
      subject: subject({ ...openCase, mainStatus: 'closed' }),
    });
    expect(terminal.ok).toBe(false);
    if (!terminal.ok && terminal.level === 'block') expect(terminal.reason).toBe('X12');

    const archive = decideTransition({
      operation: { kind: 'transition', transitionId: 'T27' },
      subject: subject({ ...openCase, mainStatus: 'closed' }),
    });
    expect(archive.ok).toBe(false);
    if (!archive.ok && archive.level === 'block') expect(archive.reason).toBe('transition-disabled');

    const supervisor = decideTransition({
      operation: { kind: 'transition', transitionId: 'T01' },
      subject: subject({ clueStatus: 'handler_assigned', actorRoles: ['监督'] }),
    });
    expect(supervisor.ok).toBe(false);
    if (!supervisor.ok && supervisor.level === 'block') expect(supervisor.reason).toBe('X17');

    const org = decideTransition({
      operation: { kind: 'transition', transitionId: 'T03' },
      subject: subject({ ...openCase, proposedHandlingOrgId: 'org-2' }),
    });
    expect(org.ok).toBe(false);
    if (!org.ok && org.level === 'block') expect(org.reason).toBe('X13');

    const chain = decideTransition({
      operation: { kind: 'open-approval-chain' },
      subject: subject({ ...openCase, otherInFlightChains: 1 }),
    });
    expect(chain.ok).toBe(false);
    if (!chain.ok && chain.level === 'block') expect(chain.reason).toBe('X18');
  });

  it('T01 成功效果是 E01 完成加 E02 拟制中；警告不产生效果', () => {
    const decision = decideTransition({
      operation: { kind: 'transition', transitionId: 'T01' },
      subject: subject({ clueStatus: 'handler_assigned' }),
    });
    expect(decision.ok).toBe(true);
    if (!decision.ok) throw new Error('应成功');
    expect(decision.effects.kind).toBe('open-case');
    expect(decision.effects.mainStatus).toBe('in_progress');
    expect(decision.effects.currentStage).toBe('E02');
    expect(decision.effects.stageEntrySeq).toBe(1);
    expect(decision.effects.instances).toEqual([
      { stage: 'E01', entrySeq: 1, status: 'completed', transitionCode: 'T01' },
      { stage: 'E02', entrySeq: 1, status: 'drafting', transitionCode: 'T01' },
    ]);

    const warned = decideTransition({
      operation: { kind: 'transition', transitionId: 'T01' },
      subject: subject({ clueStatus: 'handler_assigned' }),
      advisories: [{ level: 'warn', code: 'advisory', message: '同事项已有案件' }],
    });
    expect(warned.ok).toBe(false);
    if (warned.ok || warned.level === 'block') throw new Error('应为警告');
    expect(warned.level).toBe('warn');
    expect(warned.httpStatus).toBe(200);
  });

  it('中止期间 T08 返回 X02，即使该边未启用；已中止再办 T03 是起点不符', () => {
    const blocked = decideTransition({
      operation: { kind: 'transition', transitionId: 'T08' },
      subject: subject({ ...openCase, suspended: true }),
    });
    expect(blocked.ok).toBe(false);
    if (blocked.ok || blocked.level !== 'block') throw new Error('应为阻断');
    expect(blocked.reason).toBe('X02');
    expect(blocked.citation).toBe('办法第 27 条；#17');

    const again = decideTransition({
      operation: { kind: 'transition', transitionId: 'T03' },
      subject: subject({ ...openCase, suspended: true }),
    });
    expect(again.ok).toBe(false);
    if (again.ok || again.level !== 'block') throw new Error('应为阻断');
    expect(again.reason).toBe('invalid-state');
  });

  it('待收尾时除 T06、T07 外返回 X03；T06 进入已撤案并去掉中止标记', () => {
    const blocked = decideTransition({
      operation: { kind: 'transition', transitionId: 'T08' },
      subject: subject({ ...openCase, mainStatus: 'terminated_pending', suspended: true }),
    });
    expect(blocked.ok).toBe(false);
    if (blocked.ok || blocked.level !== 'block') throw new Error('应为阻断');
    expect(blocked.reason).toBe('X03');

    const chain = decideTransition({
      operation: { kind: 'open-approval-chain', chainKind: 'suspend' },
      subject: subject({ ...openCase, mainStatus: 'terminated_pending' }),
    });
    expect(chain.ok).toBe(false);
    if (chain.ok || chain.level !== 'block') throw new Error('应为阻断');
    expect(chain.reason).toBe('X03');

    const withdraw = decideTransition({
      operation: { kind: 'transition', transitionId: 'T06' },
      subject: subject({ ...openCase, mainStatus: 'terminated_pending', suspended: true }),
    });
    expect(withdraw.ok).toBe(true);
    if (!withdraw.ok) throw new Error('应成功');
    expect(withdraw.effects.mainStatus).toBe('withdrawn');
    expect(withdraw.effects.suspended).toBe(false);
  });

  it('T03 加上中止标记，T04 去掉标记，主状态仍是办理中', () => {
    const suspended = decideTransition({
      operation: { kind: 'transition', transitionId: 'T03' },
      subject: openCase,
    });
    expect(suspended.ok).toBe(true);
    if (!suspended.ok) throw new Error('应成功');
    expect(suspended.effects.suspended).toBe(true);
    expect(suspended.effects.mainStatus).toBe('in_progress');
    expect(suspended.effects.currentStage).toBe('E02');

    const resumed = decideTransition({
      operation: { kind: 'transition', transitionId: 'T04' },
      subject: subject({ ...openCase, suspended: true }),
    });
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) throw new Error('应成功');
    expect(resumed.effects.suspended).toBe(false);
    expect(resumed.effects.mainStatus).toBe('in_progress');
  });

  it('阅读终态案件不被 X12 挡住', () => {
    const decision = decideTransition({
      operation: { kind: 'read' },
      subject: subject({ ...openCase, mainStatus: 'finalized' }),
    });
    expect(decision.ok).toBe(true);
  });
});
