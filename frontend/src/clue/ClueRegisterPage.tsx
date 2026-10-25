// 线索登记页（#211；规格 E）。
//
// 三层叠加的录入要件按后端声明渲染（ADR 0018）：公共层、来源层、类型层。
// 枚举、分类与布尔类字段用规范选择控件（取值从声明的要件名里读，读不出才用文本）。
// 公共层与来源层阻断项缺失时表单标红并保留已填内容；类型层缺件先给清单，确认后仍可保存。
// 几何来源文件与普通附件随表单一次提交（multipart）。

import { Suspense, useState, type ChangeEvent, type ReactNode } from 'react';
import { Await, Link, useAsyncError, useLoaderData, useRevalidator, useSearchParams } from 'react-router';

import { useAppDispatch, useAppSelector } from '../hooks';
import { ErrorCard } from '../shell/StatusPages';
import {
  CLUE_REGISTER,
  DOMAIN_LABEL,
  isTypeLayerKey,
  loadReference,
  loadFormSchema,
  newIdempotencyKey,
  optionsOf,
  splitRules,
  submitRegistration,
  type ClueReference,
  type FormSchema,
  type FormSchemaItem,
  type RegisterBody,
  type RegisterInput,
} from './registration';

export const EMPTY_REGISTER_INPUT: RegisterInput = {
  sourceCode: '',
  domain: '',
  types: [],
  tags: [],
  subjectUnknown: false,
  anonymityConfirmed: false,
  confirm: false,
  values: {},
  attachments: [],
  spatialSource: null,
};

/** 已在顶部卡片渲染的要件：分组里不再重复渲染。 */
const TOP_LEVEL_KEYS: ReadonlySet<string> = new Set(['clue.source', 'clue.domain', 'clue.initial_types']);

/** 保存失败：状态码与校验码（缺件键）。 */
export interface RegisterFailure {
  readonly status: number;
  readonly rules: readonly string[];
}

function Crumb() {
  return (
    <div className="crumb">
      线索中心 / <Link to="/clue">线索</Link> / <b>线索登记</b>
    </div>
  );
}

/** 依据栏：文件编号与条号（ADR 0019），另有实务类说明。 */
function basisOf(item: FormSchemaItem): ReactNode {
  if (item.basis.length === 0 && !item.basisNote) return null;
  return (
    <div className="help">
      {item.basis.map((entry) => `${entry.documentName}（${entry.article}）`).join('；')}
      {item.basisNote ? `　${item.basisNote}` : ''}
    </div>
  );
}

/**
 * 录入表单（纯渲染，单测直接渲染）。
 * 缺件键在 rules 里即标红；类型层缺件另给清单，确认后可保存。
 */
