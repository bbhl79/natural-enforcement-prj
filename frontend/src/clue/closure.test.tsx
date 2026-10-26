// 撤回不派与结案提醒的前端测试（#217；规格 D 节、交互锁）。
// 测的是可见行为：四项常用原因逐字且每个原因单独一行、补充说明必填的提示、
// 提醒二选一的按钮口径与文案、失败提示口径，以及界面不出现「捞回」。

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ClueCloseWithOldDialog, ClueWithdrawDialog } from './ClueWithdrawDialog';
import { closureFailureText, reminderKindLabel } from './closure';

/** 服务端给的四项常用原因（逐字）。 */
const REASONS = ['同一地点不同违法', '新增情况', '原线索核查不属实需重派', '误判重复'];

describe('撤回不派弹窗', () => {
  it('四项原因逐字、每个原因单独一行，说明必填', () => {
    const html = renderToStaticMarkup(
      <ClueWithdrawDialog
        clueCode="CL0000000012"
        reasons={REASONS}
        busy={false}
        failure={null}
        onSubmit={() => undefined}
        onCancel={() => undefined}
      />,
    );
    for (const reason of REASONS) {
      expect(html).toContain(reason);
    }
    // 每个原因一行：四个独立的原因项。
    expect(html.match(/data-reason=/g)?.length).toBe(4);
    expect(html).toContain('data-role="withdraw-reasons"');
    expect(html).toContain('补充说明必填');
    expect(html).toContain('data-role="withdraw-note"');
    expect(html).toContain('撤回不派');
  });

  it('失败提示写在弹窗里', () => {
    const html = renderToStaticMarkup(
      <ClueWithdrawDialog
        clueCode="CL0000000012"
        reasons={REASONS}
        busy={false}
        failure="请至少勾选一项撤回原因。"
        onSubmit={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(html).toContain('请至少勾选一项撤回原因。');
    expect(html).toContain('data-role="failure"');
  });

  it('界面不用「捞回」，也不用 Issue 号', () => {
    const html = renderToStaticMarkup(
      <ClueWithdrawDialog
        clueCode="CL0000000012"
        reasons={REASONS}
        busy={false}
        failure={null}
        onSubmit={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(html).not.toContain('捞回');
    expect(html).not.toContain('#217');
    expect(html).not.toContain('区块');
  });
});

describe('随旧线索办结弹窗', () => {
  it('写明原因后随旧线索办结，说明必填', () => {
    const html = renderToStaticMarkup(
      <ClueCloseWithOldDialog
        clueCode="CL0000000012"
        otherClueCode="CL0000000011"
        busy={false}
        failure={null}
        onSubmit={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(html).toContain('随旧线索办结');
    expect(html).toContain('CL0000000011');
    expect(html).toContain('原因说明必填');
    expect(html).not.toContain('捞回');
  });
});

describe('失败与标签口径', () => {
  it('校验失败的提示逐条对应', () => {
    expect(closureFailureText({ result: 'non-compliant', rules: ['missing-withdraw-reason'] })).toBe(
      '请至少勾选一项撤回原因。',
    );
    expect(closureFailureText({ result: 'non-compliant', rules: ['missing-withdraw-note'] })).toBe(
      '请填写补充说明。',
    );
    expect(
      closureFailureText({ result: 'non-compliant', rules: ['missing-disposition-fields'] }),
    ).toBe('请写明原因。');
    expect(closureFailureText({ result: 'concurrent-change' })).toBe(
      '线索状态已被他人变更，请刷新后重试。',
    );
  });

  it('提醒类型标签用 GLOSSARY 的词', () => {
    expect(reminderKindLabel('no-case')).toBe('不予立案');
    expect(reminderKindLabel('transfer')).toBe('移送');
    expect(reminderKindLabel('case')).toBe('立案');
    expect(reminderKindLabel('other')).toBe('其他（行政处理事项，系统外办理）');
  });
});
