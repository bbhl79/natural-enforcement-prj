import { Navigate, redirect } from 'react-router';

import { useAppSelector } from '../hooks';
import { sessionOpcodes, type SessionStore } from '../session';
import { visibleSections } from '../shell/menu';

function adminOnly(opcodes: readonly string[]): boolean {
  const sections = visibleSections(opcodes);
  return sections.includes('管理台') && !sections.includes('业务办理');
}

/** 只有管理台入口、没有业务入口的人员打开首页时直接进管理台首页。 */
export function workbenchLoader(store: SessionStore) {
  return async () => {
    if (adminOnly(await sessionOpcodes(store))) throw redirect('/admin');
    return null;
  };
}

function quoted(roles: readonly string[]): string {
  const marks = roles.map((role) => `「${role}」`);
  if (marks.length <= 1) return marks.join('');
  return `${marks.slice(0, -1).join('、')}和${marks.at(-1)}`;
}

/**
 * 工作台（P1）。业务区内容由线索、案件等切片提供，这里只放壳层提示。
 * 只有管理台入口、没有业务入口的人员直接进管理台首页。
 */
export default function WorkbenchPage() {
  const operator = useAppSelector((root) => root.login.operator);
  if (!operator) return null;
  const sections = visibleSections(operator.opcodes);
  const business = sections.includes('业务办理');
  const admin = sections.includes('管理台');
  if (adminOnly(operator.opcodes)) return <Navigate to="/admin" replace />;
  let tip: string | null = null;
  if (business && admin && operator.roles.length > 1) {
    tip = `你同时担任${quoted(operator.roles)}。左侧「业务办理」和「管理台」两区都可进入，不用换一个登录标识重新登录。`;
  } else if (!admin) {
    tip = '左侧只显示你当前角色可用的入口。你的角色不含管理权，所以没有「管理台」一区。';
  }
  return (
    <>
      <div className="crumb"><b>工作台</b></div>
      <div className="page-h">
        <div>
          <h1>工作台</h1>
          <div className="desc">{`${operator.orgName ?? ''} · ${operator.roles.join('、')}`}</div>
        </div>
      </div>
      {tip ? <div className="banner gray">{tip}</div> : null}
      <div className="card">
        <div className="card-h">我的待办</div>
        <div className="empty" style={{ padding: '28px 0' }}><div>暂无待办</div></div>
      </div>
    </>
  );
}
