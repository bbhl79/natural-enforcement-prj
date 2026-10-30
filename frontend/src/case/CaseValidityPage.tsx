import { useLoaderData } from 'react-router';

import { ValidityPanel, type ValidityView } from './ValidityPanel';

export default function CaseValidityPage() {
  const data = useLoaderData() as { view: ValidityView | null };
  if (!data.view) return <p>当前不能查看这个案件的有效性确认。</p>;
  return <ValidityPanel view={data.view} />;
}