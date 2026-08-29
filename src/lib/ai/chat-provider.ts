import { getKieClient, type ChatContentBlock, type ChatMessage } from './kie';
import { PROVIDER_UNIT_USD, type ChatModelRef } from './models';

/**
 * Text-generation provider layer. OpenRouter is the primary route (one
 * key, provider-side failover, per-response cost), kie.ai the fallback
 * — kie's Claude proxy went down for weeks in summer 2026 and every
 * text generation failed with it, which is why this layer exists.
 *
 * Callers pass a `ChatModelRef` from the catalog (pricing.json via
 * models.ts) — never a raw provider string — so swapping a model is a
 * JSON edit. The response shape mirrors what kie returned so the
 * existing parsers keep working: `text` + `creditsConsumed` (provider
 * units of PROVIDER_UNIT_USD, the unit the ledger/jobs already use).
 */

export interface ChatCompletionRequest {
  model: ChatModelRef;
  system?: string;
  messages: ChatMessage[];
  max_tokens: number;
  /** Per-call timeout; text generations are short — default 90s. */
  timeoutMs?: number;
}

export interface ChatCompletionResult {
  text: string;
  /** Provider units consumed (1 unit = PROVIDER_UNIT_USD). */
  creditsConsumed: number;
  usage: { inputTokens: number; outputTokens: number; costUsd: number };
  provider: 'openrouter' | 'kie';
  model: string;
}

export class ChatProviderError extends Error {
  constructor(
    message: string,
    public provider: 'openrouter' | 'kie',
    public status?: number
  ) {
    super(message);
    this.name = 'ChatProviderError';
  }
}

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

export function isOpenRouterConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

/** Strip a ```lang … ``` wrapper some models add despite "no fences". */
export function stripCodeFences(text: string): string {
  const t = text.trim();
  const m = t.match(/^```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n?```$/);
  return m ? m[1].trim() : t;
}

/** Anthropic-style content blocks (what our prompt builders produce) →
 *  OpenAI-style parts OpenRouter expects. */
function toOpenAIContent(content: string | ChatContentBlock[]) {
  if (typeof content === 'string') return content;
  return content.map((b) => {
    if (b.type === 'text') return { type: 'text' as const, text: b.text };
    const src = b.source;
    const url =
      src.type === 'url'
        ? src.url ?? ''
        : `data:${src.media_type ?? 'image/png'};base64,${src.data ?? ''}`;
    return { type: 'image_url' as const, image_url: { url } };
  });
}

async function viaOpenRouter(req: ChatCompletionRequest): Promise<ChatCompletionResult> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new ChatProviderError('OPENROUTER_API_KEY not set', 'openrouter');
  const messages = [
    ...(req.system ? [{ role: 'system' as const, content: req.system }] : []),
    ...req.messages.map((m) => ({ role: m.role, content: toOpenAIContent(m.content) }))
  ];
  const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      'HTTP-Referer': process.env.APP_URL ?? 'https://oneshoplab.com',
      'X-Title': 'OneShopLab'
    },
    body: JSON.stringify({
      model: req.model.openrouterId,
      messages,
      max_tokens: req.max_tokens,
      // Product copy doesn't benefit from chain-of-thought, and on
      // reasoning-by-default models (Sonnet 5) the hidden reasoning
      // eats the max_tokens budget — a title came back EMPTY in testing.
      reasoning: { enabled: false },
      usage: { include: true }
    }),
    signal: AbortSignal.timeout(req.timeoutMs ?? 90_000)
  });
  const json = (await res.json().catch(() => ({}))) as {
    error?: { message?: string; code?: number };
    choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
    model?: string;
  };
  if (!res.ok || json.error) {
    throw new ChatProviderError(
      `openrouter chat failed: ${json.error?.message ?? `HTTP ${res.status}`}`,
      'openrouter',
      res.status
    );
  }
  const text = stripCodeFences(String(json.choices?.[0]?.message?.content ?? ''));
  if (!text) throw new ChatProviderError('openrouter returned an empty completion', 'openrouter', res.status);
  const costUsd = Number(json.usage?.cost ?? 0);
  return {
    text,
    creditsConsumed: Math.max(0, Math.ceil(costUsd / PROVIDER_UNIT_USD)),
    usage: {
      inputTokens: json.usage?.prompt_tokens ?? 0,
      outputTokens: json.usage?.completion_tokens ?? 0,
      costUsd
    },
    provider: 'openrouter',
    model: json.model ?? req.model.openrouterId
  };
}

async function viaKie(req: ChatCompletionRequest): Promise<ChatCompletionResult> {
  const kie = getKieClient();
  const response = await kie.chat({
    model: req.model.kieModelId,
    system: req.system,
    messages: req.messages,
    max_tokens: req.max_tokens,
    timeoutMs: req.timeoutMs
  });
  const text = stripCodeFences(
    response.content
      .filter((c) => c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text as string)
      .join('\n')
  );
  return {
    text,
    creditsConsumed: response.credits_consumed,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      costUsd: response.credits_consumed * PROVIDER_UNIT_USD
    },
    provider: 'kie',
    model: req.model.kieModelId
  };
}

/**
 * OpenRouter first (one retry on 429/5xx/network), then kie if it is
 * configured. Throws the last error when every route fails.
 */
export async function chatCompletion(req: ChatCompletionRequest): Promise<ChatCompletionResult> {
  let lastError: Error | null = null;
  if (isOpenRouterConfigured()) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await viaOpenRouter(req);
      } catch (e) {
        lastError = e as Error;
        const status = (e as ChatProviderError).status;
        const retryable = status === undefined || status === 429 || status >= 500;
        console.error(`[chat-provider] openrouter attempt ${attempt + 1} failed`, lastError.message);
        if (!retryable) break;
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      }
    }
  }
  if (process.env.KIE_API_KEY) {
    try {
      const r = await viaKie(req);
      if (lastError) console.warn('[chat-provider] served by kie fallback');
      return r;
    } catch (e) {
      lastError = e as Error;
      console.error('[chat-provider] kie fallback failed', lastError.message);
    }
  }
  throw lastError ?? new ChatProviderError('no chat provider configured', 'openrouter');
}
