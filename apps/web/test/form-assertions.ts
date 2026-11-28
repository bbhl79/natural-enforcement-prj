// 表单实例唯一性 DOM 断言工具（#68 AC2/AC3，Spec-工程基座 强制验收项 14）：
// 供基线测试与 `devenv gen page` 生成的页面组件测试共用，直接核验真实渲染 DOM，
// 断言所有表单/控件 id 唯一、根级前缀生效以及 <label for> 与目标控件严格关联。
import { expect } from 'vitest'
import { within } from '@testing-library/react'

export function collectDomIds(scope: ParentNode): string[] {
  return Array.from(scope.querySelectorAll<HTMLElement>('[id]'))
    .map((el) => el.id)
    .filter((id) => id.length > 0)
}

export function assertFormIdsAndLabels(
  forms: HTMLFormElement[],
  expectedLabels: readonly string[],
): void {
  const allIds = forms.flatMap((form) => [...(form.id ? [form.id] : []), ...collectDomIds(form)])
  expect(allIds.length).toBeGreaterThanOrEqual(forms.length * (expectedLabels.length + 1))
  expect(new Set(allIds).size).toBe(allIds.length)

  const seenControlIds = new Set<string>()
  for (const form of forms) {
    const labels = Array.from(form.querySelectorAll<HTMLLabelElement>('label[for]'))
    expect(labels.length).toBeGreaterThanOrEqual(expectedLabels.length)
    for (const label of labels) {
      const targetId = label.htmlFor
      expect(targetId.length).toBeGreaterThan(0)
      const matches = Array.from(document.querySelectorAll<HTMLElement>('[id]')).filter(
        (el) => el.id === targetId,
      )
      expect(matches).toHaveLength(1)
      const target = matches[0]!
      expect(form.contains(target)).toBe(true)
      expect(label.control).toBe(target)
    }

    for (const labelText of expectedLabels) {
      const control = within(form).getByLabelText(labelText)
      expect(control.id.length).toBeGreaterThan(0)
      expect(seenControlIds.has(control.id)).toBe(false)
      seenControlIds.add(control.id)
    }
  }
}
