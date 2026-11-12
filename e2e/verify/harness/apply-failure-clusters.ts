// 用途：执行失败聚类动作计划，经 gh CLI 对票做创建、评论或重开。
// GitHub 动作层（spec #322 二期 T6 / 票 #328）：执行 cluster-failures.ts 产出的动作计划。
// 本文件在 discover/ 之外：discover/ 模块零 I/O，gh 调用与证据读取都在这里。
// 真实实现走 gh CLI；测试注入内存 fake（见 integration/verify-discover-cluster.test.ts），不触网。
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  planClusterActions,
  type ExistingIssue,
  type FailureCluster,
} from './discover/cluster-failures.ts';

const execFileAsync = promisify(execFile);

/** gh 执行端口：可注入，测试用 fake。 */
export interface GhPort {
  list(state: 'open' | 'closed'): Promise<ExistingIssue[]>;
  create(input: {
    title: string;
    body: string;
    labels: readonly string[];
  }): Promise<{ number: number; url: string }>;
  comment(issueNumber: number, body: string): Promise<void>;
  reopen(issueNumber: number, comment: string): Promise<void>;
}

/** 一条动作的执行结果。 */
export interface AppliedClusterAction {
  readonly key: string;
  readonly action: 'create' | 'comment' | 'reopen';
  readonly issueNumber: number;
  readonly url?: string;
}

/** createGhCliPort 的选项：gh 工作目录。 */
export interface GhCliPortOptions {
  /** gh 工作目录；缺省沿用当前进程 cwd。 */
  readonly cwd?: string;
}

async function runGh(args: readonly string[], cwd?: string): Promise<string> {
  try {
    const result = await execFileAsync('gh', [...args], {
      ...(cwd !== undefined ? { cwd } : {}),
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    return String(result.stdout);
  } catch (error) {
    const failure = error as { stderr?: string; message?: string };
    const detail = failure.stderr?.trim() || failure.message || String(error);
    throw new Error(`gh ${args.slice(0, 2).join(' ')} 失败：${detail}`);
  }
}

function toIssue(raw: unknown): ExistingIssue | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const number = record.number;
  const state = record.state;
  const body = record.body;
  if (typeof number !== 'number') return null;
  if (state !== 'OPEN' && state !== 'open' && state !== 'CLOSED' && state !== 'closed') return null;
  if (typeof body !== 'string') return null;
  const closedAt = record.closedAt;
  return {
    number,
    state: state === 'OPEN' || state === 'open' ? 'open' : 'closed',
    body,
    closedAt: typeof closedAt === 'string' ? closedAt : null,
  };
}

/** 真实 gh CLI 端口。只调用 issue list/create/comment/reopen，不建 PR、不改标签。 */
export function createGhCliPort(options: GhCliPortOptions = {}): GhPort {
  return {
    async list(state) {
      const stdout = await runGh(
        ['issue', 'list', '--state', state, '--limit', '500', '--json', 'number,state,body,closedAt'],
        options.cwd,
      );
      const parsed: unknown = JSON.parse(stdout);
      if (!Array.isArray(parsed)) return [];
      return parsed.flatMap((raw) => {
        const issue = toIssue(raw);
        return issue === null ? [] : [issue];
      });
    },

    async create(input) {
      const args = ['issue', 'create', '--title', input.title, '--body', input.body];
      for (const label of input.labels) args.push('--label', label);
      const stdout = await runGh(args, options.cwd);
      const url = stdout
        .trim()
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '')
        .at(-1);
      const number = Number(/\/issues\/(\d+)\s*$/.exec(url ?? '')?.[1]);
      if (!Number.isInteger(number)) throw new Error(`gh issue create 未能解析票号：${stdout}`);
      return { number, url: url ?? '' };
    },

    async comment(issueNumber, body) {
      await runGh(['issue', 'comment', String(issueNumber), '--body', body], options.cwd);
    },

    async reopen(issueNumber, comment) {
      await runGh(
        ['issue', 'reopen', String(issueNumber), '--comment', comment],
        options.cwd,
      );
    },
  };
}

/**
 * 执行失败聚类动作：读取开放/关闭票 → 计划 → 依次 create/comment/reopen。
 * 返回每个簇的动作与票号，调用方据此回传报告。
 */
export async function applyFailureClusters(
  clusters: readonly FailureCluster[],
  gh: GhPort,
): Promise<AppliedClusterAction[]> {
  const issues = [...(await gh.list('open')), ...(await gh.list('closed'))];
  const actions = planClusterActions(clusters, issues);
  const results: AppliedClusterAction[] = [];

  for (const action of actions) {
    if (action.action === 'create') {
      const created = await gh.create({
        title: action.title,
        body: action.body,
        labels: action.labels,
      });
      results.push({
        key: action.cluster.key,
        action: 'create',
        issueNumber: created.number,
        url: created.url,
      });
    } else if (action.action === 'comment') {
      await gh.comment(action.issueNumber, action.body);
      results.push({
        key: action.cluster.key,
        action: 'comment',
        issueNumber: action.issueNumber,
      });
    } else {
      await gh.reopen(action.issueNumber, action.comment);
      results.push({
        key: action.cluster.key,
        action: 'reopen',
        issueNumber: action.issueNumber,
      });
    }
  }

  return results;
}
