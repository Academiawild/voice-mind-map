import { createServer, type Server } from 'node:http';
import express from 'express';
import { afterEach, expect, it } from 'vitest';
import { OllamaMindMapChangeProvider } from './infrastructure/ai/ollama-change-provider';
import { MindMapChangeService } from './modules/ai/mind-map-change.service';
import { createMindMapChangeRouter } from './routes/mind-map-change.route';

const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0).reverse()) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
async function listen(server: Server) {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  return `http://127.0.0.1:${address.port}`;
}

it('cancels the upstream HTTP request on client disconnect and leaves the next request usable', async () => {
  let started!: () => void;
  let disconnected!: () => void;
  const upstreamStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const upstreamDisconnected = new Promise<void>((resolve) => {
    disconnected = resolve;
  });
  let calls = 0;
  const upstream = await listen(
    createServer((req, res) => {
      req.resume();
      calls += 1;
      if (calls === 1) {
        res.on('close', disconnected);
        started();
        return;
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          message: {
            content: JSON.stringify({
              baseRevision: 0,
              summary: '新的请求完成',
              commands: [
                {
                  type: 'replaceDocument',
                  document: {
                    title: '继续思考',
                    root: {
                      id: 'root',
                      title: '继续思考',
                      content: '',
                      kind: 'topic',
                      source: 'summary',
                      status: 'open',
                      children: [],
                    },
                    relations: [],
                    groups: [],
                  },
                },
              ],
            }),
          },
        }),
      );
    }),
  );
  const provider = new OllamaMindMapChangeProvider({
    baseUrl: upstream,
    model: 'test',
    contextSize: 4096,
  });
  const app = express();
  app.use(express.json());
  app.use('/api', createMindMapChangeRouter(new MindMapChangeService(provider), false));
  const baseUrl = await listen(createServer(app));
  const abort = new AbortController();
  const options = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: '想清楚下一步', document: null }),
  };
  const first = fetch(`${baseUrl}/api/mind-map/change`, { ...options, signal: abort.signal }).catch(
    (error: Error) => error.name,
  );
  await upstreamStarted;
  abort.abort();
  expect(await first).toBe('AbortError');
  await upstreamDisconnected;
  expect(calls).toBe(1);
  const second = await fetch(`${baseUrl}/api/mind-map/change`, options);
  expect(second.status).toBe(200);
  expect(await second.json()).toMatchObject({ document: { title: '继续思考' } });
  expect(calls).toBe(2);
});
