// 表单实例唯一性组件测试（#68 AC2/AC3，Spec-工程基座 强制验收项 14）：
// 实际渲染两个相同 Form 实例及多 React 根，直接断言真实 DOM id 唯一、
// 根级前缀生效以及 <label for> 与目标控件的关联正确（而非静态检查源码）。
import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, within } from '@testing-library/react'
import CreatePointForm from '../src/components/CreatePointForm.js'
import { createWebRoot, WebProviders, type WebRootHandle } from '../src/lib/root.js'
import { createAppStore } from '../src/store.js'
import { assertFormIdsAndLabels, collectDomIds } from './form-assertions.js'

const POINT_LABELS = ['名称', '纬度', '经度'] as const
const mountedRoots: Array<{ root: WebRootHandle; host: HTMLDivElement }> = []

afterEach(() => {
  for (const item of mountedRoots.splice(0)) {
    act(() => {
      item.root.unmount()
    })
    item.host.remove()
  }
  cleanup()
})

describe('表单实例唯一性（React useId + 多 React 根前缀）', () => {
  it('同页渲染两个相同 CreatePointForm：DOM id 唯一且 label 关联各自表单控件', () => {
    const store = createAppStore()
    const { container } = render(
      <WebProviders store={store}>
        <CreatePointForm />
        <CreatePointForm />
      </WebProviders>,
    )

    const forms = Array.from(container.querySelectorAll<HTMLFormElement>('form'))
    expect(forms).toHaveLength(2)
    assertFormIdsAndLabels(forms, POINT_LABELS)

    const firstNameInput = within(forms[0]!).getByLabelText('名称')
    const secondNameInput = within(forms[1]!).getByLabelText('名称')
    expect(firstNameInput).not.toBe(secondNameInput)
    expect(firstNameInput.id).not.toBe(secondNameInput.id)
  })

  it('多 React 根显式 identifierPrefix：跨根 DOM id 带各自根级前缀且全局唯一、无串扰', () => {
    const hostA = document.createElement('div')
    const hostB = document.createElement('div')
    document.body.append(hostA, hostB)

    const rootA = createWebRoot(hostA, {
      identifierPrefix: 'root-a-',
      store: createAppStore(),
    })
    const rootB = createWebRoot(hostB, {
      identifierPrefix: 'root-b-',
      store: createAppStore(),
    })
    mountedRoots.push({ root: rootA, host: hostA }, { root: rootB, host: hostB })

    act(() => {
      rootA.render(<CreatePointForm />)
      rootB.render(<CreatePointForm />)
    })

    const formA = hostA.querySelector<HTMLFormElement>('form')!
    const formB = hostB.querySelector<HTMLFormElement>('form')!
    expect(formA).not.toBeNull()
    expect(formB).not.toBeNull()

    const idsA = [formA.id, ...collectDomIds(formA)]
    const idsB = [formB.id, ...collectDomIds(formB)]
    expect(idsA.every((id) => id.includes('root-a-'))).toBe(true)
    expect(idsB.every((id) => id.includes('root-b-'))).toBe(true)

    assertFormIdsAndLabels([formA, formB], POINT_LABELS)
  })

  it('多 React 根省略 identifierPrefix 时自动分配不同根前缀，跨根 DOM id 仍唯一', () => {
    const hostA = document.createElement('div')
    const hostB = document.createElement('div')
    document.body.append(hostA, hostB)

    const rootA = createWebRoot(hostA, { store: createAppStore() })
    const rootB = createWebRoot(hostB, { store: createAppStore() })
    mountedRoots.push({ root: rootA, host: hostA }, { root: rootB, host: hostB })

    expect(rootA.identifierPrefix).not.toBe(rootB.identifierPrefix)

    act(() => {
      rootA.render(<CreatePointForm />)
      rootB.render(<CreatePointForm />)
    })

    const formA = hostA.querySelector<HTMLFormElement>('form')!
    const formB = hostB.querySelector<HTMLFormElement>('form')!
    assertFormIdsAndLabels([formA, formB], POINT_LABELS)
  })
})
