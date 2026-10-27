import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SuspendDraftForm } from './InvestigationPanel';

describe('中止呈批', () => {
  it('提示是否同时办延长，勾选不是必填', () => {
    const html = renderToStaticMarkup(<SuspendDraftForm extendTogether={false} />);
    expect(html).toContain('是否同时办延长办案期限');
    expect(html).not.toMatch(/<input[^>]*\srequired[\s=>]/);
  });
});
