// 线索登记页（#211；规格 E；#296 R1）。
//
// 登记页一进入即是完整表单：来源* 与法域* 置顶且初始为空，下拉含「请选择…」。
// 要件按后端声明渲染（ADR 0018）：基本信息、来源补充、违法类型、材料四分区；
// 来源未选时「来源补充」只给一行提示，法域未选时「违法类型」只给一行提示。
// 枚举、分类与布尔类字段用规范选择控件（取值从声明的要件名里读，读不出才用文本）。
// 基本信息与来源补充阻断项缺失时表单标红并保留已填内容；违法类型缺件先给清单，确认后仍可保存。
// 几何来源文件与普通附件随表单一次提交（multipart）。

import { useEffect, useState, type ChangeEvent, type ReactNode } from 'react';
import { Link, useLoaderData, useSearchParams } from 'react-router';

import { useAppDispatch, useAppSelector } from '../hooks';
import {
  CLUE_REGISTER,
  DOMAIN_LABEL,
  isTypeLayerKey,
  loadReference,
  loadFormSchema,
  newIdempotencyKey,
  optionsOf,
  registerInputFromQuery,
  registerStepPath,
  splitRules,
  submitRegistration,
  type ClueReference,
  type FormSchema,
  type FormSchemaItem,
  type RegisterBody,
  type RegisterInput,
} from './registration';

/** 新办初始值：来源与法域都不预填（尤其不预填「土地」）。 */
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

/** 已在基本信息分区手工渲染的要件：分区里不再重复渲染。 */
const TOP_LEVEL_KEYS: ReadonlySet<string> = new Set(['clue.source', 'clue.domain', 'clue.initial_types']);

/** 材料分区渲染的要件。 */
const MATERIAL_KEYS: ReadonlySet<string> = new Set(['clue.materials', 'clue.tags']);

/** 保存失败：状态码与校验码（缺件键）。 */
export interface RegisterFailure {
  readonly status: number;
  readonly rules: readonly string[];
}

