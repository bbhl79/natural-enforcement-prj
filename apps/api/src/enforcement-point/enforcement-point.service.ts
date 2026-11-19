import { Injectable } from '@nestjs/common'
import type { NearbyResult } from '@ne/contracts'
import { EnforcementPointRepo } from './enforcement-point.repo.js'

@Injectable()
export class EnforcementPointService {
  constructor(private readonly repo: EnforcementPointRepo) {}

  async create(dto: { name: string; lat: number; lng: number }): Promise<{ id: number }> {
    return this.repo.create(dto.name, { lat: dto.lat, lng: dto.lng })
  }

  async nearby(q: { lat: number; lng: number; radiusM: number }): Promise<NearbyResult> {
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
