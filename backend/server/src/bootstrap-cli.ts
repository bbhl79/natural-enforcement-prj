// 生产引导命令的命令行层（#131）：读参数、读口令文件、把结果写成人读的输出和退出码。
// 本文件不连库，unit 层可测。连库与写入在 bootstrap-command.ts（经 persistence.module.ts 装配）。
// 口令只从挂载文件或 secret 读入：命令行带口令一律拒绝；任何报错都不回显口令。

import type {
  BootstrapDifference,
  BootstrapInputRule,
  BootstrapOutcome,
  BootstrapProfile,
} from '@natural-enforcement/identity';

/** 退出码（工程定）：0 已写入或已引导；1 运行出错；2 参数或输入不合规；3 两键不全，拒绝执行。 */
export const BOOTSTRAP_EXIT = { ok: 0, error: 1, invalid: 2, incomplete: 3 } as const;

export const BOOTSTRAP_USAGE = [
  '用法：node --import /work/backend/server/register.mjs /work/backend/server/src/bootstrap-command.ts \\',
  '  --root-code <根机构编码> --root-name <根机构名称> \\',
  '  --admin-code <首个系统管理人员工号> --admin-name <姓名> --admin-mobile <手机号>',
  '口令只从 BOOTSTRAP_PASSWORD_FILE 指向的挂载文件或 secret 读入，不经命令行或环境变量传值。',
  '执行顺序：迁移 → 参照种子 → 引导。只在上线时执行一次，不进部署流水线。',
].join('\n');

const FLAGS = {
  '--root-code': 'rootCode',
  '--root-name': 'rootName',
  '--admin-code': 'adminCode',
  '--admin-name': 'adminName',
  '--admin-mobile': 'adminMobilePhone',
} as const satisfies Record<string, keyof BootstrapProfile>;

type Flag = keyof typeof FLAGS;

function isFlag(name: string): name is Flag {
  return Object.hasOwn(FLAGS, name);
}

export type ParsedArgs =
  | { ok: true; profile: BootstrapProfile }
  | { ok: false; problems: string[] };

/** 解析命令行。支持 `--flag value` 与 `--flag=value`。值去掉首尾空白。 */
export function parseBootstrapArgs(argv: readonly string[]): ParsedArgs {
  const values: Partial<Record<keyof BootstrapProfile, string>> = {};
  const problems: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    const eq = arg.indexOf('=');
    const name = eq >= 0 ? arg.slice(0, eq) : arg;
    if (/password|passwd|口令|密码/i.test(name)) {
      // 不回显这一项及其值。
      problems.push('口令不经命令行传入：只从 BOOTSTRAP_PASSWORD_FILE 指向的挂载文件或 secret 读入');
      if (eq < 0) index += 1;
      continue;
    }
    if (!name.startsWith('--')) {
      // 位置参数可能是误放的口令：不回显取值。
      problems.push(`多余的位置参数（第 ${index + 1} 个，不回显取值）`);
      continue;
    }
    if (!isFlag(name)) {
      problems.push(`不认识的参数：${name}`);
      continue;
    }
    let value: string | undefined;
    if (eq >= 0) {
      value = arg.slice(eq + 1);
    } else {
      value = argv[index + 1];
      index += 1;
    }
    if (value === undefined) {
      problems.push(`参数 ${name} 缺少取值`);
      continue;
    }
    const key = FLAGS[name];
    if (values[key] !== undefined) problems.push(`参数 ${name} 重复`);
    values[key] = value.trim();
  }
  for (const [flag, key] of Object.entries(FLAGS)) {
    if (values[key] === undefined) problems.push(`缺少参数 ${flag}`);
  }
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, profile: values as BootstrapProfile };
}

export type PasswordFileRead =
  | { ok: true; password: string }
  | { ok: false; problem: string };

/**
 * 读口令文件。只去掉末尾一个换行（\n 或 \r\n），其余原样作为口令。
 * 报错只写路径和原因，不写文件内容。
 */
