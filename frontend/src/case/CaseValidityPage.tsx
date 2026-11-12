// 用途：案件有效性确认页，展示确认入口；无视图时提示不可查看。
// 调用方：frontend/src/router.tsx 的 case-validity 路由，路径 case/:caseId/validity。
// 接口：GET /api/cases/:id/validity（经有效性页 loader），操作码 case.read。
import { useLoaderData } from 'react-router';

import { ValidityPanel, type ValidityView } from './ValidityPanel';

/** 有效性确认页：把 loader 返回的视图交给有效性面板；无视图时展示不可查看提示。 */
export default function CaseValidityPage() {
  const data = useLoaderData() as { view: ValidityView | null };
  if (!data.view) return <p>当前不能查看这个案件的有效性确认。</p>;
  return <ValidityPanel view={data.view} />;
}