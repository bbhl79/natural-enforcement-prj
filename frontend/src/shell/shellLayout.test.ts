// 壳层布局纪律（#207 交互锁、#209 执行票）。
// 主画布 100% 全宽：主区吃掉侧栏以外的全部宽度，不被常驻右栏挤窄；
// 不存在常驻右侧调试／走查栏（演示辅助默认收起，不进正式界面）。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const css = readFileSync(fileURLToPath(new URL('./console.css', import.meta.url)), 'utf8');
/** 去掉注释：注释里的工程记号不是界面文案，不受文案纪律约束。 */
const cssBody = css.replace(/\/\*[\s\S]*?\*\//g, '');

/** 取一条 CSS 规则的选择器与声明体。 */
function rule(selector: string): string {
  const match = css.match(new RegExp(`\\.console ${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\{([^}]*)\\}`));
  return match ? match[1] : '';
}

describe('主区全宽、无常驻右侧调试栏', () => {
  it('主区吃掉侧栏以外的全部宽度', () => {
    const main = rule('.main');
    expect(main).toContain('flex:1');
    expect(main).toContain('min-width:0');
    // 主区不设固定宽度、不靠外层容器限宽。
    expect(main).not.toMatch(/max-width/);
    expect(main).not.toMatch(/(^|;)\s*width\s*:/);
  });

  it('壳层是「顶栏 + 左导 + 主区」两栏，没有第三栏', () => {
    // 侧栏是左导（两级菜单要求），主区之外不再有列。
    expect(rule('.shell')).toContain('display:flex');
    expect(rule('.shell')).not.toMatch(/grid-template-columns/);
    expect(rule('.sidenav')).toContain('flex-shrink:0');
  });

  it('没有常驻右侧调试／走查栏（不出现固定在右边的浮层）', () => {
    // 固定定位的元素不得贴右边常驻：只允许居中的提示条。
    const fixed = css.match(/position:fixed[^}]*/g) ?? [];
    for (const block of fixed) {
      expect(block).not.toMatch(/right\s*:/);
    }
    expect(css).not.toMatch(/rail|debug-?panel|walkthrough/i);
  });
});

describe('统一工作台无侧栏与登记页布局', () => {
  it('分区页签有样式；登记页不再有开单前步骤条与门闸', () => {
    expect(rule('.ws-sec-tabs')).toContain('display:flex');
    expect(rule('.ws-sec-tab')).toContain('border-bottom');
    expect(cssBody).not.toContain('.stepper');
    expect(cssBody).not.toContain('.step-btn');
    expect(cssBody).not.toContain('.gate-card');
    expect(cssBody).not.toContain('.gate-preview');
  });
});

describe('界面文案纪律（#207 交互锁）', () => {
  it('样式表里不出现票号、区块字母与「捞回」', () => {
    // content 属性是唯一会显示给用户的样式内文案。
    const contents = (cssBody.match(/content\s*:\s*("[^"]*"|'[^']*')/g) ?? []).join(' ');
    expect(contents).not.toMatch(/#[0-9]{2,4}(?![0-9a-f])/i);
    expect(contents).not.toMatch(/区块\s*[A-E]/);
    expect(contents).not.toContain('捞回');
  });
});