function Crumb() {
  return (
    <div className="crumb">
      统一工作台 / <Link to="/workbench">工作台</Link> / <b>登记新线索</b>
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
 * 缺件键在 rules 里即标红；违法类型缺件另给清单，确认后可保存。
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
  // 来源或法域为空时服务端先回整体校验码，同样落到对应下拉上标红。
  const sourceError =
    blocking.has('clue.source') || blocking.has('source-code-invalid')
      ? '这一项必填，保存前请补上。'
      : null;
  const domainError =
    blocking.has('clue.domain') || blocking.has('domain-invalid')
      ? '这一项必填，保存前请补上。'
      : null;

  const sourceGroupNames = new Set(reference.sources.map((source) => source.group));
  const isSourceItem = (item: FormSchemaItem) => sourceGroupNames.has(item.group);
  const basicItems = schema.items.filter(
    (item) =>
      !TOP_LEVEL_KEYS.has(item.key) &&
      !MATERIAL_KEYS.has(item.key) &&
      !isTypeLayerKey(item.key) &&
      !isSourceItem(item),
  );
  const sourceSelected = input.sourceCode !== '';
  const domainSelected = input.domain !== '';
  // 换选择后新要件还在路上时，不把上一份声明的来源／类型要件挂在新选择下。
  const sourceMatches = sourceSelected && schema.source.code === input.sourceCode;
  const domainMatches = domainSelected && schema.domain === input.domain;
  const sourceItems = sourceMatches ? schema.items.filter(isSourceItem) : [];
  const typeItems = domainMatches ? schema.items.filter((item) => isTypeLayerKey(item.key)) : [];
  const materialItems = schema.items.filter((item) => MATERIAL_KEYS.has(item.key));
  const domainTypes = reference.types.filter((type) => type.domain === input.domain);

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

  const row = (item: FormSchemaItem) => {
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
            <div className="help">违法类型要件：缺项不拦登记，确认后保存并留作常驻缺件。</div>
          ) : null}
          {basisOf(item)}
        </div>
      </div>
    );
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
            <Link className="btn btn-sm" to={registerStepPath(2, result.id)}>进入内业核查</Link>
            <Link className="btn btn-sm" to={registerStepPath(3, result.id)}>进入分派决定</Link>
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
          <div>{`违法类型还有 ${typeGaps.length} 项要件没填：${typeGaps.map((key) => key).join('、')}`}</div>
          <div>确认后仍可保存，这几项会成为常驻缺件，之后在详情里补齐。</div>
          <button type="button" className="btn btn-primary" data-role="confirm-save" disabled={busy} onClick={() => onSubmit(true)}>
            确认并保存
          </button>
        </div>
      ) : null}
      <div className="card" data-group="基本信息">
        <div className="card-h">基本信息</div>
        <div className="form-row">
          <label htmlFor="clue-source">线索来源<span className="req">*</span></label>
          <div>
            <select
              id="clue-source"
              className="select"
              value={input.sourceCode}
              onChange={(event) => onSourceChange(event.target.value)}
            >
              <option value="">请选择…</option>
              {reference.sources.map((source) => (
                <option key={source.code} value={source.code}>
                  {`${source.name}（${source.code}）`}
                </option>
              ))}
            </select>
            {sourceError ? (
              <div className="err" data-error="clue.source">{sourceError}</div>
            ) : null}
          </div>
        </div>
        <div className="form-row">
          <label htmlFor="clue-domain">法域<span className="req">*</span></label>
          <div>
            <select
              id="clue-domain"
              className="select"
              value={input.domain}
              onChange={(event) => onDomainChange(event.target.value)}
            >
              <option value="">请选择…</option>
              {(Object.keys(DOMAIN_LABEL) as (keyof typeof DOMAIN_LABEL)[]).map((domain) => (
                <option key={domain} value={domain}>
                  {DOMAIN_LABEL[domain]}
                </option>
              ))}
            </select>
            {domainError ? (
              <div className="err" data-error="clue.domain">{domainError}</div>
            ) : null}
            <div className="help">土地与矿产录面状几何。测绘与规划录点位：一条线索只对应一个点位，一个文件多个点或点面混合一律拒绝。</div>
          </div>
        </div>
        {basicItems.map(row)}
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
      </div>
      <div className="card" data-group="来源补充">
        <div className="card-h">来源补充</div>
        {sourceSelected ? (
          sourceItems.length > 0 ? (
            sourceItems.map(row)
          ) : sourceMatches ? (
            <div className="help">所选来源没有额外要件。</div>
          ) : (
            <div className="help">载入来源补充…</div>
          )
        ) : (
          <div className="help" data-role="source-pending">请先选线索来源</div>
        )}
      </div>
      <div className="card" data-group="违法类型">
        <div className="card-h">违法类型</div>
        {domainSelected ? (
          <>
            <div className="form-row" data-key="clue.initial_types">
              <label>初步涉嫌违法类型</label>
              <div>
                <div className="checks">
                  {domainTypes.map((type) => (
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
                <div className="help">可留空，可多选。选了哪些类型，就叠加哪些违法类型要件。</div>
              </div>
            </div>
            {typeItems.map(row)}
          </>
        ) : (
          <div className="help" data-role="domain-pending">请先选法域</div>
        )}
      </div>
      <div className="card" data-group="材料">
        <div className="card-h">材料</div>
        {materialItems.map(row)}
      </div>
      <div className="actions" style={{ margin: '4px 0 12px' }}>
        <Link className="btn" to="/clue">取消</Link>
        <button type="submit" className="btn btn-primary" data-requires={CLUE_REGISTER} disabled={busy}>
          保存
        </button>
      </div>
    </form>
  );
}

/**
 * 登记新线索（#211；#296 R1）。来源、法域与类型在地址里；其余内容在本页内存里。
 * 首屏即完整表单；来源补充与违法类型按来源、法域的选中状态显隐。
 */
export default function ClueRegisterPage({ embedded = false }: { readonly embedded?: boolean }) {
  const { reference, schema } = useLoaderData() as {
    reference: ClueReference;
    schema: FormSchema;
  };
  const [params, setParams] = useSearchParams();
  const dispatch = useAppDispatch();
  const opcodes = useAppSelector((root) => root.login.operator?.opcodes ?? []);
  const [input, setInput] = useState<RegisterInput>(() => ({
    ...EMPTY_REGISTER_INPUT,
    ...registerInputFromQuery(params),
  }));
  const [failure, setFailure] = useState<RegisterFailure | null>(null);
  const [result, setResult] = useState<RegisterBody | null>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(newIdempotencyKey());
  const searchString = params.toString();

  // 地址是来源、法域与类型的唯一事实源；前进后退也回到地址里的选择。
  useEffect(() => {
    const next = registerInputFromQuery(new URLSearchParams(searchString));
    setInput((prev) =>
      prev.sourceCode === next.sourceCode &&
      prev.domain === next.domain &&
      prev.types.join(',') === next.types.join(',')
        ? prev
        : { ...prev, ...next },
    );
  }, [searchString]);

  // 依赖显隐后，已隐藏分区的取值不再随报文提交：只留当前声明里的要件键。
  useEffect(() => {
    const known = new Set(schema.items.map((item) => item.key));
    setInput((prev) => {
      const values = Object.fromEntries(
        Object.entries(prev.values).filter(([entryKey]) => known.has(entryKey)),
      );
      return Object.keys(values).length === Object.keys(prev.values).length
        ? prev
        : { ...prev, values };
    });
  }, [schema]);

  const update = (next: Record<string, string>) => {
    const merged = new URLSearchParams(params);
    for (const [entryKey, value] of Object.entries(next)) {
      if (value === '') merged.delete(entryKey);
      else merged.set(entryKey, value);
    }
    setParams(merged, { replace: true });
  };
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
  const form = () => (
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
        update({ sourceCode });
        change({ ...input, sourceCode });
      }}
      onDomainChange={(domain) => {
        // 违法类型按法域取值：换法域就清空已选类型，避免把别的法域的类型带过去。
        update({ domain, types: '' });
        change({ ...input, domain, types: [] });
      }}
      onTypesChange={(types) => {
        update({ types: types.join(',') });
        change({ ...input, types });
      }}
    />
  );

  if (!opcodes.includes(CLUE_REGISTER)) {
    return (
      <>
        {embedded ? null : <Crumb />}
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
      {embedded ? null : <Crumb />}
      {embedded ? null : (
        <div className="page-h">
          <div>
            <h1>登记新线索</h1>
            <div className="desc">
              表单与随附材料一次提交。带 <span className="req">*</span> 的为必填；基本信息与来源补充缺项拦登记，违法类型缺项确认后可保存。
            </div>
          </div>
        </div>
      )}
      {form()}
    </>
  );
}

export { isTypeLayerKey, loadReference, loadFormSchema };