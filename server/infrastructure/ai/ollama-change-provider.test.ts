import { describe, expect, it, vi } from 'vitest';
import { MindMapChangeRequestSchema } from '../../../shared/mind-map';
import { OllamaMindMapChangeProvider, type OllamaFetch } from './ollama-change-provider';

function validInitialization() {
  return JSON.stringify({
    baseRevision: 0,
    summary: '建立产品想法导图',
    commands: [
      {
        type: 'replaceDocument',
        document: {
          title: '产品想法',
          root: {
            id: 'product-idea',
            title: '产品想法',
            content: '',
            kind: 'topic',
            status: 'open',
            source: 'summary',
            children: [],
          },
          relations: [],
          groups: [],
        },
      },
    ],
  });
}

function chatResponse(content: string) {
  return new Response(JSON.stringify({ message: { content }, done: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('OllamaMindMapChangeProvider', () => {
  it('repairs invalid JSON exactly once with the same local model', async () => {
    const request = vi
      .fn<OllamaFetch>()
      .mockResolvedValueOnce(chatResponse('not-json'))
      .mockResolvedValueOnce(chatResponse(validInitialization()));
    const provider = new OllamaMindMapChangeProvider({
      baseUrl: 'http://127.0.0.1:11434',
      model: 'qwythos-9b',
      contextSize: 32_768,
      fetch: request,
    });
    const result = await provider.proposeChangeSet(
      MindMapChangeRequestSchema.parse({ input: '记录产品想法', document: null }),
    );

    expect(request).toHaveBeenCalledTimes(2);
    expect(result.commands[0]?.type).toBe('replaceDocument');
    const repairBody = JSON.parse(String(request.mock.calls[1]?.[1]?.body)) as {
      model: string;
      think: boolean;
      format: unknown;
      options: { temperature: number };
    };
    expect(repairBody).toMatchObject({
      model: 'qwythos-9b',
      think: false,
      options: { temperature: 0 },
    });
    expect(repairBody.format).toBeTruthy();
    const transport = repairBody.format as {
      properties: {
        commands: {
          items: {
            properties: {
              document: {
                properties: {
                  root: { required: string[] };
                  relations: { items: { required: string[] } };
                };
              };
            };
          };
        };
      };
    };
    expect(
      transport.properties.commands.items.properties.document.properties.root.required,
    ).toContain('source');
    expect(
      transport.properties.commands.items.properties.document.properties.relations.items.required,
    ).toContain('id');
  });

  it('checks that Ollama exposes the configured model', async () => {
    const request = vi.fn<OllamaFetch>().mockResolvedValue(
      new Response(JSON.stringify({ models: [{ name: 'qwythos-9b:latest' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const provider = new OllamaMindMapChangeProvider({
      baseUrl: 'http://127.0.0.1:11434/',
      model: 'qwythos-9b',
      contextSize: 32_768,
      fetch: request,
    });

    await expect(provider.isReady()).resolves.toBe(true);
    expect(request).toHaveBeenCalledWith(
      'http://127.0.0.1:11434/api/tags',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('does not accept Markdown fences as another protocol', async () => {
    const request = vi
      .fn<OllamaFetch>()
      .mockImplementation(async () => chatResponse(`\`\`\`json\n${validInitialization()}\n\`\`\``));
    const provider = new OllamaMindMapChangeProvider({
      baseUrl: 'http://127.0.0.1:11434',
      model: 'qwythos-9b',
      contextSize: 32_768,
      fetch: request,
    });

    await expect(
      provider.proposeChangeSet(
        MindMapChangeRequestSchema.parse({ input: '记录产品想法', document: null }),
      ),
    ).rejects.toMatchObject({ code: 'AI_BAD_RESPONSE' });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('refuses a remote Ollama endpoint', () => {
    expect(
      () =>
        new OllamaMindMapChangeProvider({
          baseUrl: 'https://example.com',
          model: 'qwen-q4kp',
          contextSize: 16_384,
        }),
    ).toThrow(/loopback/i);
  });

  it('does not repair a response or start another inference after cancellation', async () => {
    const abort = new AbortController();
    const request = vi.fn<OllamaFetch>().mockImplementation(async () => {
      abort.abort();
      return chatResponse('not-json');
    });
    const provider = new OllamaMindMapChangeProvider({
      baseUrl: 'http://127.0.0.1:11434',
      model: 'test',
      contextSize: 4096,
      fetch: request,
    });
    await expect(
      provider.proposeChangeSet(
        MindMapChangeRequestSchema.parse({ input: '继续想', document: null }),
        abort.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(request).toHaveBeenCalledOnce();
  });
});
