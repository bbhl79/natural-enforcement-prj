// 读取 fixtures/coverage-acks.json。形状只接受 { acks: [] }。
// 裸数组是错误形状，明确抛错，不当成空确认。
import fs from 'node:fs/promises';
import path from 'node:path';

import type { CoverageAck } from './discover/diff-runs.ts';
import { repoRoot } from './paths.ts';
import { recordOf } from './record-of.ts';

export async function loadCoverageAcks(root: string = repoRoot()): Promise<CoverageAck[]> {
  const file = path.join(
    root,
    '.cursor/skills/verify-natural-enforcement/fixtures/coverage-acks.json',
  );
  const parsed: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
  if (Array.isArray(parsed)) {
    throw new Error('coverage-acks 形状错误：期望 { "acks": [] }，实际是数组');
  }
  const record = recordOf(parsed);
  if (record === null || !Array.isArray(record.acks)) {
    throw new Error('coverage-acks 形状错误：缺少 acks 数组');
  }
  return record.acks.map((item, index): CoverageAck => {
    const ack = recordOf(item);
    if (ack === null || typeof ack.key !== 'string' || typeof ack.keyType !== 'string') {
      throw new Error(`coverage-acks.acks[${index}] 缺少 key 或 keyType`);
    }
    if (ack.keyType !== 'feature-map-node' && ack.keyType !== 'route') {
      throw new Error(`coverage-acks.acks[${index}] keyType 非法`);
    }
    return {
      key: ack.key,
      keyType: ack.keyType,
      ...(typeof ack.kind === 'string' ? { kind: ack.kind } : {}),
      ...(typeof ack.scenarioId === 'string' ? { scenarioId: ack.scenarioId } : {}),
      ...(typeof ack.stepId === 'string' ? { stepId: ack.stepId } : {}),
      ...(typeof ack.identityRef === 'string' ? { identityRef: ack.identityRef } : {}),
    };
  });
}
