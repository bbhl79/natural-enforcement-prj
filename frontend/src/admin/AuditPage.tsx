import { Suspense, useState } from 'react';
import { Await, Form, useAsyncError, useLoaderData, useLocation, useRevalidator } from 'react-router';

import { useAppDispatch, useAppSelector } from '../hooks';
import { DeniedCard, ErrorCard, errorStatus } from '../shell/StatusPages';
import { adminHomeView } from './adminHome';
import {
  AUDIT_EXPORT,
  AUDIT_READ,
  CATEGORY_HINTS,
  CATEGORY_OPTIONS,
  exportAudit,
  exportFilename,
  filterSummary,
  OUTCOME_OPTIONS,
  rangeText,
  RULE_MESSAGES,
  type AuditFilter,
  type AuditListResult,
  type AuditLoaderData,
  type AuditRow,
} from './audit';

// 文案逐字取自原型 v0.4 frontend/prototype/admin-console/P8-admin-audit.html。
const ADMIN_DESC = '你任职机构及其下级范围内的机构维护、人员维护、执法证、解锁与重设口令、导出等记录。';
const NOTE = '留痕写入后不能更改。只写工号，不写手机号和执法证号。';
const NO_ANCHOR_BANNER = '标有「无所属机构」的记录，对象不属于任何机构（例如没有任职的人员）。这类记录视同属于市局，只有市局任职的系统管理和监督能看到。';

export type ExportState =
  | { phase: 'idle' }
  | { phase: 'confirm' }
  | { phase: 'running' }
  | { phase: 'done'; count: number; filename: string }
  | { phase: 'failed'; message: string };

function superviseDesc(org: string, withScopeNote: boolean): string {
  return `${org}及其下级范围内的管理台留痕。${withScopeNote ? '按被操作对象所属机构筛选。' : ''}`;
}

function superviseBanner(org: string): string {
  return `你任职在${org}，只能看到对象属于${org}及其下级的记录。不属于任何机构的记录（如全市共用的配置类对象，例如工作日历）只有市局任职的人员能看到。`;
}

function Crumb() {
  return <div className="crumb">管理台 / <b>管理台留痕</b></div>;
}

