// 人员页共用的状态卡片：监督看到的无权限卡片带「去看留痕」（原型 P5、P6 denied）。
import { Link } from 'react-router';

import { DeniedCard } from '../shell/StatusPages';
import { AUDIT_READ } from './personnel';

/** 有留痕查阅码（监督）时引导去看留痕；没有时用通用无权限卡片。 */
export function PersonnelDenied({ what, opcodes, supervise }: { what: string; opcodes: readonly string[]; supervise: string }) {
  if (!opcodes.includes(AUDIT_READ)) return <DeniedCard what={what} />;
  return (
    <div className="card">
      <div className="empty">
        <div className="t">{`你没有查看${what}的权限`}</div>
        <div>{supervise}</div>
        <div style={{ marginTop: 14 }}>
          <Link className="btn btn-primary" to="/admin/audit" data-requires={AUDIT_READ}>去看留痕</Link>
        </div>
      </div>
    </div>
  );
}

export function SkeletonCard({ rows }: { rows: number }) {
  return (
    <div className="card">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skel" style={{ width: `${60 + ((i * 13) % 40)}%` }} />
      ))}
    </div>
  );
}
