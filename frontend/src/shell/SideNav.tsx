import { Link, useLocation } from 'react-router';

import { activeMenuId, visibleMenu, type MenuSection } from './menu';

/** 左导（P1）：按会话清单裁剪，兼任多角色时是并集。分区下没有可见项时不显示分区名。 */
export default function SideNav({ opcodes }: { opcodes: readonly string[] }) {
  const { pathname } = useLocation();
  const items = visibleMenu(opcodes);
  const active = activeMenuId(pathname, items);
  let section: MenuSection | null = null;
  const rows = [];
  for (const item of items) {
    if (item.section !== section) {
      section = item.section;
      rows.push(<div key={`sec-${section}`} className="nav-section">{section}</div>);
    }
    rows.push(
      <Link
        key={item.id}
        to={item.path}
        className={item.id === active ? 'nav-item active' : 'nav-item'}
        data-menu={item.id}
        data-requires={item.anyOf.join(' ')}
      >
        <span className="dot" />
        {item.label}
      </Link>,
    );
  }
  return <nav className="sidenav">{rows}</nav>;
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
