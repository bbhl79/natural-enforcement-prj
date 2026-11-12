import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SuspendDraftForm } from './InvestigationPanel';

// 验证中止呈批表单中同时办延长的勾选为非必填（#236）。
describe('中止呈批', () => {
  it('提示是否同时办延长，勾选不是必填', () => {
    const html = renderToStaticMarkup(<SuspendDraftForm extendTogether={false} />);
    expect(html).toContain('是否同时办延长办案期限');
    expect(html).not.toMatch(/<input[^>]*\srequired[\s=>]/);
  });
});
