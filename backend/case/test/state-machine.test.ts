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
  X03_WARN_MESSAGE,
  buildTransitionEffects,
  confirmationGap,
  decideTransition,
  findRuleParameter,
  findTransition,
  isX12Whitelisted,
  matchesFrom,
  nextEntrySeq,
  unannotatedMigrationIds,
  type GuardAuthority,
  type GuardResult,
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

  it('启用 T01、T02 与调查收尾 T03 至 T07、改派 T33，且已启用的边声明了守卫', () => {
    const enabled = TRANSITIONS.filter((item) => item.enabled).map((item) => item.id);
    expect(enabled).toEqual(['T01', 'T02', 'T03', 'T04', 'T05', 'T06', 'T07', 'T33']);
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

  it('非法迁移 X01 到 X33 连续登记；X32、X33 不实现；X12 白名单含阅读、导出、T27、结案后回证', () => {
    expect(ILLEGAL_MIGRATIONS.map((item) => item.id)).toEqual(
      Array.from({ length: 33 }, (_, index) => `X${String(index + 1).padStart(2, '0')}`),
    );
    expect(ILLEGAL_MIGRATIONS.find((item) => item.id === 'X02')?.enforcement).toBe('engine');
    expect(ILLEGAL_MIGRATIONS.find((item) => item.id === 'X03')?.enforcement).toBe('engine');
    expect(ILLEGAL_MIGRATIONS.find((item) => item.id === 'X32')?.enforcement).toBe('none');
    expect(ILLEGAL_MIGRATIONS.find((item) => item.id === 'X33')?.enforcement).toBe('none');
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
      advisories: [{ level: 'warn', code: 'advisory', message: '同事项已有案件', authority: 'normative' }],
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
    expect(blocked.citation).toBe('办法第27条（推定）');

    const again = decideTransition({
      operation: { kind: 'transition', transitionId: 'T03' },
      subject: subject({ ...openCase, suspended: true }),
    });
    expect(again.ok).toBe(false);
    if (again.ok || again.level !== 'block') throw new Error('应为阻断');
    expect(again.reason).toBe('invalid-state');
  });

  it('待收尾时除 T06、T07 外，X03 降为警告；T06 进入已撤案并去掉中止标记', () => {
    const blocked = decideTransition({
      operation: { kind: 'transition', transitionId: 'T08' },
      subject: subject({ ...openCase, mainStatus: 'terminated_pending', suspended: true }),
    });
    expect(blocked.ok).toBe(false);
    if (blocked.ok || blocked.level === 'block') throw new Error('X03 应为警告');
    expect(blocked.level).toBe('warn');
    expect(blocked.httpStatus).toBe(200);
    expect(blocked.reason).toBe('X03');
    expect('effects' in blocked).toBe(false);

    const chain = decideTransition({
      operation: { kind: 'open-approval-chain', chainKind: 'suspend' },
      subject: subject({ ...openCase, mainStatus: 'terminated_pending' }),
    });
    expect(chain.ok).toBe(false);
    if (chain.ok || chain.level === 'block') throw new Error('X03 应为警告');
    expect(chain.level).toBe('warn');
    expect(chain.httpStatus).toBe(200);
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

const AUTHORITY_OF: Readonly<Record<GuardAuthority, readonly string[]>> = {
  system: ['X01', 'X02', 'X04', 'X12', 'X13', 'X15', 'X16', 'X17', 'X18', 'X23', 'X24', 'X25', 'X28', 'X29', 'X31', 'X32', 'X33'],
  law: ['X05', 'X07', 'X09', 'X14'],
  regulation: ['X06', 'X08', 'X11', 'X20', 'X27', 'X30'],
  normative: ['X03', 'X10', 'X19', 'X21', 'X22', 'X26'],
  internal: [],
};

function citationOf(id: string): string | undefined {
  return ILLEGAL_MIGRATIONS.find((item) => item.id === id)?.citation;
}

function blockingAdvisory(authority: GuardAuthority, userLock?: string): GuardResult {
  return {
    level: 'block',
    code: 'X-AUTH',
    message: '同一迁移探针',
    authority,
    ...(userLock ? { userLock } : {}),
  };
}

describe('依据层级与 USER LOCK（#255）', () => {
  const ready = subject({ clueStatus: 'handler_assigned' });

  it('同一条迁移：law、regulation、system 为 409；normative、internal 为警告且无效果', () => {
    for (const authority of ['law', 'regulation', 'system'] as const) {
      const decision = decideTransition({
        operation: { kind: 'transition', transitionId: 'T01' },
        subject: ready,
        advisories: [blockingAdvisory(authority)],
      });
      expect(decision.ok).toBe(false);
      if (decision.ok || decision.level !== 'block') throw new Error(`${authority} 应为阻断`);
      expect(decision.httpStatus).toBe(409);
      expect(decision.reason).toBe('X-AUTH');
      expect('effects' in decision).toBe(false);
    }
    for (const authority of ['normative', 'internal'] as const) {
      const decision = decideTransition({
        operation: { kind: 'transition', transitionId: 'T01' },
        subject: ready,
        advisories: [blockingAdvisory(authority)],
      });
      expect(decision.ok).toBe(false);
      if (decision.ok || decision.level === 'block') throw new Error(`${authority} 应为警告`);
      expect(decision.httpStatus).toBe(200);
      expect(decision.level).toBe('warn');
      expect(decision.reason).toBe('X-AUTH');
      expect('effects' in decision).toBe(false);
      expect(decision.advisories[0]?.level).toBe('warn');
    }
  });

  it('登记表按 #255 逐条标注；X08 未拆条，整条为 regulation', () => {
    for (const [authority, ids] of Object.entries(AUTHORITY_OF)) {
      expect(ILLEGAL_MIGRATIONS.filter((item) => item.authority === authority).map((item) => item.id)).toEqual(ids);
    }
    const x08 = ILLEGAL_MIGRATIONS.find((item) => item.id === 'X08');
    expect(x08?.authority).toBe('regulation');
    expect(x08?.summary).toContain('摘要不一致');
    expect(x08?.citation).toBe('处罚法第58条＋办法第32条第1款＋监督规定第21条第1款');
    expect(citationOf('X02')).toBe('办法第27条（推定）');
    expect(citationOf('X04')).toBe('办法第29条＋第30条（推定）');
    expect(citationOf('X11')).toBe('办法第46条末款');
    expect(citationOf('X20')).toBe('办法第17条第2款＋行政处罚法第42条；笔录记载在场人员属实现口径');
    expect(citationOf('X26')).toBe('规程7.1／8.2；设计加严，非规定要求');
    expect(citationOf('X27')).toBe('粤府令第294号第33条＋处罚法第58条（二）');
    const x07 = ILLEGAL_MIGRATIONS.find((item) => item.id === 'X07');
    expect(x07?.authority).toBe('law');
    expect(x07?.userLock).toBe('#111 L3');
    expect(x07?.enforcement).toBe('none');
    expect(x07?.citation).toBe('处罚法第44、62条＋粤府令第294号第17条');
    const x16 = ILLEGAL_MIGRATIONS.find((item) => item.id === 'X16');
    expect(x16?.authority).toBe('system');
    expect(x16?.userLock).toBe('#111 L4');
    expect(ILLEGAL_MIGRATIONS.filter((item) => item.userLock).map((item) => [item.id, item.userLock])).toEqual([
      ['X07', '#111 L3'],
      ['X16', '#111 L4'],
    ]);
  });

  it('结构红探针：登记表漏标 authority 判红', () => {
    expect(unannotatedMigrationIds(ILLEGAL_MIGRATIONS)).toEqual([]);
    expect(unannotatedMigrationIds([
      { id: 'X01', authority: 'system' },
      { id: 'X-MISSING' },
    ])).toEqual(['X-MISSING']);
    expect(unannotatedMigrationIds([{ id: 'X-BAD', authority: 'statute' }])).toEqual(['X-BAD']);
  });

  it('带 userLock 的登记项即使按 normative 送来也仍 block；红探针：normative 加 userLock 仍 block', () => {
    for (const row of ILLEGAL_MIGRATIONS) {
      if (!row.userLock) continue;
      const decision = decideTransition({
        operation: { kind: 'transition', transitionId: 'T01' },
        subject: ready,
        advisories: [{ level: 'block', code: row.id, message: row.summary, authority: 'normative' }],
      });
      expect(decision.ok).toBe(false);
      if (decision.ok || decision.level !== 'block') throw new Error(`${row.id} 带 userLock 不得降为警告`);
      expect(decision.httpStatus).toBe(409);
      expect(decision.reason).toBe(row.id);
    }
    const locked = decideTransition({
      operation: { kind: 'transition', transitionId: 'T01' },
      subject: ready,
      advisories: [{ level: 'block', code: 'X-LOCK', message: '红探针', authority: 'normative', userLock: '#probe' }],
    });
    expect(locked.ok).toBe(false);
    if (locked.ok || locked.level !== 'block') throw new Error('normative 加 userLock 必须仍阻断');
    expect(locked.httpStatus).toBe(409);
    expect(locked.reason).toBe('X-LOCK');
    const open = decideTransition({
      operation: { kind: 'transition', transitionId: 'T01' },
      subject: ready,
      advisories: [{ level: 'block', code: 'X-LOCK', message: '红探针', authority: 'normative' }],
    });
    expect(open.ok).toBe(false);
    if (open.ok || open.level === 'block') throw new Error('同条无 userLock 应为警告');
    expect(open.level).toBe('warn');
    expect(open.httpStatus).toBe(200);
  });
});

describe('两段式确认与规则键（#258）', () => {
  const ready = subject({ clueStatus: 'handler_assigned' });
  const pending = subject({
    caseId: 'case-1',
    mainStatus: 'terminated_pending',
    stage: 'E02',
    stageEntrySeq: 1,
    suspended: false,
    handlingOrgId: 'org-1',
  });
  const x03 = {
    level: 'warn' as const,
    code: 'X03',
    message: X03_WARN_MESSAGE,
    authority: 'normative' as const,
    citation: '规程 4.3.3(4)',
  };

  it('注册表只登记 X03 的参数，不登记业务票的警告规则', () => {
    expect(findRuleParameter('X03')).toMatchObject({
      ruleKey: 'X03',
      version: '1',
      level: 'warn',
      reasonRequired: false,
    });
    expect(findRuleParameter('X10')).toBeNull();
    expect(findRuleParameter('X22')).toBeNull();
    expect(findRuleParameter('X26')).toBeNull();
    expect(findRuleParameter('X07')).toBeNull();
    expect(findRuleParameter('X16')).toBeNull();
  });

  it('理由必填按规则标注；未登记的确认键先被拒绝', () => {
    const registry = [
      { ruleKey: 'R-NEED', version: '1', level: 'warn' as const, message: '要理由', citation: null, reasonRequired: true },
      { ruleKey: 'R-FREE', version: '1', level: 'warn' as const, message: '免理由', citation: null, reasonRequired: false },
    ];
    expect(confirmationGap({
      warnRuleKeys: ['R-NEED'],
      confirmedRuleKeys: ['R-NEED'],
      confirmReasons: {},
      registry,
    })).toEqual({ kind: 'reason', ruleKey: 'R-NEED' });
    expect(confirmationGap({
      warnRuleKeys: ['R-FREE'],
      confirmedRuleKeys: ['R-FREE'],
      confirmReasons: {},
      registry,
    })).toEqual({ kind: 'ready' });
    expect(confirmationGap({
      warnRuleKeys: ['X03'],
      confirmedRuleKeys: ['NO-SUCH'],
      confirmReasons: {},
    })).toEqual({ kind: 'unknown', ruleKey: 'NO-SUCH' });
    expect(confirmationGap({
      warnRuleKeys: ['X03', 'X10'],
      confirmedRuleKeys: ['X03'],
      confirmReasons: {},
    })).toEqual({ kind: 'hold' });
  });

  it('首次命中 warn 返回 warnings 且无效果；确认已登记键后才执行', () => {
    const first = decideTransition({
      operation: { kind: 'transition', transitionId: 'T01' },
      subject: ready,
      advisories: [x03],
    });
    expect(first.ok).toBe(false);
    if (first.ok || first.httpStatus !== 200) throw new Error('首次应为警告');
    expect(first.warnings).toEqual([
      { level: 'warn', code: 'X03', message: X03_WARN_MESSAGE, citation: '规程 4.3.3(4)', ruleKey: 'X03' },
    ]);
    expect('effects' in first).toBe(false);

    const again = decideTransition({
      operation: { kind: 'transition', transitionId: 'T01' },
      subject: ready,
      advisories: [x03],
      confirmedRuleKeys: ['X03'],
    });
    expect(again.ok).toBe(true);
    if (!again.ok) throw new Error('确认后应执行');
    expect(again.effects.kind).toBe('open-case');
    expect(again.confirmation?.ruleKeys).toEqual([{ ruleKey: 'X03', version: '1' }]);
    expect(again.confirmation?.warnings).toEqual(first.warnings);
  });

  it('只确认其中一部分 warn 时仍不执行；未知确认键返回 400', () => {
    const partial = decideTransition({
      operation: { kind: 'transition', transitionId: 'T01' },
      subject: ready,
      advisories: [x03, { level: 'warn', code: 'X10', message: '另一条', authority: 'normative' }],
      confirmedRuleKeys: ['X03'],
    });
    expect(partial.ok).toBe(false);
    if (partial.ok || partial.httpStatus !== 200) throw new Error('未齐应为警告');
    expect(partial.warnings.map((item) => item.ruleKey)).toEqual(['X03', 'X10']);

    const unknown = decideTransition({
      operation: { kind: 'transition', transitionId: 'T01' },
      subject: ready,
      confirmedRuleKeys: ['NO-SUCH'],
    });
    expect(unknown.ok).toBe(false);
    if (unknown.ok || unknown.httpStatus !== 400) throw new Error('未知键应为 400');
    expect(unknown.reason).toBe('unknown-rule-key');
    expect(unknown.ruleKey).toBe('NO-SUCH');
  });

  it('hint 不要求确认，也不放行执行', () => {
    const hinted = decideTransition({
      operation: { kind: 'transition', transitionId: 'T01' },
      subject: ready,
      advisories: [{ level: 'hint', code: 'HINT-1', message: '只记命中', authority: 'internal' }],
      confirmedRuleKeys: ['X03'],
    });
    expect(hinted.ok).toBe(false);
    if (hinted.ok || hinted.httpStatus !== 200) throw new Error('hint 应保持 200');
    expect(hinted.level).toBe('hint');
    expect('effects' in hinted).toBe(false);
  });

  it('待收尾的 X03 确认后才放行已启用的开链；未启用边确认后仍是 transition-disabled', () => {
    const held = decideTransition({
      operation: { kind: 'open-approval-chain', chainKind: 'suspend' },
      subject: pending,
    });
    expect(held.ok).toBe(false);
    if (held.ok || held.level === 'block') throw new Error('X03 应为警告');
    expect(held.httpStatus).toBe(200);
    expect(held.reason).toBe('X03');

    const opened = decideTransition({
      operation: { kind: 'open-approval-chain', chainKind: 'suspend' },
      subject: pending,
      confirmedRuleKeys: ['X03'],
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) throw new Error('确认后应可开链');
    expect(opened.effects.kind).toBe('open-chain');
    expect(opened.confirmation?.ruleKeys).toEqual([{ ruleKey: 'X03', version: '1' }]);

    const disabled = decideTransition({
      operation: { kind: 'transition', transitionId: 'T08' },
      subject: pending,
      confirmedRuleKeys: ['X03'],
    });
    expect(disabled.ok).toBe(false);
    if (disabled.ok || disabled.level !== 'block') throw new Error('未启用边仍应阻断');
    expect(disabled.reason).toBe('transition-disabled');
  });

  it('USER LOCK 的 X07、X16 带确认键重提仍是 409', () => {
    for (const code of ['X07', 'X16'] as const) {
      const row = ILLEGAL_MIGRATIONS.find((item) => item.id === code);
      const decision = decideTransition({
        operation: { kind: 'transition', transitionId: 'T01' },
        subject: ready,
        advisories: [{
          level: 'block',
          code,
          message: row?.summary ?? code,
          authority: 'normative',
          userLock: row?.userLock,
        }],
        confirmedRuleKeys: [code, 'NO-SUCH'],
      });
      expect(decision.ok).toBe(false);
      if (decision.ok || decision.level !== 'block') throw new Error(`${code} 不得被确认绕过`);
      expect(decision.httpStatus).toBe(409);
      expect(decision.reason).toBe(code);
    }
  });
});
