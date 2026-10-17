// 生产引导命令入口（#105「生产引导命令（D5）」，#131）。在 server 镜像里执行：
//   node --import /work/backend/server/register.mjs /work/backend/server/src/bootstrap-command.ts \
//     --root-code <根机构编码> --root-name <名称> --admin-code <工号> --admin-name <姓名> --admin-mobile <手机号>
// 环境：DATABASE_URL；BOOTSTRAP_PASSWORD_FILE = 口令文件路径（挂载文件或 secret）。
// 执行顺序：迁移 → 参照种子 → 引导。只在上线时执行一次，不进部署流水线。没有 HTTP 入口。
// 根类型检查排除本文件（经 persistence.module.ts 引用生成客户端），由 integration 层编译。
import { readFile } from 'node:fs/promises';

import { BootstrapPrerequisiteError, bootstrapInputRules } from '@natural-enforcement/identity';

import {
  BOOTSTRAP_EXIT,
  BOOTSTRAP_USAGE,
  describeInputRules,
  parseBootstrapArgs,
  readBootstrapPassword,
  reportOutcome,
  scrubSecret,
} from './bootstrap-cli.ts';
import { openBootstrapRunner } from './persistence.module.ts';
import { BOOTSTRAP_REQUIRED_ENV, MissingRuntimeEnvError, readRequiredEnv } from './runtime-env.ts';

function print(lines: readonly string[], stream: NodeJS.WriteStream): void {
  if (lines.length > 0) stream.write(`${lines.join('\n')}\n`);
}

async function main(argv: readonly string[]): Promise<number> {
  let env: Record<(typeof BOOTSTRAP_REQUIRED_ENV)[number], string>;
  try {
    env = readRequiredEnv(process.env, BOOTSTRAP_REQUIRED_ENV);
  } catch (error) {
    if (error instanceof MissingRuntimeEnvError) {
      print([error.message.replace('启动失败', '引导失败')], process.stderr);
      return BOOTSTRAP_EXIT.invalid;
    }
    throw error;
  }

  const parsed = parseBootstrapArgs(argv);
  if (!parsed.ok) {
    print(['引导被拒：参数不合规，未写入。', ...parsed.problems.map((p) => `- ${p}`), BOOTSTRAP_USAGE], process.stderr);
    return BOOTSTRAP_EXIT.invalid;
  }
  const { profile } = parsed;

  const read = await readBootstrapPassword(env.BOOTSTRAP_PASSWORD_FILE, (path) => readFile(path, 'utf8'));
  if (!read.ok) {
    print(['引导被拒：未写入。', `- ${read.problem}`], process.stderr);
    return BOOTSTRAP_EXIT.invalid;
  }
  const password = read.password;

  try {
    const rules = bootstrapInputRules(profile, password);
    if (rules.length > 0) {
      print(describeInputRules(rules), process.stderr);
      return BOOTSTRAP_EXIT.invalid;
    }
    const runner = openBootstrapRunner(env.DATABASE_URL);
    try {
      const passwordHash = await runner.hashPassword(password);
      const outcome = await runner.run({ ...profile, passwordHash });
      const report = reportOutcome(profile, outcome);
      print(report.stdout, process.stdout);
      print(report.stderr, process.stderr);
      return report.exitCode;
    } finally {
      await runner.close();
    }
  } catch (error) {
    if (error instanceof BootstrapPrerequisiteError) {
      print([`引导失败：${error.message}`, '未写入。'], process.stderr);
      return BOOTSTRAP_EXIT.error;
    }
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    print([`引导失败，事务已回滚，未写入：${scrubSecret(message, password)}`], process.stderr);
    return BOOTSTRAP_EXIT.error;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    print([`引导失败：${error instanceof Error ? error.name : '未知错误'}`], process.stderr);
    process.exit(BOOTSTRAP_EXIT.error);
  },
);
