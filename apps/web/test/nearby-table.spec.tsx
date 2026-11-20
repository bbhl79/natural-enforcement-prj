import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import NearbyTable from '../src/components/NearbyTable.js'
import type { EnforcementPointDto } from '@ne/contracts'

afterEach(cleanup)

const POINTS: EnforcementPointDto[] = [
  { id: 1, name: '天安门执法点', lat: 39.9087, lng: 116.3975, distanceM: 0, createdAt: '2026-11-20T00:00:00Z' },
  { id: 4, name: '西单执法点', lat: 39.9086, lng: 116.3743, distanceM: 1984.2, createdAt: '2026-11-20T00:00:00Z' },
  { id: 2, name: '中关村执法点', lat: 39.9847, lng: 116.3159, distanceM: null, createdAt: '2026-11-20T00:00:00Z' },
]

describe('NearbyTable（纯展示组件）', () => {
  it('渲染点位名称与格式化距离', () => {
    render(<NearbyTable points={POINTS} loading={false} />)
    expect(screen.getByText('天安门执法点')).toBeInTheDocument()
    expect(screen.getByText('西单执法点')).toBeInTheDocument()
    expect(screen.getByText('1.98 km')).toBeInTheDocument()
  })

  it('无距离数据（radius 外命中的异常态）渲染占位符', () => {
    render(<NearbyTable points={POINTS} loading={false} />)
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1)
  })
})
