import type { ZodTypeAny, z } from 'zod';
import { errorResponse } from './errors';

export const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

export type ParsedBody<S extends ZodTypeAny> =
  { ok: true; data: z.infer<S> } | { ok: false; response: Response };

/**
 * Parse + validate a JSON body. Accepts the raw text (when the caller
 * already consumed the stream, e.g. for signature verification) or the
 * Request itself. Failures come back as ready-made envelopes:
 * 413 `payload_too_large`, 422 `validation` (with zod issues).
 */
export async function parseJsonBody<S extends ZodTypeAny>(
  input: Request | string,
  schema: S,
  opts: { maxBytes?: number } = {}
): Promise<ParsedBody<S>> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BODY_BYTES;
  let raw: string;
  if (typeof input === 'string') {
    raw = input;
  } else {
    const declared = Number(input.headers.get('content-length') ?? 0);
    if (declared > maxBytes) return { ok: false, response: tooLarge(maxBytes) };
    raw = await input.text();
  }
  if (Buffer.byteLength(raw) > maxBytes) return { ok: false, response: tooLarge(maxBytes) };

  let json: unknown;
  try {
    json = raw.length === 0 ? {} : JSON.parse(raw);
  } catch {
    return {
      ok: false,
      response: errorResponse('validation', 'Body is not valid JSON', 422)
    };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      response: errorResponse('validation', 'Invalid request body', 422, {
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
      })
    };
  }
  return { ok: true, data: parsed.data };
}

function tooLarge(maxBytes: number): Response {
  return errorResponse('payload_too_large', `Body exceeds ${maxBytes} bytes`, 413, { maxBytes });
}
