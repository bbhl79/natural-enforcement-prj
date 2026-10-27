import { useLoaderData } from 'react-router';

import { InvestigationPanel, type InvestigationView } from './InvestigationPanel';

export default function CaseInvestigationPage() {
  const data = useLoaderData() as { view: InvestigationView | null };
  if (!data.view) return <p>当前不能查看这个案件的调查环节。</p>;
  return <InvestigationPanel view={data.view} />;
}