export async function readBootstrapPassword(
  path: string,
  readFile: (path: string) => Promise<string>,
): Promise<PasswordFileRead> {
  let content: string;
  try {
    content = await readFile(path);
  } catch {
    return { ok: false, problem: `读不到口令文件 ${path}（不存在、不是文件或无权读取）` };
  }
  const password = content.replace(/\r?\n$/, '');
  if (password === '') return { ok: false, problem: `口令文件 ${path} 是空的` };
  if (/[\r\n]/.test(password)) return { ok: false, problem: `口令文件 ${path} 有多行：只放一行口令` };
  return { ok: true, password };
}

const RULE_TEXT: Record<BootstrapInputRule, string> = {
  'root-code-required': '根机构编码不能为空',
  'root-code-too-long': '根机构编码超过 64 字',
  'root-name-required': '根机构名称不能为空',
  'root-name-too-long': '根机构名称超过 100 字',
  'admin-code-required': '首个系统管理人员的工号不能为空',
  'admin-code-too-long': '首个系统管理人员的工号超过 64 字',
  'admin-name-required': '首个系统管理人员的姓名不能为空',
  'admin-name-too-long': '首个系统管理人员的姓名超过 100 字',
  'admin-mobile-invalid': '首个系统管理人员的手机号须为 11 位数字、以 1 开头',
  'password-too-short': '口令少于 10 位',
  'password-too-long': '口令超过 64 位',
  'password-insufficient-classes': '口令须含大写字母、小写字母、数字、特殊字符中的至少 3 类',
  'password-sequential': '口令含 4 位及以上连续的数字或字母',
  'password-repeated': '口令含 4 位及以上重复的字符',
  'password-common': '口令是常见弱口令',
  'password-contains-code': '口令含有工号',
  'password-same-as-current': '口令与当前口令相同',
};

export function describeInputRules(rules: readonly BootstrapInputRule[]): string[] {
  return [
    '引导被拒：输入不合规，未写入。',
    ...rules.map((rule) => `- ${RULE_TEXT[rule]}（${rule}）`),
  ];
}

function describeDifference(difference: BootstrapDifference): string {
  switch (difference.kind) {
    case 'root-missing':
      return `- 根机构编码 ${difference.rootCode} 不存在（root-missing）`;
    case 'root-not-root':
      return `- 编码为 ${difference.rootCode} 的机构有上级，不是根机构（root-not-root）`;
    case 'admin-missing':
      return `- 工号 ${difference.adminCode} 的人员不存在（admin-missing）`;
    case 'not-empty':
      return `- 库非空：已有 ${difference.orgUnits} 个机构、${difference.personnel} 名人员（not-empty）`;
  }
}

export interface BootstrapReport {
  exitCode: number;
  stdout: string[];
  stderr: string[];
}

/** 判定结果 → 输出与退出码。输出只含编码、工号、条数，不含口令、手机号。 */
export function reportOutcome(profile: BootstrapProfile, outcome: BootstrapOutcome): BootstrapReport {
  switch (outcome.result) {
    case 'bootstrapped':
      return {
        exitCode: BOOTSTRAP_EXIT.ok,
        stdout: [
          `引导完成：已建根机构 ${profile.rootCode}（层级：市）和首个系统管理人员 ${profile.adminCode}，写入两行留痕。`,
          '首个系统管理人员首次登录须改口令。',
        ],
        stderr: [],
      };
    case 'already-bootstrapped':
      return {
        exitCode: BOOTSTRAP_EXIT.ok,
        stdout: [`已引导：根机构 ${profile.rootCode} 与首个系统管理人员 ${profile.adminCode} 都已存在，未写入。`],
        stderr: [],
      };
    case 'incomplete':
      return {
        exitCode: BOOTSTRAP_EXIT.incomplete,
        stdout: [],
        stderr: [
          '引导被拒：根机构与首个系统管理人员不齐，未写入。差异：',
          ...outcome.differences.map(describeDifference),
        ],
      };
  }
}

/** 报错信息里若混进口令，替换掉（兜底；正常路径口令只以散列进入数据库）。 */
export function scrubSecret(message: string, secret: string | null): string {
  if (!secret) return message;
  return message.split(secret).join('***');
}
