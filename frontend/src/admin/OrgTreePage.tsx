import { Suspense, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Await, useAsyncError, useLoaderData, useRevalidator } from 'react-router';

import { useAppDispatch, useAppSelector } from '../hooks';
import { DeniedCard, ErrorCard, errorStatus } from '../shell/StatusPages';
import {
  buildTree,
  childCountText,
  childLevelOf,
  deactivateOrgUnit,
  deactivationBlockers,
  formerNames,
  LEVEL_LABEL,
  LEVELS,
  namePeriods,
  onlyRootOrgUnit,
  registerOrgUnit,
  renameOrgUnit,
  RULE_TEXT,
  treeCountHint,
  treeKeyAction,
  visibleOrder,
  type OrgRuleCode,
  type OrgTreeData,
  type OrgTreeNode,
  type OrgUnit,
  type OrgUnitLevel,
  type OrgWriteResult,
} from './orgTree';

const REGISTER = 'org.unit.register';
const RENAME = 'org.unit.rename';
const DEACTIVATE = 'org.unit.deactivate';

function Crumb() {
  return <div className="crumb">管理台 / <b>机构</b></div>;
}

function Head() {
  return (
    <>
      <Crumb />
      <div className="page-h">
        <div>
          <h1>机构</h1>
          <div className="desc">显示你任职机构及其全部下级，已停用的机构也会列出并标明。</div>
        </div>
      </div>
    </>
  );
}

function SkeletonRows({ rows }: { rows: number }) {
  return (
    <div className="card">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skel" style={{ width: `${60 + ((i * 13) % 40)}%` }} />
      ))}
    </div>
  );
}

/** P4 loading：左树右详情两块骨架。 */
export function OrgTreeSkeleton() {
  return (
    <div className="grid2" aria-busy="true">
      <SkeletonRows rows={8} />
      <SkeletonRows rows={5} />
    </div>
  );
}

function TreeError() {
  const error = useAsyncError();
  const revalidator = useRevalidator();
  if (errorStatus(error) === 403) return <DeniedCard what="机构" />;
  return <ErrorCard what="机构树" onRetry={() => void revalidator.revalidate()} />;
}

type Dialog =
  | { kind: 'create'; parent: OrgUnit }
  | { kind: 'rename'; unit: OrgUnit }
  | { kind: 'deactivate'; unit: OrgUnit }
  | null;

export interface OrgTreeUi {
  selectedId: string | null;
  /** 折叠起来的节点 */
  collapsed: ReadonlySet<string>;
  showDeactivated: boolean;
}

export const INITIAL_UI: OrgTreeUi = { selectedId: null, collapsed: new Set(), showDeactivated: true };