export function ClueRegisterForm({
  reference,
  schema,
  input,
  failure,
  busy,
  result,
  onInput,
  onSubmit,
  onSourceChange,
  onDomainChange,
  onTypesChange,
}: {
  reference: ClueReference;
  schema: FormSchema;
  input: RegisterInput;
  failure: RegisterFailure | null;
  busy: boolean;
  result: RegisterBody | null;
  onInput: (next: RegisterInput) => void;
  onSubmit: (confirm: boolean) => void;
  onSourceChange: (sourceCode: string) => void;
  onDomainChange: (domain: string) => void;
  onTypesChange: (types: string[]) => void;
}) {
  const rules = failure?.rules ?? [];
  const blocking = new Set(splitRules(rules).blocking);
  const typeGaps = splitRules(rules).typeGaps;
  const value = (key: string) => input.values[key] ?? '';
  const setValue = (key: string, next: string) =>
    onInput({ ...input, values: { ...input.values, [key]: next } });
  const errorOf = (key: string) => (blocking.has(key) ? '这一项必填，保存前请补上。' : null);

  const control = (item: FormSchemaItem): ReactNode => {
    const options = optionsOf(item);
    const id = `clue-${item.key.replace(/[^a-z0-9]+/gi, '-')}`;
    const common = {
      id,
      className: options ? 'select' : 'input',
      value: value(item.key),
      onChange: (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
        setValue(item.key, event.target.value),
    };
    if (item.key === 'clue.location') {
      return (
        <input
          id={id}
          type="file"
          accept=".geojson,application/geo+json,application/json"
          data-role="spatial-source"
          onChange={(event) => {
            const file = event.target.files?.[0] ?? null;
            onInput({ ...input, spatialSource: file });
          }}
        />
      );
    }
    if (item.key === 'clue.materials') {
      return (
        <input
          id={id}
          type="file"
          multiple
          accept=".jpg,.jpeg,.png,.pdf,.doc,.docx,.xls,.xlsx"
          data-role="attachment"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            onInput({ ...input, attachments: files });
          }}
        />
      );
    }
    if (item.key === 'clue.tags') {
      return (
        <input
          id={id}
          className="input"
          value={input.tags.join('，')}
          onChange={(event) =>
            onInput({
              ...input,
              tags: event.target.value
                .split(/[,，]/)
                .map((tag) => tag.trim())
                .filter((tag) => tag !== ''),
            })
          }
        />
      );
    }
    if (item.key === 'clue.received_at') {
      return <input {...common} type="date" />;
    }
    if (item.key === 'clue.narrative') {
      return (
        <textarea
          id={id}
          className="input"
          rows={3}
          value={value(item.key)}
          onChange={(event) => setValue(item.key, event.target.value)}
        />
      );
    }
    if (options) {
      return (
        <select {...common}>
          <option value="">请选择</option>
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
    }
    return <input {...common} />;
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(false);
      }}
      noValidate
    >
      {result ? (
        <div className="banner ok" data-role="registered">
          {`登记成功：编号 ${result.code}，状态 ${result.status}。`}
          {result.gaps.length > 0 ? (
            <div>{`还有 ${result.gaps.length} 项要件待补齐：${result.gaps.map((gap) => gap.label).join('、')}`}</div>
          ) : null}
          <div className="checks" style={{ marginTop: 8 }}>
            <Link className="btn btn-sm" to={`/workbench?step=2&clue=${result.id}`}>进入内业核查</Link>
            <Link className="btn btn-sm" to={`/workbench?step=3&clue=${result.id}`}>进入分派决定</Link>
          </div>
        </div>
      ) : null}
      {failure && failure.status !== 400 ? (
        <div className="banner danger" data-role="failure">
          {failure.status === 409
            ? '同一枚幂等键已经登记过别的内容，请刷新页面后重新登记。'
            : `保存未通过（${failure.status}），请检查后重试。`}
        </div>
      ) : null}
      {blocking.size > 0 ? (
        <div className="banner danger" data-role="blocking">
          {`还有 ${blocking.size} 项必填要件没填，标红的项补上后再保存。已填的内容都还在。`}
        </div>
      ) : null}
      {typeGaps.length > 0 ? (
        <div className="banner amber" data-role="type-gaps">
          <div>{`类型层还有 ${typeGaps.length} 项要件没填：${typeGaps.map((key) => key).join('、')}`}</div>
          <div>确认后仍可保存，这几项会成为常驻缺件，之后在详情里补齐。</div>
          <button type="button" className="btn btn-primary" data-role="confirm-save" disabled={busy} onClick={() => onSubmit(true)}>
            确认并保存
          </button>
        </div>
      ) : null}
      <div className="card">
        <div className="card-h">线索来源与法域</div>
        <div className="form-row">
          <label htmlFor="clue-source">线索来源</label>
          <div>
            <select
              id="clue-source"
              className="select"
              value={input.sourceCode}
              onChange={(event) => onSourceChange(event.target.value)}
            >
              <option value="">请选择线索来源</option>
              {reference.sources.map((source) => (
                <option key={source.code} value={source.code}>
                  {`${source.name}（${source.code}）`}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="form-row">
          <label htmlFor="clue-domain">法域</label>
          <div>
            <select
              id="clue-domain"
              className="select"
              value={input.domain}
              onChange={(event) => onDomainChange(event.target.value)}
            >
              <option value="">请选择法域</option>
              {(Object.keys(DOMAIN_LABEL) as (keyof typeof DOMAIN_LABEL)[]).map((domain) => (
                <option key={domain} value={domain}>
                  {DOMAIN_LABEL[domain]}
                </option>
              ))}
            </select>
            <div className="help">土地与矿产录面状几何。测绘与规划录点位：一条线索只对应一个点位，一个文件多个点或点面混合一律拒绝。</div>
          </div>
        </div>
        <div className="form-row" data-key="clue.initial_types">
          <label>初步涉嫌违法类型</label>
          <div>
            <div className="checks">
              {reference.types
                .filter((type) => input.domain === '' || type.domain === input.domain)
                .map((type) => (
                  <label key={type.code}>
                    <input
                      type="checkbox"
                      data-type={type.code}
                      checked={input.types.includes(type.code)}
                      onChange={(event) => {
                        const next = event.target.checked
                          ? [...input.types, type.code]
                          : input.types.filter((code) => code !== type.code);
                        onTypesChange(next);
                      }}
                    />
                    {` ${type.name}（${type.code}）`}
                  </label>
                ))}
            </div>
            <div className="help">可留空，可多选。选了哪些类型，类型层就叠加哪些要件。</div>
          </div>
        </div>
      </div>
      {schema.groups.map((group) => (
        <div className="card" key={group.name} data-group={group.name}>
          <div className="card-h">{group.name}</div>
          {group.items.filter((item) => !TOP_LEVEL_KEYS.has(item.key)).map((item) => {
            const error = errorOf(item.key);
            return (
              <div className="form-row" key={item.key} data-key={item.key}>
                <label htmlFor={`clue-${item.key.replace(/[^a-z0-9]+/gi, '-')}`}>
                  {item.label}
                  {item.required ? <span className="req">*</span> : null}
                </label>
                <div>
                  {control(item)}
                  {error ? <div className="err" data-error={item.key}>{error}</div> : null}
                  {item.condition ? <div className="help">{item.condition}</div> : null}
                  {isTypeLayerKey(item.key) ? (
                    <div className="help">类型层要件：缺项不拦登记，确认后保存并留作常驻缺件。</div>
                  ) : null}
                  {basisOf(item)}
                </div>
              </div>
            );
          })}
        </div>
      ))}
      <div className="card">
        <div className="card-h">当事人不明与匿名提示</div>
        <div className="form-row">
          <label htmlFor="clue-subject-unknown">
            当事人不明
          </label>
          <div>
            <select
              id="clue-subject-unknown"
              className="select"
              value={input.subjectUnknown ? '是' : '否'}
              onChange={(event) => onInput({ ...input, subjectUnknown: event.target.value === '是' })}
            >
              <option value="否">否</option>
              <option value="是">是</option>
            </select>
            <div className="help">当事人不明不妨碍登记与分派。</div>
          </div>
        </div>
        <div className="form-row">
          <label htmlFor="clue-anonymity-confirmed">
            匿名附件已移除反映人身份信息
          </label>
          <div>
            <select
              id="clue-anonymity-confirmed"
              className="select"
              value={input.anonymityConfirmed ? '是' : '否'}
              onChange={(event) => onInput({ ...input, anonymityConfirmed: event.target.value === '是' })}
            >
              <option value="否">否</option>
              <option value="是">是</option>
            </select>
            <div className="help">匿名线索带附件时须主动确认已移除反映人身份信息。</div>
          </div>
        </div>
        <div className="actions">
          <Link className="btn" to="/clue">取消</Link>
          <button type="submit" className="btn btn-primary" data-requires={CLUE_REGISTER} disabled={busy}>
            保存
          </button>
        </div>
      </div>
    </form>
  );
}

/** 表单状态与提交（容器）。 */
function RegisterForm({
  reference,
  schema,
  onSourceChange,
  onDomainChange,
  onTypesChange,
}: {
  reference: ClueReference;
  schema: FormSchema;
  onSourceChange: (sourceCode: string) => void;
  onDomainChange: (domain: string) => void;
  onTypesChange: (types: string[]) => void;
}) {
  const dispatch = useAppDispatch();
  const [input, setInput] = useState<RegisterInput>(EMPTY_REGISTER_INPUT);
  const [failure, setFailure] = useState<RegisterFailure | null>(null);
  const [result, setResult] = useState<RegisterBody | null>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(newIdempotencyKey());

  const change = (next: RegisterInput) => {
    setInput(next);
    // 报文变了就换一枚幂等键：同一份报文的重复提交仍走同一枚，改过内容后重提是新的一次登记。
    setKey(newIdempotencyKey());
  };
  const submit = async (confirm: boolean) => {
    setBusy(true);
    const outcome = await submitRegistration(dispatch, { ...input, confirm }, key);
    setBusy(false);
    if (outcome.ok) {
      setFailure(null);
      setResult(outcome.body);
      return;
    }
    setResult(null);
    setFailure({ status: outcome.status, rules: outcome.rules });
  };

  return (
    <ClueRegisterForm
      reference={reference}
      schema={schema}
      input={input}
      failure={failure}
      busy={busy}
      result={result}
      onInput={change}
      onSubmit={(confirm) => void submit(confirm)}
      onSourceChange={(sourceCode) => {
        onSourceChange(sourceCode);
        change({ ...input, sourceCode });
      }}
      onDomainChange={(domain) => {
        onDomainChange(domain);
        change({ ...input, domain });
      }}
      onTypesChange={(types) => {
        onTypesChange(types);
        change({ ...input, types });
      }}
    />
  );
}

function LoadError({ what }: { what: string }) {
  useAsyncError();
  const revalidator = useRevalidator();
  return <ErrorCard what={what} onRetry={() => void revalidator.revalidate()} />;
}

/** 线索登记（#211）。来源、法域与类型在地址里；其余内容在本页内存里。 */
export default function ClueRegisterPage() {
  const { reference, schema } = useLoaderData() as {
    reference: Promise<ClueReference>;
    schema: Promise<FormSchema | null>;
  };
  const [params, setParams] = useSearchParams();
  const opcodes = useAppSelector((root) => root.login.operator?.opcodes ?? []);
  const update = (next: Record<string, string>) => {
    const merged = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value === '') merged.delete(key);
      else merged.set(key, value);
    }
    setParams(merged, { replace: true });
  };
  if (!opcodes.includes(CLUE_REGISTER)) {
    return (
      <>
        <Crumb />
        <div className="card">
          <div className="empty">
            <div className="t">没有登记线索的权限</div>
            <div>线索登记只给内勤与经办。是否放行由服务端判定。</div>
          </div>
        </div>
      </>
    );
  }
  return (
    <>
      <Crumb />
      <div className="page-h">
        <div>
          <h1>线索登记</h1>
          <div className="desc">
            表单与随附材料一次提交。带 <span className="req">*</span> 的为必填；公共层与来源层缺项拦登记，类型层缺项确认后可保存。
          </div>
        </div>
      </div>
      <Suspense fallback={<div className="card" aria-busy="true">载入中…</div>}>
        <Await resolve={reference} errorElement={<LoadError what="参照清单" />}>
          {(resolvedReference: ClueReference) => (
            <Await resolve={schema} errorElement={<LoadError what="录入要件" />}>
              {(resolvedSchema: FormSchema | null) =>
                resolvedSchema === null ? (
                  <div className="card">
                    <div className="empty">
                      <div className="t">先选线索来源与法域</div>
                      <div>选定后按来源与法域叠加录入要件，公共层、来源层与类型层一并呈现。</div>
                    </div>
                  </div>
                ) : (
                  <RegisterForm
                    reference={resolvedReference}
                    schema={resolvedSchema}
                    onSourceChange={(value) => update({ sourceCode: value })}
                    onDomainChange={(value) => update({ domain: value })}
                    onTypesChange={(values) => update({ types: values.join(',') })}
                  />
                )
              }
            </Await>
          )}
        </Await>
      </Suspense>
    </>
  );
}

export { isTypeLayerKey, loadReference, loadFormSchema };
