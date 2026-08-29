/**
 * Client for the OneShopLab Discord bot's HTTP API
 * (../oneshoplab-discord-bot, Fastify on 127.0.0.1:3101, PM2
 * `oneshoplab-discord-bot`). The bot owns the Discord token and the
 * channel-id map; the web app only ever posts plain content into a
 * named channel through it — no discord.js, no token here.
 *
 * Contract (src/routes/messages.ts in the bot):
 *   POST {DISCORD_BOT_API_URL}/api/messages
 *   headers: x-api-key: {DISCORD_BOT_API_KEY}   (= the bot's BOT_API_KEY)
 *   body:    { channel: <name>, content: <string ≤ 4000> }
 *
 * Dev-friendly: when the URL/key are unset we warn and return ok:false
 * so callers can record "not notified" without throwing — a missing
 * bot must never break the user-facing flow that triggered the post.
 */

/** Channel names the bot's API accepts (its VALID_CHANNELS enum). */
export type DiscordChannel =
  | 'welcome'
  | 'rules'
  | 'announcements'
  | 'changelog'
  | 'suggestions'
  | 'bug-reports'
  | 'support'
  | 'staff-logs'
  | 'contact';

export interface DiscordPostResult {
  ok: boolean;
  messageId?: string;
  reason?: string;
}

/** Discord hard limit on message content; the bot's schema enforces it too. */
export const DISCORD_CONTENT_MAX = 4000;

export function truncateForDiscord(value: string, max: number): string {
  const v = value.trim();
  return v.length <= max ? v : `${v.slice(0, max - 1)}…`;
}

export function isDiscordBotConfigured(): boolean {
  return Boolean(process.env.DISCORD_BOT_API_URL && process.env.DISCORD_BOT_API_KEY);
}

export async function postDiscordMessage(
  channel: DiscordChannel,
  content: string
): Promise<DiscordPostResult> {
  const base = process.env.DISCORD_BOT_API_URL?.replace(/\/$/, '');
  const key = process.env.DISCORD_BOT_API_KEY;
  if (!base || !key) {
    console.warn(
      '[discord] bot API not configured (DISCORD_BOT_API_URL / _KEY) — dropping message'
    );
    return { ok: false, reason: 'unconfigured' };
  }
  try {
    const res = await fetch(`${base}/api/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key },
      body: JSON.stringify({ channel, content: truncateForDiscord(content, DISCORD_CONTENT_MAX) }),
      signal: AbortSignal.timeout(10_000)
    });
    const json = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      messageId?: string;
      error?: string;
    };
    if (!res.ok || !json.success) {
      console.error('[discord] bot API POST failed', res.status, json.error ?? '');
      return { ok: false, reason: json.error ?? `http_${res.status}` };
    }
    return { ok: true, messageId: json.messageId };
  } catch (e) {
    console.error('[discord] bot API POST threw', (e as Error).message);
    return { ok: false, reason: 'network' };
  }
}
