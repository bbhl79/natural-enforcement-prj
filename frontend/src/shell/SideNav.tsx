import { Link, useLocation } from 'react-router';

import {
  activePrimaryKey,
  activeSecondaryKey,
  secondaryHref,
  visiblePrimaries,
  visibleSecondaries,
  type PrimaryKey,
} from './menu';

/**
 * 左侧二级侧栏：随顶栏一级入口切换。
 * 本人看不见的一级（无系统管理权限）不出现在顶栏，侧栏也不出该一级的条目。
 * highlight 为 false 时不高亮任何项（无权限页，原型 P2-forbidden）。
 */
export default function SideNav({ opcodes, highlight = true }: { opcodes: readonly string[]; highlight?: boolean }) {
  const { pathname, search } = useLocation();
  const primary = activePrimaryKey(pathname);
  const visible = visiblePrimaries(opcodes);
  const allowed = primary !== null && visible.some((item) => item.id === primary);
  const items = allowed ? visibleSecondaries(primary as PrimaryKey, opcodes) : [];
  const active = allowed && highlight ? activeSecondaryKey(primary as PrimaryKey, pathname, search, opcodes) : null;

  if (!allowed) {
    return (
      <nav className="sidenav" aria-label="二级菜单">
        <div className="nav-section">导航</div>
        <div className="sidenav-hint">请从顶栏选择一级入口。</div>
      </nav>
    );
  }

  const rows = [];
  const label = visible.find((item) => item.id === primary)?.label ?? '';
  rows.push(<div key="sec" className="sidenav-sec">{`${label} · 二级菜单`}</div>);
  for (const item of items) {
    rows.push(
      <Link
        key={item.id}
        to={secondaryHref(item, search)}
        className={item.id === active ? 'nav-item active' : 'nav-item'}
        data-menu={item.id}
        data-requires={item.anyOf ? item.anyOf.join(' ') : ''}
      >
        {item.label}
        {item.planned ? <span className="plan-tag">规划中</span> : null}
      </Link>,
    );
  }
  return <nav className="sidenav" aria-label="二级菜单">{rows}</nav>;
}

/** 会话确认中的左导骨架（P1 loading）：不先渲染菜单。 */
export function SideNavSkeleton() {
  return (
    <nav className="sidenav" aria-busy="true">
      <div className="skel" style={{ width: '70%' }} />
      <div className="skel" />
      <div className="skel" style={{ width: '80%' }} />
      <div className="skel" style={{ width: '60%' }} />
    </nav>
  );
}
