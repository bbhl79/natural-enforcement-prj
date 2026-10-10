// 存储接口契约与适配器单测（#53，unit 层无库）。
// 契约断言 = StoragePort 的追加式形态：接口层不存在原地修改/删除成员
//（append-only 最保守语义的接口级表达，防后续切片往接口上加改写通道）。
import { describe, expect, it, vi } from 'vitest';

import type { StoragePort } from '../src/port.ts';
import { createRustFsStorage } from '../src/rustfs-storage.ts';
import type { S3Client } from '../src/s3-client.ts';

describe('StoragePort 追加式契约（#53，append-only 最保守语义）', () => {
  it('接口只含 putVersion/readVersion：改写/删除成员在类型层即被禁止', () => {
    type PortKeys = keyof StoragePort;
    const members: PortKeys[] = ['putVersion', 'readVersion'];
    expect(members).toHaveLength(2);

    // 类型级红侧断言：以下名字若出现在 StoragePort 上，本行即编译失败
    //（根 typecheck 全量跑，构成「接口不得长出改写通道」的机器闸）。
    type IsNever<T> = [T] extends [never] ? true : false;
    const absent: IsNever<('update' | 'overwrite' | 'delete' | 'deleteVersion' | 'put' | 'restore') & PortKeys> =
      true;
    expect(absent).toBe(true);
  });
});

describe('RustFS 适配器（StoragePort 实现）', () => {
  const client = {
    putObject: vi.fn(),
    getObject: vi.fn(),
  } as unknown as S3Client;

  it('putVersion 强制附加 COMPLIANCE 保留头并返回版本引用', async () => {
    client.putObject = vi.fn().mockResolvedValue({ versionId: 'v9' });
    const storage = createRustFsStorage({
      client,
      bucket: 'ne-e3',
      retentionMs: 3_156_000_000_000,
      now: () => new Date('2026-10-10T12:00:00.000Z'),
    });

    const ref = await storage.putVersion('dossier/文书.txt', new Uint8Array([1, 2]));

    expect(ref).toEqual({ fileKey: 'dossier/文书.txt', versionId: 'v9' });
    const [, , , opts] = (client.putObject as ReturnType<typeof vi.fn>).mock.calls[0] as unknown as [
      string,
      string,
      Uint8Array,
      { retention: { mode: string; retainUntil: string } },
    ];
    expect(opts.retention.mode).toBe('COMPLIANCE');
    expect(opts.retention.retainUntil).toBe('2126-10-14T06:40:00Z');
  });

  it('存储端未返回版本 id 即拒绝（追加式世代信息缺失不得静默通过）', async () => {
    client.putObject = vi.fn().mockResolvedValue({ versionId: null });
    const storage = createRustFsStorage({ client, bucket: 'ne-e3' });

    await expect(storage.putVersion('a.txt', new Uint8Array([1]))).rejects.toThrow('版本 id');
  });

  it('readVersion 按版本引用读取（透传 fileKey + versionId）', async () => {
    client.getObject = vi.fn().mockResolvedValue(new Uint8Array([7]));
    const storage = createRustFsStorage({ client, bucket: 'ne-e3' });

    const content = await storage.readVersion({ fileKey: 'a.txt', versionId: 'v1' });

    expect(content).toEqual(new Uint8Array([7]));
    expect(client.getObject).toHaveBeenCalledWith('ne-e3', 'a.txt', 'v1');
  });
});
