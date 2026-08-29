const DEFAULT_BASE = 'https://api.kie.ai';

/**
 * Build the kie webhook URL we hand to `createTask` so kie can POST
 * back when a task finishes. When `KIE_CALLBACK_SECRET` is set we
 * append it as a `?token=` param — the route handler rejects POSTs
 * whose token doesn't match. kie taskIds aren't secret (they appear
 * in logs, retry payloads, etc.), so without a token the callback is
 * forgeable: anyone who guesses or learns a taskId could mark the job
 * "completed" with attacker-controlled image URLs.
 *
 * Returns `undefined` when `appUrl` is missing — the watchdog poll
 * path picks up jobs without a callback in dev.
 */
export function buildKieCallbackUrl(appUrl: string | null | undefined): string | undefined {
  if (!appUrl) return undefined;
  const base = `${appUrl.replace(/\/$/, '')}/api/kie/callback`;
  const secret = process.env.KIE_CALLBACK_SECRET;
  if (!secret) {
    // Defensively warn at the call site so prod misconfigurations
    // don't fail silently. The route still accepts un-tokened POSTs
    // when KIE_CALLBACK_SECRET is also unset on the server, so the
    // app stays functional in dev/test envs.
    console.warn(
      '[kie] KIE_CALLBACK_SECRET not set — webhook callbacks are unauthenticated'
    );
    return base;
  }
  return `${base}?token=${encodeURIComponent(secret)}`;
}

export type KieState = 'waiting' | 'queuing' | 'generating' | 'success' | 'fail';

export interface KieTaskInfo {
  taskId: string;
  model: string;
  state: KieState;
  param?: string;
  resultJson?: string;
  failCode?: string | null;
  failMsg?: string | null;
  /** seconds */
  costTime?: number;
  completeTime?: number;
  createTime?: number;
  progress?: number;
}

export interface KieResultPayload {
  resultUrls?: string[];
  [key: string]: unknown;
}

export interface CreateTaskOptions {
  model: string;
  input: Record<string, unknown>;
  callBackUrl?: string;
}

// ---------------------------------------------------------------------------
// Chat / LLM API (POST /claude/v1/messages — Anthropic-compatible, sync)
// ---------------------------------------------------------------------------

export type ChatRole = 'user' | 'assistant' | 'system';

export interface ChatTextContent {
  type: 'text';
  text: string;
}

export interface ChatImageContent {
  type: 'image';
  source: {
    type: 'base64' | 'url';
    media_type?: string;
    data?: string;
    url?: string;
  };
}

export type ChatContentBlock = ChatTextContent | ChatImageContent;

export interface ChatMessage {
  role: ChatRole;
  content: string | ChatContentBlock[];
}

// Model ids live in pricing.json (see models.ts SYSTEM_CHAT_MODELS /
// CHAT_MODEL_REGISTRY) — kie is now the fallback text provider only.

export type ChatModel =
  | 'claude-haiku-4-5'
  | 'claude-sonnet-4-5'
  | 'claude-sonnet-4-6'
  | 'claude-opus-4-5'
  | 'claude-opus-4-6'
  | (string & {});

export interface ChatOptions {
  model: ChatModel;
  messages: ChatMessage[];
  system?: string;
  max_tokens?: number;
  stream?: false;
  /** Per-call timeout override. Defaults to 90s for chat (vs 30s elsewhere). */
  timeoutMs?: number;
}

export interface ChatResponse {
  id: string;
  model: string;
  role: 'assistant';
  content: Array<{ type: string; text?: string }>;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  /** Credits consumed by kie for this call — use as exact debit amount. */
  credits_consumed: number;
}

export interface KieClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export class KieError extends Error {
  constructor(
    message: string,
    public code: number,
    public httpStatus?: number
  ) {
    super(message);
    this.name = 'KieError';
  }
}

interface CreateTaskResponse {
  code: number;
  msg: string;
  data?: { taskId: string; recordId?: string };
}

interface RecordInfoResponse {
  code: number;
  msg: string;
  data?: KieTaskInfo;
}

export class KieClient {
  private apiKey: string;
  private baseUrl: string;
  private timeoutMs: number;

