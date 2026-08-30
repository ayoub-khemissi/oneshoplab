/**
 * Provider routing: OpenRouter first (one retry on 429/5xx/network), kie as
 * fallback, and the failure of both surfaces the last error. `fetch` and the
 * kie client are stubbed — no network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const kieChat = vi.fn();
vi.mock('@/entities/ai-provider/api/kie', () => ({ getKieClient: () => ({ chat: kieChat }) }));

import { chatCompletion, ChatProviderError, stripCodeFences } from '@/entities/ai-provider';
import { getChatModel } from '@/entities/ai-model';

const req = () => ({
  model: getChatModel('sonnet-5'),
  messages: [{ role: 'user' as const, content: 'hello' }],
  max_tokens: 50
});

function orResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}
const okBody = (text: string) => ({
  choices: [{ message: { content: text } }],
  usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.011 },
  model: 'anthropic/claude-sonnet-5'
});

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  kieChat.mockReset();
  kieChat.mockResolvedValue({
    id: 'msg_1',
    model: 'claude-sonnet-5',
    role: 'assistant',
    content: [{ type: 'text', text: 'from kie' }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 1, output_tokens: 1 }
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('chatCompletion', () => {
  it('serves from OpenRouter and bills ceil(cost / providerUnit)', async () => {
    fetchMock.mockResolvedValueOnce(orResponse(200, okBody('Title')));
    const r = await chatCompletion(req());
    expect(r.provider).toBe('openrouter');
    expect(r.text).toBe('Title');
    expect(r.creditsConsumed).toBe(Math.ceil(0.011 / 0.005));
    expect(kieChat).not.toHaveBeenCalled();
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.reasoning).toEqual({ enabled: false });
    expect(body.model).toBe(getChatModel('sonnet-5').openrouterId);
  });

  it('retries once on 5xx, then succeeds without touching kie', async () => {
    fetchMock
      .mockResolvedValueOnce(orResponse(502, { error: { message: 'bad gateway' } }))
      .mockResolvedValueOnce(orResponse(200, okBody('second try')));
    const r = await chatCompletion(req());
    expect(r.text).toBe('second try');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(kieChat).not.toHaveBeenCalled();
  });

  it('does not retry a 4xx, falls straight through to kie', async () => {
    fetchMock.mockResolvedValueOnce(orResponse(400, { error: { message: 'bad request' } }));
    const r = await chatCompletion(req());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r.provider).toBe('kie');
    expect(r.text).toBe('from kie');
  });

  it('falls back to kie after two OpenRouter failures (network)', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const r = await chatCompletion(req());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(r.provider).toBe('kie');
  });

  it('treats an empty OpenRouter completion as a failure', async () => {
    fetchMock.mockResolvedValue(orResponse(200, okBody('')));
    const r = await chatCompletion(req());
    expect(r.provider).toBe('kie');
  });

  it('throws the last error when every provider fails', async () => {
    fetchMock.mockResolvedValue(orResponse(503, { error: { message: 'down' } }));
    kieChat.mockRejectedValue(new Error('kie 500'));
    await expect(chatCompletion(req())).rejects.toThrow('kie 500');
  });

  it('skips OpenRouter entirely when not configured', async () => {
    const saved = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    try {
      const r = await chatCompletion(req());
      expect(fetchMock).not.toHaveBeenCalled();
      expect(r.provider).toBe('kie');
    } finally {
      process.env.OPENROUTER_API_KEY = saved;
    }
  });
});

describe('stripCodeFences', () => {
  it('unwraps ```json fences and leaves plain text alone', () => {
    expect(stripCodeFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripCodeFences('plain')).toBe('plain');
  });
  it('is typed as ChatProviderError on provider failures', () => {
    expect(new ChatProviderError('x', 'openrouter', 500).status).toBe(500);
  });
});