function TreeNodeView({
  node,
  depth,
  ui,
  onSelect,
  onToggle,
  onKey,
}: {
  node: OrgTreeNode;
  depth: number;
  ui: OrgTreeUi;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onKey: (event: KeyboardEvent<HTMLDivElement>, node: OrgTreeNode, depth: number, open: boolean) => void;
}) {
  const { unit, children } = node;
  const open = depth === 0 || !ui.collapsed.has(unit.id);
  const classes = ['node'];
  if (ui.selectedId === unit.id) classes.push('sel');
  if (unit.deactivatedAt) classes.push('off');
  return (
    <li>
      <div
        className={classes.join(' ')}
        data-org-unit={unit.id}
        role="treeitem"
        aria-selected={ui.selectedId === unit.id}
        aria-expanded={children.length > 0 ? open : undefined}
        tabIndex={ui.selectedId === unit.id ? 0 : -1}
        onClick={() => onSelect(unit.id)}
        onKeyDown={(event) => onKey(event, node, depth, open)}
      >
        <span
          className="tg"
          aria-hidden="true"
          onClick={(event) => {
            if (children.length === 0 || depth === 0) return;
            event.stopPropagation();
            onToggle(unit.id);
          }}
        >
          {children.length > 0 ? (open ? '▾' : '▸') : ''}
        </span>
        <span className="nm">{unit.name}</span>
        {unit.deactivatedAt ? <span className="tag gray">已停用</span> : null}
        {children.length > 0 && !open ? <span className="help" style={{ margin: 0 }}>{`${children.length} 个下级`}</span> : null}
      </div>
      {children.length > 0 && open ? (
        <ul role="group">
          {children.map((child) => (
            <TreeNodeView key={child.unit.id} node={child} depth={depth + 1} ui={ui} onSelect={onSelect} onToggle={onToggle} onKey={onKey} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function Detail({
  tree,
  unit,
  opcodes,
  onCreate,
  onRename,
  onDeactivate,
}: {
  tree: OrgTreeData;
  unit: OrgUnit;
  opcodes: readonly string[];
  onCreate: () => void;
  onRename: () => void;
  onDeactivate: () => void;
}) {
  const parent = tree.orgUnits.find((item) => item.id === unit.parentId) ?? null;
  const isRoot = unit.parentId === null;
  const onlyRoot = onlyRootOrgUnit(tree);
  const former = formerNames(unit.names);
  const childLevel = childLevelOf(unit.level);
  const createBlocked = unit.deactivatedAt
    ? '已停用的机构下不能新建下级机构。'
    : childLevel === null
      ? '所下不能再建下级机构。'
      : null;
  const tag = unit.deactivatedAt
    ? <span className="tag gray">已停用</span>
    : isRoot ? <span className="tag">根机构</span> : <span className="tag">启用</span>;
  return (
    <div className="card">
      <div className="card-h">{unit.name}{tag}</div>
      <div className="kv">
        <div className="k">上级机构</div>
        <div>{isRoot ? '无（根机构）' : parent?.name ?? '不在你的范围内'}</div>
        <div className="k">层级</div>
        <div>{LEVEL_LABEL[unit.level]}</div>
        {isRoot ? (
          <>
            <div className="k">状态</div>
            <div>{unit.deactivatedAt ? '已停用' : '启用'}</div>
          </>
        ) : null}
        <div className="k">在职人员</div>
        <div>{`${unit.activePersonnel} 人`}</div>
        <div className="k">下级机构</div>
        <div>{childCountText(tree, unit.id)}</div>
        {former.length > 0 ? (
          <>
            <div className="k">历史名称</div>
            <div>
              {former.map((item, index) => (
                <div key={`${item.name}-${index}`}>
                  {item.name}
                  <br />
                  <span className="help">{item.until}</span>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </div>
      <div className="actions" style={{ marginTop: 14 }}>
        {opcodes.includes(REGISTER) ? (
          <button type="button" className="btn btn-primary" data-requires={REGISTER} disabled={createBlocked !== null} onClick={onCreate}>
            新建下级机构
          </button>
        ) : null}
        {opcodes.includes(RENAME) ? (
          <button type="button" className="btn" data-requires={RENAME} onClick={onRename}>改名</button>
        ) : null}
        {opcodes.includes(DEACTIVATE) && !isRoot && !unit.deactivatedAt ? (
          <button type="button" className="btn btn-ghost-danger" data-requires={DEACTIVATE} onClick={onDeactivate}>停用</button>
        ) : null}
      </div>
      {createBlocked && opcodes.includes(REGISTER) ? <div className="help" style={{ marginTop: 10 }}>{createBlocked}</div> : null}
      {isRoot ? <div className="help" style={{ marginTop: 10 }}>根机构不能停用。</div> : null}
      {onlyRoot ? null : (
        <div className="banner gray" style={{ marginTop: 12, marginBottom: 0 }}>
          机构不能移动到其他上级下面。需要调整隶属时：新建机构，把人员调岗过去，再停用旧机构。
        </div>
      )}
    </div>
  );
}

function RuleErrors({ rules, only }: { rules: readonly OrgRuleCode[]; only: readonly OrgRuleCode[] }) {
  const shown = rules.filter((rule) => only.includes(rule));
  return <>{shown.map((rule) => <div key={rule} className="err">{RULE_TEXT[rule]}</div>)}</>;
}

/** 弹窗里能拿到焦点的元素（不含禁用的）。 */
const FOCUSABLE = 'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/**
 * 弹窗（P4 create、rename）。打开时焦点移到标了 data-autofocus 的输入框（没有时取第一个可聚焦元素），
 * Tab、Shift+Tab 在弹窗内循环，不落到背景；关闭时焦点回到打开弹窗前的元素（通常是触发按钮）。
 */
function Modal({ title, children, foot }: { title: string; children: ReactNode; foot: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const box = ref.current;
    (box?.querySelector<HTMLElement>('[data-autofocus]') ?? box?.querySelector<HTMLElement>(FOCUSABLE))?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  const trapTab = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab' || !ref.current) return;
    const items = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    const current = document.activeElement;
    const inside = current instanceof Node && ref.current.contains(current);
    if (event.shiftKey && (current === first || !inside)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (current === last || !inside)) {
      event.preventDefault();
      first.focus();
    }
  };
  return (
    <div className="mask">
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title} ref={ref} onKeyDown={trapTab}>
        <h3>{title}</h3>
        {children}
        <div className="foot">{foot}</div>
      </div>
    </div>
  );
}

export function CreateDialog({
  parent,
  onCancel,
  onSubmit,
}: {
  parent: OrgUnit;
  onCancel: () => void;
  onSubmit: (input: { name: string; level: OrgUnitLevel }) => Promise<OrgWriteResult>;
}) {
  const [name, setName] = useState('');
  const [level, setLevel] = useState<OrgUnitLevel>(childLevelOf(parent.level) ?? 'station');
  const [failure, setFailure] = useState<{ rules: OrgRuleCode[]; message: string | null }>({ rules: [], message: null });
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    const result = await onSubmit({ name, level });
    setBusy(false);
    if (!result.ok) setFailure({ rules: result.rules, message: result.message });
  };
  return (
    <Modal
      title={`在「${parent.name}」下新建机构`}
      foot={(
        <>
          <button type="button" className="btn" onClick={onCancel}>取消</button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void submit()}>新建</button>
        </>
      )}
    >
      {failure.message ? <div className="banner danger">{failure.message}</div> : null}
      <div className="form-row">
        <label>上级机构</label>
        <input className="input ro" value={parent.name} disabled />
      </div>
      <div className="form-row">
        <label htmlFor="org-level">层级<span className="req">*</span></label>
        <div>
          <select id="org-level" className="select" value={level} onChange={(event) => setLevel(event.target.value as OrgUnitLevel)}>
            {LEVELS.map((item) => <option key={item} value={item}>{LEVEL_LABEL[item]}</option>)}
          </select>
          <div className="help">市下只能建区，区下只能建所，所下不能再建下级机构。</div>
          <RuleErrors rules={failure.rules} only={['org-level-mismatch']} />
        </div>
      </div>
      <div className="form-row">
        <label htmlFor="org-name">机构名称<span className="req">*</span></label>
        <div>
          <input id="org-name" className="input" data-autofocus value={name} onChange={(event) => setName(event.target.value)} />
          <div className="help">名称以编制批复为准。以后改名会保留历史名称。</div>
          <RuleErrors rules={failure.rules} only={['org-name-required', 'org-name-too-long']} />
        </div>
      </div>
    </Modal>
  );
}

export function RenameDialog({
  unit,
  onCancel,
  onSubmit,
}: {
  unit: OrgUnit;
  onCancel: () => void;
  onSubmit: (name: string) => Promise<OrgWriteResult>;
}) {
  const [name, setName] = useState('');
  const [failure, setFailure] = useState<{ rules: OrgRuleCode[]; message: string | null }>({ rules: [], message: null });
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    const result = await onSubmit(name);
    setBusy(false);
    if (!result.ok) setFailure({ rules: result.rules, message: result.message });
  };
  return (
    <Modal
      title={`改名：${unit.name}`}
      foot={(
        <>
          <button type="button" className="btn" onClick={onCancel}>取消</button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void submit()}>确认改名</button>
        </>
      )}
    >
      {failure.message ? <div className="banner danger">{failure.message}</div> : null}
      <div className="form-row">
        <label>现名称</label>
        <input className="input ro" value={unit.name} disabled />
      </div>
      <div className="form-row">
        <label htmlFor="org-new-name">新名称<span className="req">*</span></label>
        <div>
          <input id="org-new-name" className="input" data-autofocus value={name} onChange={(event) => setName(event.target.value)} />
          <div className="help">改名后，此前的案件、卷宗和记录仍显示当时的名称。</div>
          <RuleErrors rules={failure.rules} only={['org-name-required', 'org-name-too-long']} />
        </div>
      </div>
      <div className="section-title">历史名称</div>
      <table className="table">
        <thead>
          <tr><th>名称</th><th>使用期间</th></tr>
        </thead>
        <tbody>
          {namePeriods(unit.names).map((item, index) => (
            <tr key={`${item.name}-${index}`}><td>{item.name}</td><td>{item.period}</td></tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}

/**
 * 停用弹窗（P4 blocked/confirm）。树数据上看得出的条件（在职人员、未停用的下级）不满足时直接列出，不发请求；
 * 都满足时请确认，确认后由服务端再按根机构、下级、生效任职、未办结事项核对，409 显示服务端的可读原因。
 */
export function DeactivateDialog({
  tree,
  unit,
  onCancel,
  onSubmit,
}: {
  tree: OrgTreeData;
  unit: OrgUnit;
  onCancel: () => void;
  onSubmit: () => Promise<OrgWriteResult>;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const blockers = deactivationBlockers(tree, unit);
  if (blockers.length > 0) {
    return (
      <Modal
        title={`暂时不能停用「${unit.name}」`}
        foot={<button type="button" className="btn btn-primary" onClick={onCancel}>知道了</button>}
      >
        <div className="banner amber" style={{ marginBottom: 8 }}>停用机构前，需要先满足以下条件：</div>
        <ul>
          {blockers.map((blocker) => (blocker.kind === 'personnel' ? (
            <li key="personnel">
              还有 <b>{`${blocker.count} 名`}</b>在职人员：请先把他们调岗到其他机构，或停用相应人员。
            </li>
          ) : (
            <li key="children">
              还有 <b>{`${blocker.names.length} 个`}</b>{`未停用的下级机构（${blocker.names.join('、')}）：请先停用下级机构。`}
            </li>
          )))}
        </ul>
      </Modal>
    );
  }
  const submit = async () => {
    setBusy(true);
    const result = await onSubmit();
    setBusy(false);
    if (!result.ok) setMessage(result.message);
  };
  return (
    <Modal
      title={`停用「${unit.name}」？`}
      foot={(
        <>
          <button type="button" className="btn" onClick={onCancel}>取消</button>
          <button type="button" className="btn btn-danger" disabled={busy || message !== null} onClick={() => void submit()}>确认停用</button>
        </>
      )}
    >
      {message ? <div className="banner danger">{message}</div> : null}
      <p>停用后：</p>
      <ul>
        <li>不能再在这个机构下建人员或下级机构；</li>
        <li>业务办理时不能再选它作为承办机构；</li>
        <li>历史记录照常保留，仍显示这个机构名称；</li>
        <li>一期不提供恢复，请确认后再操作。</li>
      </ul>
      <div className="banner gray" style={{ marginTop: 10, marginBottom: 0 }}>已核对：没有在职人员，没有未停用的下级机构。</div>
    </Modal>
  );
}

/** 有下级的非根节点：全部折叠时收起它们。根节点始终展开。 */
function collapsibleIds(tree: OrgTreeData): Set<string> {
  const parents = new Set(tree.orgUnits.map((unit) => unit.parentId).filter((id): id is string => id !== null));
  parents.delete(tree.rootId);
  return parents;
}

/**
 * 机构树主体（P4 expanded/collapsed/onlyroot 与新建、改名、停用弹窗）。
 * 界面没有移动、合并、恢复机构的入口。按钮按会话清单显示，真正的授权由服务端每次校验。
 */
export function OrgTreeView({
  tree,
  opcodes,
  ui,
  onUi,
  dialog,
  onDialog,
  onCreate,
  onRename,
  onDeactivate,
}: {
  tree: OrgTreeData;
  opcodes: readonly string[];
  ui: OrgTreeUi;
  onUi: (ui: OrgTreeUi) => void;
  dialog: Dialog;
  onDialog: (dialog: Dialog) => void;
  onCreate: (parent: OrgUnit, input: { name: string; level: OrgUnitLevel }) => Promise<OrgWriteResult>;
  onRename: (unit: OrgUnit, name: string) => Promise<OrgWriteResult>;
  onDeactivate: (unit: OrgUnit) => Promise<OrgWriteResult>;
}) {
  const root = buildTree(tree, ui.showDeactivated);
  const selectedId = tree.orgUnits.find((unit) => unit.id === ui.selectedId)?.id ?? root?.unit.id ?? null;
  // 键盘移动选中后把焦点跟到新节点上（单选树的「游走焦点」：只有选中的节点在 Tab 序列里）。
  const treeRef = useRef<HTMLUListElement>(null);
  const focusAfterKey = useRef(false);
  useEffect(() => {
    if (!focusAfterKey.current || selectedId === null) return;
    focusAfterKey.current = false;
    treeRef.current?.querySelector<HTMLElement>(`[data-org-unit="${CSS.escape(selectedId)}"]`)?.focus();
  }, [selectedId]);
  if (!root) return <ErrorCard what="机构树" onRetry={() => window.location.reload()} />;
  const onlyRoot = onlyRootOrgUnit(tree);
  const selected = tree.orgUnits.find((unit) => unit.id === ui.selectedId) ?? root.unit;
  const toggle = (id: string) => {
    const next = new Set(ui.collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onUi({ ...ui, collapsed: next });
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>, node: OrgTreeNode, depth: number, open: boolean) => {
    const action = treeKeyAction(event.key, visibleOrder(root, ui.collapsed), node.unit.id, {
      parentId: node.unit.parentId,
      hasChildren: node.children.length > 0,
      open,
      collapsible: depth > 0,
    });
    if (!action) return;
    event.preventDefault();
    if (action.kind === 'toggle') {
      toggle(action.id);
      return;
    }
    focusAfterKey.current = true;
    onUi({ ...ui, selectedId: action.id });
  };
  return (
    <>
      <div className="grid2">
        <div className="card">
          <div className="card-h">机构树<span className="hint">{treeCountHint(tree)}</span></div>
          {onlyRoot ? null : (
            <div className="filters">
              <button type="button" className="btn btn-sm" onClick={() => onUi({ ...ui, collapsed: new Set() })}>全部展开</button>
              <button type="button" className="btn btn-sm" onClick={() => onUi({ ...ui, collapsed: collapsibleIds(tree) })}>全部折叠</button>
              <label className="checks" style={{ padding: 0 }}>
                <input
                  type="checkbox"
                  checked={ui.showDeactivated}
                  onChange={(event) => onUi({ ...ui, showDeactivated: event.target.checked })}
                />
                {' 显示已停用'}
              </label>
            </div>
          )}
          <ul className="tree" role="tree" aria-label="机构树" ref={treeRef}>
            <TreeNodeView
              node={root}
              depth={0}
              ui={{ ...ui, selectedId: selected.id }}
              onSelect={(id) => onUi({ ...ui, selectedId: id })}
              onToggle={toggle}
              onKey={onKey}
            />
          </ul>
          {onlyRoot ? <div className="banner gray" style={{ marginTop: 12 }}>还没有下级机构。请先建区分局，再在区分局下建所。</div> : null}
        </div>
        <Detail
          tree={tree}
          unit={selected}
          opcodes={opcodes}
          onCreate={() => onDialog({ kind: 'create', parent: selected })}
          onRename={() => onDialog({ kind: 'rename', unit: selected })}
          onDeactivate={() => onDialog({ kind: 'deactivate', unit: selected })}
        />
      </div>
      {dialog?.kind === 'create' ? (
        <CreateDialog parent={dialog.parent} onCancel={() => onDialog(null)} onSubmit={(input) => onCreate(dialog.parent, input)} />
      ) : null}
      {dialog?.kind === 'rename' ? (
        <RenameDialog unit={dialog.unit} onCancel={() => onDialog(null)} onSubmit={(name) => onRename(dialog.unit, name)} />
      ) : null}
      {dialog?.kind === 'deactivate' ? (
        <DeactivateDialog tree={tree} unit={dialog.unit} onCancel={() => onDialog(null)} onSubmit={() => onDeactivate(dialog.unit)} />
      ) : null}
    </>
  );
}

/** 机构（P4）：系统管理看树、新建下级、改名、停用；内勤只读看树；没有树读码的人员看到无权限卡片。 */
export default function OrgTreePage() {
  const { tree } = useLoaderData() as { tree: Promise<OrgTreeData | null> };
  const opcodes = useAppSelector((root) => root.login.operator?.opcodes ?? []);
  const dispatch = useAppDispatch();
  const revalidator = useRevalidator();
  const [ui, setUi] = useState<OrgTreeUi>(INITIAL_UI);
  const [dialog, setDialog] = useState<Dialog>(null);
  if (!opcodes.includes('org.tree.read')) {
    return (
      <>
        <Crumb />
        <DeniedCard what="机构" />
      </>
    );
  }
  const done = async (result: OrgWriteResult): Promise<OrgWriteResult> => {
    if (result.ok) {
      setDialog(null);
      setUi((current) => ({ ...current, selectedId: result.id }));
      await revalidator.revalidate();
    }
    return result;
  };
  return (
    <>
      <Head />
      <Suspense fallback={<OrgTreeSkeleton />}>
        <Await resolve={tree} errorElement={<TreeError />}>
          {(resolved: OrgTreeData | null) => (resolved ? (
            <OrgTreeView
              tree={resolved}
              opcodes={opcodes}
              ui={ui}
              onUi={setUi}
              dialog={dialog}
              onDialog={setDialog}
              onCreate={async (parent, input) => done(await registerOrgUnit(dispatch, { parentId: parent.id, ...input }))}
              onRename={async (unit, name) => done(await renameOrgUnit(dispatch, unit.id, name))}
              onDeactivate={async (unit) => done(await deactivateOrgUnit(dispatch, unit.id))}
            />
          ) : null)}
        </Await>
      </Suspense>
    </>
  );
}
