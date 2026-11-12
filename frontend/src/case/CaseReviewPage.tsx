// 用途：案件审理环节页，展示审理入口；无视图时提示不可查看。
// 调用方：frontend/src/router.tsx 的 case-review 路由，路径 case/:caseId/review。
// 接口：GET /api/cases/:id/review（经审理页 loader），操作码 case.read。
import { useLoaderData } from 'react-router';

import { ReviewPanel, type ReviewView } from './ReviewPanel';

/** 审理页：把 loader 返回的视图交给审理面板；无视图时展示不可查看提示。 */
export default function CaseReviewPage() {
  const data = useLoaderData() as { view: ReviewView | null };
  if (!data.view) return <p>当前不能查看这个案件的审理环节。</p>;
  return <ReviewPanel view={data.view} />;
}