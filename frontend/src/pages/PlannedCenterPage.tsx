// 规划中占位的一级入口（案件中心、统筹督导、系统管理下的占位项）。
// 占位各有独立地址（见 shell/menu.ts 的规划中占位登记表），主区只给规划中提示。
import { Link, useLocation } from 'react-router';

import { plannedModuleByPath, plannedModulesOf, type PrimaryKey } from '../shell/menu';
import PlannedNotice from '../shell/PlannedNotice';

/**
 * 规划中占位页。地址命中某个占位时取该占位；地址是该一级的落地页时取该级首个占位。
 * 该级其他占位项列在页面上，方便从主区继续切换。
 */
export default function PlannedCenterPage({ primary }: { primary: PrimaryKey }) {
  const location = useLocation();
  const modules = plannedModulesOf(primary);
  const current = plannedModuleByPath(location.pathname) ?? modules[0] ?? null;
  if (!current) return null;
  const others = modules.filter((item) => item.id !== current.id);
  return (
    <>
      <div className="crumb"><b>{modules[0]?.label ?? current.label}</b></div>
      <PlannedNotice label={current.label} hint={current.hint} />
      {others.length > 0 ? (
        <div className="card">
          <div className="card-h">本级其他规划中模块</div>
          <div className="checks">
            {others.map((item) => (
              <Link key={item.id} className="btn btn-sm" to={item.path}>
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
