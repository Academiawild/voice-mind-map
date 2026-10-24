import { createServer } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { attachRealtimeTranscriptionServer } from './realtime-transcription-server';

vi.mock('./infrastructure/files/output-archive', () => ({
  writeTranscriptionLog: vi.fn().mockResolvedValue(undefined),
}));

const closeCallbacks: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of closeCallbacks.splice(0).reverse()) {
    await close();
  }
});

function listen(server: ReturnType<typeof createServer>) {
  return new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Server did not bind.');
      resolve(address.port);
    });
  });
}

describe('realtime transcription proxy', () => {
  it('forwards browser PCM to local FunASR and returns structured transcripts', async () => {
    const upstreamHttp = createServer();
    const upstream = new WebSocketServer({ server: upstreamHttp });
    const upstreamPort = await listen(upstreamHttp);
    closeCallbacks.push(async () => {
      for (const client of upstream.clients) client.terminate();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
      await new Promise<void>((resolve) => upstreamHttp.close(() => resolve()));
    });

    let resolveEnd: (value: boolean) => void = () => undefined;
    const receivedEnd = new Promise<boolean>((resolve) => {
      resolveEnd = resolve;
    });
    const receivedBinary = new Promise<Buffer>((resolve) => {
      upstream.on('connection', (socket) => {
        let wavName = 'microphone';
        socket.on('message', (data, isBinary) => {
          if (!isBinary) {
            const message = JSON.parse(data.toString()) as {
              is_speaking?: boolean;
              wav_name?: string;
            };
            if (message.wav_name) wavName = message.wav_name;
            if (message.is_speaking === false) resolveEnd(true);
            return;
          }
          if (!Buffer.from(data as Buffer).byteLength) {
            socket.send(
              JSON.stringify({
                text: '',
                mode: '2pass-offline',
                is_final: true,
                wav_name: wavName,
              }),
            );
            return;
          }
          resolve(Buffer.from(data as Buffer));
          socket.send(
            JSON.stringify({
              text: '本地实时结果',
              mode: '2pass-offline',
              is_final: true,
              wav_name: wavName,
            }),
          );
        });
      });
    });

    const proxyHttp = createServer();
    attachRealtimeTranscriptionServer(proxyHttp, {
      upstreamPort,
      allowedOrigins: new Set(['http://127.0.0.1:5173']),
    });
    const proxyPort = await listen(proxyHttp);
    closeCallbacks.push(() => new Promise<void>((resolve) => proxyHttp.close(() => resolve())));

    const browser = new WebSocket(`ws://127.0.0.1:${proxyPort}/api/transcription/stream`, {
      headers: { Origin: 'http://127.0.0.1:5173' },
    });
    closeCallbacks.push(async () => {
      if (browser.readyState === WebSocket.CLOSED) return;
      await new Promise<void>((resolve) => {
        browser.once('close', () => resolve());
        browser.terminate();
      });
    });
    await new Promise<void>((resolve, reject) => {
      browser.once('open', resolve);
      browser.once('error', reject);
    });
    const transcript = new Promise<unknown>((resolve) => {
      browser.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.complete) resolve(message);
      });
    });
    browser.send(Buffer.from([1, 2, 3, 4]));
    browser.send(JSON.stringify({ type: 'end' }));

    await expect(receivedBinary).resolves.toEqual(Buffer.from([1, 2, 3, 4]));
    await expect(receivedEnd).resolves.toBe(true);
    await expect(transcript).resolves.toEqual({
      type: 'final',
      text: '本地实时结果',
      complete: true,
    });
  });

  it('replaces online fragments with corrected segments and waits for the actual end marker', async () => {
    const upstreamHttp = createServer();
    const upstream = new WebSocketServer({ server: upstreamHttp });
    const upstreamPort = await listen(upstreamHttp);
    closeCallbacks.push(async () => {
      for (const client of upstream.clients) client.terminate();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
      await new Promise<void>((resolve) => upstreamHttp.close(() => resolve()));
    });
    upstream.on('connection', (socket) => {
      let wavName = 'microphone';
      const send = (text: string, mode: string) =>
        socket.send(JSON.stringify({ text, mode, wav_name: wavName }));
      socket.on('message', (data, isBinary) => {
        if (isBinary) {
          if (Buffer.from(data as Buffer).length === 0) send('最后一句。', '2pass-offline');
          return;
        }
        const message = JSON.parse(data.toString());
        if (message.is_speaking === false) {
          // This queued segment final arrives after the browser requested end,
          // but was produced before FunASR processed that control message.
          send('我想学习。', '2pass-offline');
          wavName = message.wav_name;
          return;
        }
        send('我想学戏', '2pass-online');
        send('我想学习。', '2pass-offline');
        send('我想', '2pass-online');
        send('学习', '2pass-online');
      });
    });
    const proxyHttp = createServer();
    attachRealtimeTranscriptionServer(proxyHttp, {
      upstreamPort,
      allowedOrigins: new Set(['http://127.0.0.1:5173']),
    });
    const proxyPort = await listen(proxyHttp);
    closeCallbacks.push(() => new Promise<void>((resolve) => proxyHttp.close(() => resolve())));
    const browser = new WebSocket(`ws://127.0.0.1:${proxyPort}/api/transcription/stream`, {
      headers: { Origin: 'http://127.0.0.1:5173' },
    });
    closeCallbacks.push(async () => {
      browser.terminate();
    });
    const results: Array<{ text: string; complete?: boolean }> = [];
    const completed = new Promise<unknown>((resolve) => {
      browser.on('message', (data) => {
        const message = JSON.parse(data.toString());
        results.push(message);
        if (message.complete) resolve(message);
      });
    });
    await new Promise<void>((resolve) => browser.once('open', resolve));
    browser.send(JSON.stringify({ type: 'end' }));
    await expect(completed).resolves.toEqual({
      type: 'final',
      text: '我想学习。我想学习。最后一句。',
      complete: true,
    });
    expect(results.at(-2)).toEqual({ type: 'final', text: '我想学习。我想学习。' });
    expect(results.at(-1)?.text).not.toContain('学戏');
  });
});
