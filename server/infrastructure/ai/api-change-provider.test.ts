import { describe, expect, it, vi } from 'vitest';
import { MindMapChangeRequestSchema } from '../../../shared/mind-map';
import { ApiMindMapChangeProvider, validateRemoteAIBaseUrl } from './api-change-provider';

const input = MindMapChangeRequestSchema.parse({ input: '整理测试想法', document: null });
const valid = { baseRevision: 0, summary: '测试', commands: [] };
const chat = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }));
const makeProvider = (request: typeof fetch) =>
  new ApiMindMapChangeProvider({
    baseUrl: 'https://api.example.test/v1',
    apiKey: 'fixture-token',
    model: 'test-model',
    fetch: request,
  });

describe('cloud AI provider', () => {
  it('requires an HTTPS base URL and rejects credential URLs and endpoint URLs', () => {
    for (const url of [
      'http://api.example.test/v1',
      'https://name:password@api.example.test/v1',
      'https://api.example.test/v1?key=example',
      'https://api.example.test/v1/chat/completions',
    ]) {
      expect(() => validateRemoteAIBaseUrl(url)).toThrow();
    }
    expect(validateRemoteAIBaseUrl('https://api.example.test/v1/')).toBe(
      'https://api.example.test/v1',
    );
  });

  it('checks model availability and caches successful metadata checks', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ data: [{ id: 'test-model' }] })));
    const provider = makeProvider(request);
    await expect(provider.isReady()).resolves.toBe(true);
    await expect(provider.isReady()).resolves.toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][1]).toMatchObject({
      redirect: 'error',
      headers: { Authorization: 'Bearer fixture-token' },
    });
  });

  it('does not mark a missing model as ready', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ data: [] })));
    await expect(makeProvider(request).isReady()).resolves.toBe(false);
  });

  it('sends the configured model and returns only validated changes', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(chat(JSON.stringify(valid)));
    await expect(makeProvider(request).proposeChangeSet(input)).resolves.toEqual(valid);
    expect(request.mock.calls[0][0]).toBe('https://api.example.test/v1/chat/completions');
    expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toMatchObject({
      model: 'test-model',
      stream: false,
      max_tokens: 3000,
    });
  });

  it('repairs invalid output once and rejects a second invalid response', async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(async () => chat('not JSON'));
    await expect(makeProvider(request).proposeChangeSet(input)).rejects.toMatchObject({
      code: 'AI_BAD_RESPONSE',
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('uses the repaired response when it passes the schema', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(chat('not JSON'))
      .mockResolvedValueOnce(chat(JSON.stringify(valid)));
    await expect(makeProvider(request).proposeChangeSet(input)).resolves.toEqual(valid);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('does not leak upstream error bodies or credentials', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('fixture-token private upstream content', { status: 401 }));
    const promise = makeProvider(request).proposeChangeSet(input);
    await expect(promise).rejects.toMatchObject({ code: 'AI_NOT_READY' });
    await expect(promise).rejects.not.toThrow(/fixture-token|private upstream/);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('does not start a repair after cancellation', async () => {
    const abort = new AbortController();
    const request = vi.fn<typeof fetch>().mockImplementation(async () => {
      abort.abort();
      return chat('invalid');
    });
    await expect(makeProvider(request).proposeChangeSet(input, abort.signal)).rejects.toMatchObject(
      { name: 'AbortError' },
    );
    expect(request).toHaveBeenCalledTimes(1);
  });
});
