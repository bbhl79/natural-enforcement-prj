// 生产引导命令的命令行层（#131）：参数、口令文件、输出与退出码。不连库。
import { describe, expect, it } from 'vitest';

import {
  BOOTSTRAP_EXIT,
  describeInputRules,
  parseBootstrapArgs,
  readBootstrapPassword,
  reportOutcome,
  scrubSecret,
} from './bootstrap-cli.ts';

const argv = [
  '--root-code', 'ORG-GZ',
  '--root-name', ' 市局 ',
  '--admin-code=SJ0001',
  '--admin-name', '首个管理',
  '--admin-mobile', '13900000001',
];
const profile = { rootCode: 'ORG-GZ', rootName: '市局', adminCode: 'SJ0001', adminName: '首个管理', adminMobilePhone: '13900000001' };
const SECRET = 'Boot-strap-27x';

describe('参数', () => {
  it('五项齐全：两种写法都认，值去掉首尾空白', () => {
    expect(parseBootstrapArgs(argv)).toEqual({ ok: true, profile });
  });

  it('缺项、重复、不认识的参数都列出', () => {
    const parsed = parseBootstrapArgs(['--root-code', 'A', '--root-code', 'B', '--level', 'city']);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.problems).toEqual([
      '参数 --root-code 重复',
      '不认识的参数：--level',
      '多余的位置参数（第 6 个，不回显取值）',
      '缺少参数 --root-name',
      '缺少参数 --admin-code',
      '缺少参数 --admin-name',
      '缺少参数 --admin-mobile',
    ]);
  });

  it('命令行带口令一律拒绝，报错不回显口令', () => {
    expect(JSON.stringify(parseBootstrapArgs([...argv, '--password', SECRET]))).toContain('口令不经命令行传入');
    for (const extra of [['--password', SECRET], [`--password=${SECRET}`], ['--admin-password', SECRET], [SECRET]]) {
      const parsed = parseBootstrapArgs([...argv, ...extra]);
      expect(parsed.ok).toBe(false);
      expect(JSON.stringify(parsed)).not.toContain(SECRET);
    }
  });
});

describe('口令文件', () => {
  it('只去掉末尾一个换行', async () => {
    expect(await readBootstrapPassword('/run/secrets/p', async () => `${SECRET}\r\n`)).toEqual({ ok: true, password: SECRET });
    expect(await readBootstrapPassword('/run/secrets/p', async () => ` ${SECRET}`)).toEqual({ ok: true, password: ` ${SECRET}` });
  });

  it('读不到、空、多行：报路径和原因，不回显内容', async () => {
    const missing = await readBootstrapPassword('/run/secrets/p', async () => {
      throw new Error(`ENOENT ${SECRET}`);
    });
    expect(missing).toEqual({ ok: false, problem: '读不到口令文件 /run/secrets/p（不存在、不是文件或无权读取）' });
    expect(await readBootstrapPassword('/p', async () => '\n')).toEqual({ ok: false, problem: '口令文件 /p 是空的' });
    const multi = await readBootstrapPassword('/p', async () => `${SECRET}\nsecond\n`);
    expect(multi.ok).toBe(false);
    expect(JSON.stringify(multi)).not.toContain(SECRET);
  });
});

describe('输出与退出码', () => {
  it('写入：退出码 0，输出编码和工号，不含手机号', () => {
    const report = reportOutcome(profile, { result: 'bootstrapped', rootOrgUnitId: 'r', adminPersonnelId: 'a' });
    expect(report.exitCode).toBe(BOOTSTRAP_EXIT.ok);
    expect(report.stdout.join('\n')).toContain('引导完成');
    expect(report.stdout.join('\n')).not.toContain('13900000001');
  });

  it('两键都在：退出码 0，输出「已引导」', () => {
    const report = reportOutcome(profile, { result: 'already-bootstrapped', rootOrgUnitId: 'r', adminPersonnelId: 'a' });
    expect(report.exitCode).toBe(0);
    expect(report.stdout.join('\n')).toContain('已引导');
  });

  it('两键不全：非 0 退出，逐条输出差异', () => {
    const report = reportOutcome(profile, {
      result: 'incomplete',
      differences: [
        { kind: 'root-missing', rootCode: 'ORG-GZ' },
        { kind: 'root-not-root', rootCode: 'ORG-GZ' },
        { kind: 'admin-missing', adminCode: 'SJ0001' },
        { kind: 'not-empty', orgUnits: 4, personnel: 12 },
      ],
    });
    expect(report.exitCode).toBe(BOOTSTRAP_EXIT.incomplete);
    expect(report.exitCode).not.toBe(0);
    expect(report.stderr).toEqual([
      '引导被拒：根机构与首个系统管理人员不齐，未写入。差异：',
      '- 根机构编码 ORG-GZ 不存在（root-missing）',
      '- 编码为 ORG-GZ 的机构有上级，不是根机构（root-not-root）',
      '- 工号 SJ0001 的人员不存在（admin-missing）',
      '- 库非空：已有 4 个机构、12 名人员（not-empty）',
    ]);
  });

  it('输入不合规只给规则说明', () => {
    expect(describeInputRules(['admin-mobile-invalid', 'password-too-short'])).toEqual([
      '引导被拒：输入不合规，未写入。',
      '- 首个系统管理人员的手机号须为 11 位数字、以 1 开头（admin-mobile-invalid）',
      '- 口令少于 10 位（password-too-short）',
    ]);
  });

  it('报错兜底：混进的口令替换掉', () => {
    expect(scrubSecret(`x ${SECRET} y ${SECRET}`, SECRET)).toBe('x *** y ***');
    expect(scrubSecret('x', null)).toBe('x');
  });
});
