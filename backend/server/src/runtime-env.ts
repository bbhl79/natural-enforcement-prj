// 启动包读入的环境变量（ADR 0008、#80）。
// 名字登记在 infra/runtime.env。缺必填项时进程启动失败，并说明缺哪一项。
// 源码不内嵌第二套默认值。

/** 启动包启动时必须读到的环境变量。DATABASE_URL 由 dev 从清单分项算出。 */
export const SERVER_REQUIRED_ENV = ['DATABASE_URL'] as const;

export type ServerEnvName = (typeof SERVER_REQUIRED_ENV)[number];

/** 缺必填环境变量。missing 按登记顺序列出全部缺项。 */
export class MissingRuntimeEnvError extends Error {
  readonly missing: readonly string[];

  constructor(missing: readonly string[]) {
    super(`启动失败：缺少必填环境变量 ${missing.join('、')}（名字登记在 infra/runtime.env）`);
    this.name = 'MissingRuntimeEnvError';
    this.missing = missing;
  }
}

/** 读出全部必填项。空串按缺项处理。 */
export function readRequiredEnv<Name extends string>(
  env: Readonly<Record<string, string | undefined>>,
  names: readonly Name[],
): Record<Name, string> {
  const missing = names.filter((name) => !env[name]);
  if (missing.length > 0) throw new MissingRuntimeEnvError(missing);
  const values = {} as Record<Name, string>;
  for (const name of names) values[name] = env[name] as string;
  return values;
}