  constructor(opts: KieClientOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  private postHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json'
    };
  }

  private getHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}` };
  }

  async createTask(opts: CreateTaskOptions): Promise<{ taskId: string }> {
    const body = {
      model: opts.model,
      input: opts.input,
      ...(opts.callBackUrl ? { callBackUrl: opts.callBackUrl } : {})
    };
    const res = await fetch(`${this.baseUrl}/api/v1/jobs/createTask`, {
      method: 'POST',
      headers: this.postHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    const json = (await res.json().catch(() => ({}))) as CreateTaskResponse;
    if (!res.ok || json.code !== 200 || !json.data?.taskId) {
      throw new KieError(
        `kie createTask failed: ${json.msg ?? `HTTP ${res.status}`}`,
        json.code ?? res.status,
        res.status
      );
    }
    return { taskId: json.data.taskId };
  }

  async getTask(taskId: string): Promise<KieTaskInfo> {
    const url = `${this.baseUrl}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`;
    const res = await fetch(url, {
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    const json = (await res.json().catch(() => ({}))) as RecordInfoResponse;
    if (!res.ok || json.code !== 200 || !json.data) {
      throw new KieError(
        `kie recordInfo failed: ${json.msg ?? `HTTP ${res.status}`}`,
        json.code ?? res.status,
        res.status
      );
    }
    return json.data;
  }

  /**
   * Create a task and poll until it terminates (success or fail).
   * Used in dev and as a fallback when the webhook path is unavailable.
   * In production prefer createTask({ callBackUrl }) + webhook for efficiency.
   */
  async runJob(
    opts: CreateTaskOptions & { pollIntervalMs?: number; maxPollMs?: number }
  ): Promise<KieTaskInfo> {
    const { taskId } = await this.createTask(opts);
    const interval = opts.pollIntervalMs ?? 5_000;
    const max = opts.maxPollMs ?? 5 * 60_000;
    const start = Date.now();

    while (Date.now() - start < max) {
      const info = await this.getTask(taskId);
      if (info.state === 'success' || info.state === 'fail') return info;
      await new Promise((r) => setTimeout(r, interval));
    }

    throw new KieError(`kie task ${taskId} polling timed out after ${max}ms`, 408);
  }

  /** Parse the stringified resultJson on a successful task. */
  parseResult(info: KieTaskInfo): KieResultPayload | null {
    if (!info.resultJson) return null;
    try {
      return JSON.parse(info.resultJson) as KieResultPayload;
    } catch {
      return null;
    }
  }

  /**
   * Synchronous chat completion via Claude (or other supported chat models).
   * Returns the full response including credits_consumed so the caller can
   * debit the user's balance with the exact amount.
   *
   * Extended thinking is explicitly disabled. Claude 4.x models (especially
   * Opus 4.6) default to "thinking enabled", which burns 40-75% of the
   * max_tokens budget on invisible reasoning tokens BEFORE producing the
   * visible output — so a 600-token cap leaves only ~150 tokens for the
   * actual description and the output gets cut mid-sentence. The product
   * copy tasks (title / description / tags) don't benefit from chain-of-
   * thought reasoning, so we trade off thinking for full output budget
   * and deterministic pricing. If a future task genuinely needs thinking,
   * make this configurable per-call rather than flipping the default.
   */
  async chat(opts: ChatOptions): Promise<ChatResponse> {
    const body: Record<string, unknown> = {
      model: opts.model,
      messages: opts.messages,
      max_tokens: opts.max_tokens ?? 2048,
      stream: false,
      thinking: { type: 'disabled' }
    };
    if (opts.system) body.system = opts.system;

    const chatTimeout = opts.timeoutMs ?? Math.max(this.timeoutMs, 90_000);
    const res = await fetch(`${this.baseUrl}/claude/v1/messages`, {
      method: 'POST',
      headers: this.postHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(chatTimeout)
    });
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new KieError(`kie chat returned non-JSON: ${text.slice(0, 200)}`, res.status, res.status);
    }
    if (!res.ok) {
      const msg =
        (parsed as { error?: { message?: string } })?.error?.message ?? `HTTP ${res.status}`;
      throw new KieError(`kie chat failed: ${msg}`, res.status, res.status);
    }
    return parsed as ChatResponse;
  }

  /** Convenience: extract concatenated text from a chat response. */
  static extractText(response: ChatResponse): string {
    return response.content
      .filter((c) => c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text as string)
      .join('\n')
      .trim();
  }
}

let cached: KieClient | null = null;

/** Singleton client built from env. Throws at first call if KIE_API_KEY is missing. */
export function getKieClient(): KieClient {
  if (cached) return cached;
  const apiKey = process.env.KIE_API_KEY;
  if (!apiKey) throw new Error('KIE_API_KEY is not set');
  cached = new KieClient({
    apiKey,
    baseUrl: process.env.KIE_BASE_URL,
    timeoutMs: 30_000
  });
  return cached;
}
