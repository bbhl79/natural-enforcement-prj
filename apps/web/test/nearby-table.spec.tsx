import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import NearbyTable from '../src/components/NearbyTable.js'
import type { EnforcementPointDto } from '@ne/contracts'

afterEach(cleanup)

// 广州市域夹具（项目为广州市自然资源部门开发）
const POINTS: EnforcementPointDto[] = [
  { id: 1, name: '越秀公园执法点', lat: 23.136, lng: 113.265, distanceM: 770.5, createdAt: '2026-11-25T00:00:00Z' },
  { id: 2, name: '沙面执法点', lat: 23.109, lng: 113.243, distanceM: 2930.1, createdAt: '2026-11-25T00:00:00Z' },
  { id: 3, name: '广州塔执法点', lat: 23.1065, lng: 113.3245, distanceM: null, createdAt: '2026-11-25T00:00:00Z' },
]

describe('NearbyTable（纯展示组件）', () => {
  it('渲染点位名称与格式化距离', () => {
    render(<NearbyTable points={POINTS} loading={false} />)
    expect(screen.getByText('越秀公园执法点')).toBeInTheDocument()
    expect(screen.getByText('沙面执法点')).toBeInTheDocument()
    expect(screen.getByText('2.93 km')).toBeInTheDocument()
  })

  it('无距离数据（异常态）渲染占位符', () => {
    render(<NearbyTable points={POINTS} loading={false} />)
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1)
  })
})
