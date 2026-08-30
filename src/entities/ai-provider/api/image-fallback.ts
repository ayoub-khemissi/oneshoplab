import { randomUUID } from 'node:crypto';
import { uploadBuffer } from '@/shared/storage';
import { IMAGE_FALLBACK_MODEL, PROVIDER_UNIT_USD } from '@/entities/ai-model';

/**
 * Image fallback: when kie fails an image job (webhook `fail`, watchdog
 * timeout, createTask error), regenerate the same edit through
 * OpenRouter with the catalog's `imageFallbackModel` and persist the
 * result to R2 — the merchant gets an image instead of an error, and we
 * only pay the (higher) fallback price on kie's failures.
 *
 * The model is a JSON knob (pricing.json → imageFallbackModel); Gemini
 * 3.1 Flash Image was picked after a side-by-side test on real product
 * shots: label text intact, ~11s, ~0.07 $/image (kie: 0.03 $).
 */

export interface ImageFallbackInput {
  jobId: string;
  prompt: string;
  /** Source product photo to edit; omitted → text-to-image. */
  sourceImageUrl?: string | null;
}

export interface ImageFallbackResult {
  publicUrl: string;
  key: string;
  costUsd: number;
  providerUnits: number;
  model: string;
}

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

export function isImageFallbackConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

export async function generateFallbackImage(
  input: ImageFallbackInput
): Promise<ImageFallbackResult> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY not set — image fallback unavailable');

  const parts: Array<Record<string, unknown>> = [{ type: 'text', text: input.prompt }];
  if (input.sourceImageUrl)
    parts.push({ type: 'image_url', image_url: { url: input.sourceImageUrl } });

  const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      'HTTP-Referer': process.env.APP_URL ?? 'https://oneshoplab.com',
      'X-Title': 'OneShopLab'
    },
    body: JSON.stringify({
      model: IMAGE_FALLBACK_MODEL.openrouterId,
      modalities: ['image', 'text'],
      messages: [{ role: 'user', content: parts }],
      usage: { include: true }
    }),
    // Image models are slow-ish (10-60s); leave headroom.
    signal: AbortSignal.timeout(180_000)
  });
  const json = (await res.json().catch(() => ({}))) as {
    error?: { message?: string };
    choices?: Array<{
      message?: { images?: Array<{ image_url?: { url?: string } }>; content?: string };
    }>;
    usage?: { cost?: number };
    model?: string;
  };
  if (!res.ok || json.error) {
    throw new Error(`openrouter image failed: ${json.error?.message ?? `HTTP ${res.status}`}`);
  }
  const dataUrl = json.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  const m = dataUrl?.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
  if (!m) throw new Error('openrouter image returned no image payload');
  const contentType = m[1].toLowerCase();
  const ext = contentType === 'image/jpeg' ? 'jpg' : contentType === 'image/webp' ? 'webp' : 'png';
  const buffer = Buffer.from(m[2], 'base64');

  // Same key layout as the kie path so r2-cleanup / showcase logic treat
  // fallback images exactly like primary ones.
  const objectKey = `kie/${input.jobId}/${randomUUID()}.${ext}`;
  const uploaded = await uploadBuffer(buffer, objectKey, contentType);
  const costUsd = Number(json.usage?.cost ?? 0);
  return {
    publicUrl: uploaded.publicUrl,
    key: objectKey,
    costUsd,
    providerUnits: Math.ceil(costUsd / PROVIDER_UNIT_USD),
    model: json.model ?? IMAGE_FALLBACK_MODEL.openrouterId
  };
}
