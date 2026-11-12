// 用途：案件调查环节页，展示调查入口；无视图时提示不可查看。
// 调用方：frontend/src/router.tsx 的 case-investigation 路由，路径 case/:caseId/investigation。
// 接口：GET /api/cases/:id/investigation（经调查页 loader），操作码 case.read。
import { useLoaderData } from 'react-router';

import { InvestigationPanel, type InvestigationView } from './InvestigationPanel';

/** 调查页：把 loader 返回的视图交给调查面板；无视图时展示不可查看提示。 */
export default function CaseInvestigationPage() {
  const data = useLoaderData() as { view: InvestigationView | null };
  if (!data.view) return <p>当前不能查看这个案件的调查环节。</p>;
  return <InvestigationPanel view={data.view} />;
}
