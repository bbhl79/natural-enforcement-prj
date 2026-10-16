import 'reflect-metadata';
import type { AddressInfo } from 'node:net';

import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { HealthController } from './health.controller.ts';

@Module({ controllers: [HealthController] })
class HealthTestModule {}

describe('GET /api/health', () => {
  let baseUrl = '';
  let close: () => Promise<void> = async () => {};

  beforeAll(async () => {
    const app = await NestFactory.create(HealthTestModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
    close = () => app.close();
  }, 20000);

  afterAll(async () => {
    await close();
  });

  it('不要求会话', async () => {
    const response = await fetch(baseUrl + '/api/health');
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(await response.json()).toEqual({ status: 'ok' });
  });
});
