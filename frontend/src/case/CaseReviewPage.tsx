import { useLoaderData } from 'react-router';

import { ReviewPanel, type ReviewView } from './ReviewPanel';

export default function CaseReviewPage() {
  const data = useLoaderData() as { view: ReviewView | null };
  if (!data.view) return <p>当前不能查看这个案件的审理环节。</p>;
  return <ReviewPanel view={data.view} />;
}