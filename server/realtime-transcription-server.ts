import type { IncomingMessage, Server as HttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { z } from 'zod';
import { writeTranscriptionLog } from './infrastructure/files/output-archive';

const FunASRMessageSchema = z.object({
  text: z.string().default(''),
  mode: z.union([z.string(), z.array(z.string())]).optional(),
  is_final: z.boolean().optional(),
  wav_name: z.string().optional(),
});
type FunASRMessage = z.infer<typeof FunASRMessageSchema>;

const BROWSER_PATH = '/api/transcription/stream';
const MAX_BROWSER_MESSAGE_BYTES = 256 * 1024;
const MAX_PENDING_PCM_BYTES = 512 * 1024;
const STREAM_OFFLINE_MESSAGE =
  '\u8bf7\u7a0d\u7b49\uff0c\u8bed\u97f3\u6a21\u578b\u6b63\u5728\u52a0\u8f7d\u4e2d\u3002\u52a0\u8f7d\u5b8c\u6210\u540e\u518d\u5f00\u59cb\u5f55\u97f3\u3002';

function sendBrowserMessage(
  socket: WebSocket,
  payload:
    | { type: 'partial' | 'final'; text: string; complete?: boolean }
    | { type: 'error'; error: string },
) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function parseFunASRMessage(raw: WebSocket.RawData): FunASRMessage | null {
  const text = typeof raw === 'string' ? raw : raw.toString();
  if (!text.trim()) {
    return null;
  }

  try {
    const parsed = FunASRMessageSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function resolveResultType(message: FunASRMessage): 'partial' | 'final' {
  const mode = Array.isArray(message.mode)
    ? message.mode.join(' ').toLowerCase()
    : typeof message.mode === 'string'
      ? message.mode.toLowerCase()
      : '';

  if (message.is_final === true || mode.includes('offline')) {
    return 'final';
  }

  if (mode.includes('online')) {
    return 'partial';
  }

  return 'partial';
}

function createFunASRSocket(port: number) {
  return new WebSocket(`ws://127.0.0.1:${port}`, 'binary', {
    rejectUnauthorized: false,
  });
}

function handleBrowserConnection(
  browserSocket: WebSocket,
  _request: IncomingMessage,
  upstreamPort: number,
) {
  const upstreamSocket = createFunASRSocket(upstreamPort);
  let browserEnded = false;
  let upstreamEnded = false;
  const endMarker = `recording-end-${randomUUID()}`;
  let lastLoggedText = '';
  let committedTranscript = '';
  let partialTranscript = '';
  let pendingPcmBytes = 0;
  const pendingPcm: Buffer[] = [];

  const endUpstream = () => {
    if (upstreamEnded || upstreamSocket.readyState !== WebSocket.OPEN) return;
    upstreamEnded = true;
    upstreamSocket.send(JSON.stringify({ is_speaking: false, wav_name: endMarker }));
    // The local FunASR loop handles config separately and flushes on a binary
    // frame. An empty frame drains the existing audio without adding samples.
    upstreamSocket.send(Buffer.alloc(0), { binary: true });
  };

  upstreamSocket.on('open', () => {
    upstreamSocket.send(
      JSON.stringify({
        mode: '2pass',
        chunk_size: [5, 10, 5],
        chunk_interval: 10,
        wav_name: 'microphone',
        is_speaking: true,
        audio_fs: 16000,
      }),
    );
    for (const chunk of pendingPcm.splice(0)) {
      upstreamSocket.send(chunk, { binary: true });
    }
    pendingPcmBytes = 0;
    if (browserEnded) endUpstream();
  });

  upstreamSocket.on('message', (raw) => {
    const message = parseFunASRMessage(raw);
    if (!message) return;

    const type = resolveResultType(message);
    const transcript = message.text.trim();
    // Online messages are incremental fragments; offline results replace the
    // current segment. Previously both were appended, duplicating corrections.
    const complete = browserEnded && message.wav_name === endMarker && type === 'final';
    const unfinishedSegment = complete && !transcript && Boolean(partialTranscript);
    if (type === 'final') {
      committedTranscript += transcript;
      partialTranscript = '';
    } else {
      partialTranscript += transcript;
    }
    const mergedTranscript = `${committedTranscript}${partialTranscript}`;
    if (!mergedTranscript && !complete) return;
    sendBrowserMessage(browserSocket, {
      type,
      text: mergedTranscript,
      ...(complete && !unfinishedSegment ? { complete: true } : {}),
    });

    if ((type === 'final' || browserEnded) && mergedTranscript !== lastLoggedText) {
      lastLoggedText = mergedTranscript;
      void writeTranscriptionLog({
        source: 'realtime-stream',
        type,
        text: mergedTranscript,
        meta: {
          mode: Array.isArray(message.mode) ? message.mode.join(',') : message.mode,
          browserEnded,
        },
      }).catch((error) => {
        console.error('[transcription log failed]', error);
      });
    }

    if (complete) {
      if (browserSocket.readyState === WebSocket.OPEN) {
        browserSocket.close();
      }
      upstreamSocket.close();
    }
  });

  upstreamSocket.on('error', () => {
    sendBrowserMessage(browserSocket, {
      type: 'error',
      error: STREAM_OFFLINE_MESSAGE,
    });
    if (browserSocket.readyState === WebSocket.OPEN) {
      browserSocket.close();
    }
  });

  upstreamSocket.on('close', () => {
    if (browserSocket.readyState === WebSocket.OPEN) {
      browserSocket.close();
    }
  });

  browserSocket.on('message', (raw, isBinary) => {
    if (isBinary) {
      if (browserEnded) return;
      if (upstreamSocket.readyState === WebSocket.OPEN) {
        upstreamSocket.send(raw, { binary: true });
      } else if (upstreamSocket.readyState === WebSocket.CONNECTING) {
        const chunk = Buffer.from(raw as Buffer);
        if (pendingPcmBytes + chunk.byteLength <= MAX_PENDING_PCM_BYTES) {
          pendingPcm.push(chunk);
          pendingPcmBytes += chunk.byteLength;
        } else {
          sendBrowserMessage(browserSocket, {
            type: 'error',
            error: '实时连接未能跟上录音，将使用完整录音转写。',
          });
          browserSocket.close();
        }
      }
      return;
    }

    try {
      const message = JSON.parse(raw.toString()) as { type?: string };
      if (message.type === 'end') {
        browserEnded = true;
        endUpstream();
      }
    } catch {
      sendBrowserMessage(browserSocket, {
        type: 'error',
        error: 'Invalid stream control message.',
      });
    }
  });

  browserSocket.on('close', () => {
    browserEnded = true;
    if (upstreamSocket.readyState === WebSocket.OPEN) {
      upstreamSocket.send(JSON.stringify({ is_speaking: false }));
      upstreamSocket.close();
    } else if (upstreamSocket.readyState === WebSocket.CONNECTING) {
      upstreamSocket.close();
    }
  });

  browserSocket.on('error', () => {
    if (
      upstreamSocket.readyState === WebSocket.OPEN ||
      upstreamSocket.readyState === WebSocket.CONNECTING
    ) {
      upstreamSocket.close();
    }
  });
}

export function attachRealtimeTranscriptionServer(
  server: HttpServer,
  options: {
    upstreamPort: number;
    allowedOrigins: Set<string>;
  },
) {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_BROWSER_MESSAGE_BYTES,
  });

  wss.on('connection', (socket, request) => {
    handleBrowserConnection(socket, request, options.upstreamPort);
  });

  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    const origin = request.headers.origin;
    if (pathname !== BROWSER_PATH || !origin || !options.allowedOrigins.has(origin)) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (webSocket) => {
      wss.emit('connection', webSocket, request);
    });
  });
}
