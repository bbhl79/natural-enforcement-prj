import { Injectable } from '@nestjs/common'
import type {
  CreateEnforcementPointDto,
  CreateEnforcementPointResult,
  NearbyQueryDto,
  NearbyResult,
} from '@ne/contracts'
import { EnforcementPointRepo } from './enforcement-point.repo.js'

@Injectable()
export class EnforcementPointService {
  constructor(private readonly repo: EnforcementPointRepo) {}

  // 入参/出参类型一律来自契约包（前后端同一真相，不内联重声明）
  async create(dto: CreateEnforcementPointDto): Promise<CreateEnforcementPointResult> {
    return this.repo.create(dto.name, { lat: dto.lat, lng: dto.lng })
  }

  async nearby(q: NearbyQueryDto): Promise<NearbyResult> {
    const rows = await this.repo.findNearby({ lat: q.lat, lng: q.lng }, q.radiusM)
    return {
      center: { lat: q.lat, lng: q.lng },
      radiusM: q.radiusM,
      points: rows.map((r) => ({
        id: r.id,
        name: r.name,
        lat: r.lat,
        lng: r.lng,
        distanceM: r.distance_m,
        createdAt: new Date(r.createdAt).toISOString(),
      })),
    }
  }
}
