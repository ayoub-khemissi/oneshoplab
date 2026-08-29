/**
 * Minimal Discord incoming-webhook client. No SDK: a webhook is a plain
 * POST of {content, embeds} to a URL that already carries its own secret
 * (the URL IS the credential — keep it in .env, never in the client
 * bundle, never in logs).
 *
 * Dev-friendly: when the URL is unset we warn and report ok:false so the
 * caller can record "not notified" without throwing — a missing webhook
 * must never break the user-facing flow that triggered it.
 */

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: DiscordEmbedField[];
  footer?: { text: string };
  timestamp?: string;
}

export interface DiscordWebhookMessage {
  content?: string;
  username?: string;
  embeds?: DiscordEmbed[];
}

export interface DiscordPostResult {
  ok: boolean;
  reason?: string;
}

/** Discord hard limits — exceeding them makes the whole POST 400. */
const MAX_FIELD_VALUE = 1024;
const MAX_DESCRIPTION = 4096;

export function truncateForDiscord(value: string, max: number): string {
  const v = value.trim();
  return v.length <= max ? v : `${v.slice(0, max - 1)}…`;
}

export function isDiscordContactWebhookConfigured(): boolean {
  return Boolean(process.env.DISCORD_CONTACT_WEBHOOK_URL);
}

export async function postDiscordWebhook(
  url: string | undefined,
  message: DiscordWebhookMessage
): Promise<DiscordPostResult> {
  if (!url) {
    console.warn('[discord] webhook URL not configured — dropping message');
    return { ok: false, reason: 'unconfigured' };
  }
  const safe: DiscordWebhookMessage = {
    ...message,
    embeds: message.embeds?.map((e) => ({
      ...e,
      description: e.description ? truncateForDiscord(e.description, MAX_DESCRIPTION) : undefined,
      fields: e.fields?.map((f) => ({
        ...f,
        value: truncateForDiscord(f.value || '—', MAX_FIELD_VALUE)
      }))
    }))
  };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(safe),
      signal: AbortSignal.timeout(10_000)
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error('[discord] webhook POST failed', res.status, body.slice(0, 200));
      return { ok: false, reason: `http_${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    console.error('[discord] webhook POST threw', (e as Error).message);
    return { ok: false, reason: 'network' };
  }
}