function Head({ desc, canExport, onExport }: { desc: string; canExport: boolean; onExport?: () => void }) {
  return (
    <>
      <Crumb />
      <div className="page-h">
        <div>
          <h1>管理台留痕</h1>
          <div className="desc">{desc}</div>
        </div>
        {canExport ? (
          <div className="actions">
            <button
              type="button"
              className="btn btn-primary"
              data-requires={AUDIT_EXPORT}
              disabled={!onExport}
              onClick={onExport}
            >
              导出
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}

/** 筛选条（GET 表单）：条件进地址栏，loader 按查询串重新取数。 */
function Filters({ filter }: { filter: AuditFilter }) {
  const location = useLocation();
  return (
    <Form method="get" className="filters" key={location.search}>
      <input className="input" name="range" defaultValue={rangeText(filter)} aria-label="时间范围" style={{ minWidth: 200 }} />
      <select className="select" name="category" data-filter="category" defaultValue={filter.category ?? ''} aria-label="操作类别">
        {CATEGORY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <input className="input" name="actor" placeholder="操作人工号" defaultValue={filter.actorCode ?? ''} />
      <select className="select" name="outcome" defaultValue={filter.outcome ?? ''} aria-label="结果">
        {OUTCOME_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <button type="submit" className="btn">查询</button>
    </Form>
  );
}

function ResultTag({ row }: { row: AuditRow }) {
  if (row.tone === 'ok') return <span className="tag">{row.result}</span>;
  return <span className={`tag ${row.tone}`}>{row.result}</span>;
}

export function AuditTable({ rows }: { rows: readonly AuditRow[] }) {
  return (
    <table className="table">
      <thead>
        <tr><th>时间</th><th>操作人工号</th><th>操作</th><th>对象</th><th>所属机构</th><th>结果</th></tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} data-action={row.action}>
            <td>{row.time}</td>
            <td className="mono">{row.actorCode}</td>
            <td>{row.operation}</td>
            <td>{row.object}</td>
            <td>{row.anchored ? row.orgName : <span className="tag gray">{row.orgName}</span>}</td>
            <td><ResultTag row={row} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SkeletonRows() {
  return (
    <div className="card" aria-busy="true">
      {Array.from({ length: 8 }, (_, i) => <div key={i} className="skel" style={{ width: `${60 + ((i * 13) % 40)}%` }} />)}
    </div>
  );
}

export function ExportDialog({ scopeName, filter, total, running, onCancel, onConfirm }: {
  scopeName: string;
  filter: AuditFilter;
  total: number;
  running: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="mask">
      <div className="dialog" role="dialog" aria-label="导出管理台留痕">
        <h3>导出管理台留痕</h3>
        <div className="kv">
          <div className="k">范围</div><div>{`${scopeName}及全部下级`}</div>
          <div className="k">时间</div><div>{rangeText(filter)}</div>
          <div className="k">筛选</div><div>{filterSummary(filter)}</div>
          <div className="k">文件名</div><div>{exportFilename(filter)}</div>
          <div className="k">条数</div><div>{`${total} 条`}</div>
          <div className="k">格式</div><div>表格文件（.xlsx）</div>
        </div>
        <ul style={{ marginTop: 10, listStyle: 'disc' }}>
          <li>导出内容与页面一致，只含工号，不含手机号和执法证号；</li>
          <li>本次导出本身也会留痕。</li>
        </ul>
        <div className="foot">
          <button type="button" className="btn" onClick={onCancel} disabled={running}>取消</button>
          <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={running}>
            {running ? '正在导出…' : '确认导出'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ruleText(rules: readonly string[]): string {
  const known = rules.map((rule) => RULE_MESSAGES[rule]).filter(Boolean);
  return known.length > 0 ? known.join('') : '筛选条件填写不对，请检查后再查。';
}

/** 让浏览器下载导出的表格文件。 */
function saveFile(file: Blob, filename: string): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export interface AuditContentProps {
  filter: AuditFilter;
  result: AuditListResult;
  supervise: boolean;
  /** 列表未到或不合规时的页头说明（不知道范围根名称时用） */
  pendingDesc: string;
  canExport: boolean;
  exportState: ExportState;
  onExport: () => void;
  onCancelExport: () => void;
  onConfirmExport: () => void;
}

/** 列表到达后的整页内容（P8 admin/login/view/supervise/noanchor/exportConfirm/exportDone/empty）。 */
export function AuditContent(props: AuditContentProps) {
  const { filter, result, supervise, canExport, exportState } = props;
  if (result.kind === 'no-permission') {
    return <><Crumb /><DeniedCard what="管理台留痕" /></>;
  }
  if (result.kind === 'ended') return null;
  if (result.kind === 'non-compliant') {
    return (
      <>
        <Head desc={props.pendingDesc} canExport={canExport} />
        <div className="banner danger">{ruleText(result.rules)}</div>
        <Filters filter={filter} />
      </>
    );
  }
  const { scope, rows, total } = result;
  const empty = rows.length === 0;
  const desc = supervise ? superviseDesc(scope.orgName, !empty) : ADMIN_DESC;
  const hint = filter.category ? CATEGORY_HINTS[filter.category] : undefined;
  return (
    <>
      <Head desc={desc} canExport={canExport} onExport={props.onExport} />
      {exportState.phase === 'done' ? (
        <div className="banner ok">
          {`已导出 ${exportState.count} 条留痕，文件「${exportState.filename}」已开始下载。本次导出已留痕。`}
        </div>
      ) : null}
      {exportState.phase === 'failed' ? <div className="banner danger">{exportState.message}</div> : null}
      {supervise && !scope.includesUnanchored && !empty ? <div className="banner gray">{superviseBanner(scope.orgName)}</div> : null}
      {rows.some((row) => !row.anchored) ? <div className="banner gray">{NO_ANCHOR_BANNER}</div> : null}
      <Filters filter={filter} />
      {empty ? (
        <div className="card">
          <div className="empty">
            <div className="t">所选时间内没有留痕</div>
            <div>可以放宽时间范围或清空筛选再试。</div>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="card-h">
            {`共 ${total} 条`}
            {hint ? <span className="hint">{hint}</span> : null}
          </div>
          <AuditTable rows={rows} />
          <div className="help" style={{ marginTop: 8 }}>{NOTE}</div>
        </div>
      )}
      {exportState.phase === 'confirm' || exportState.phase === 'running' ? (
        <ExportDialog
          scopeName={scope.orgName}
          filter={filter}
          total={total}
          running={exportState.phase === 'running'}
          onCancel={props.onCancelExport}
          onConfirm={props.onConfirmExport}
        />
      ) : null}
    </>
  );
}

function ListError({ desc, canExport, filter }: { desc: string; canExport: boolean; filter: AuditFilter }) {
  const error = useAsyncError();
  const revalidator = useRevalidator();
  // 403 交给壳内路由错误边界，整页显示无权限页（P2 forbidden），与管理台首页一致
  if (errorStatus(error) === 403) throw error;
  return (
    <>
      <Head desc={desc} canExport={canExport} />
      <Filters filter={filter} />
      <ErrorCard what="留痕" onRetry={() => void revalidator.revalidate()} />
    </>
  );
}

/** 管理台留痕（P8）：系统管理与监督查阅、导出数据范围内的管理台留痕。换筛选条件后导出提示随之清空。 */
export default function AuditPage() {
  const location = useLocation();
  return <AuditPageBody key={location.search} />;
}

function AuditPageBody() {
  const { filter, list } = useLoaderData() as AuditLoaderData;
  const dispatch = useAppDispatch();
  const operator = useAppSelector((root) => root.login.operator);
  const opcodes = operator?.opcodes ?? [];
  const [exportState, setExportState] = useState<ExportState>({ phase: 'idle' });
  if (!opcodes.includes(AUDIT_READ)) {
    return <><Crumb /><DeniedCard what="管理台留痕" /></>;
  }
  const supervise = adminHomeView(opcodes) === 'supervise';
  const canExport = opcodes.includes(AUDIT_EXPORT);
  const pendingDesc = supervise ? superviseDesc(operator?.orgName ?? '你任职机构', true) : ADMIN_DESC;

  const confirmExport = async () => {
    setExportState({ phase: 'running' });
    const outcome = await exportAudit(dispatch, filter);
    if (outcome.kind === 'exported') {
      saveFile(outcome.file, outcome.filename);
      setExportState({ phase: 'done', count: outcome.count, filename: outcome.filename });
    } else if (outcome.kind === 'denied') {
      setExportState({ phase: 'failed', message: '导出没有完成：你没有导出这一范围留痕的权限。如工作需要，请联系本单位的系统管理人员调整角色。' });
    } else if (outcome.kind === 'non-compliant') {
      setExportState({ phase: 'failed', message: `导出没有完成：${ruleText(outcome.rules)}` });
    } else if (outcome.kind === 'failed') {
      setExportState({ phase: 'failed', message: '导出没有完成：网络或服务暂时不可用，请稍后重试。' });
    } else {
      setExportState({ phase: 'idle' });
    }
  };

  return (
    <Suspense fallback={<><Head desc={pendingDesc} canExport={canExport} /><Filters filter={filter} /><SkeletonRows /></>}>
      <Await
        resolve={list}
        errorElement={<ListError desc={pendingDesc} canExport={canExport} filter={filter} />}
      >
        {(result: AuditListResult) => (
          <AuditContent
            filter={filter}
            result={result}
            supervise={supervise}
            pendingDesc={pendingDesc}
            canExport={canExport}
            exportState={exportState}
            onExport={() => setExportState({ phase: 'confirm' })}
            onCancelExport={() => setExportState({ phase: 'idle' })}
            onConfirmExport={() => void confirmExport()}
          />
        )}
      </Await>
    </Suspense>
  );
}
