import { createServer } from 'node:http';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MindMapChangeService } from '../modules/ai/mind-map-change.service';
import { createMindMapChangeRouter } from './mind-map-change.route';

const servers: Array<ReturnType<typeof createServer>> = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

async function start(service: MindMapChangeService) {
  const app = express();
  app.use(express.json());
  app.use('/api', createMindMapChangeRouter(service, false));
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind.');
  return `http://127.0.0.1:${address.port}`;
}

describe('mind map change route', () => {
  it('validates request contracts before invoking the service', async () => {
    const service = { change: vi.fn() } as unknown as MindMapChangeService;
    const baseUrl = await start(service);
    const response = await fetch(`${baseUrl}/api/mind-map/change`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: '', document: null }),
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(service.change).not.toHaveBeenCalled();
  });
});
