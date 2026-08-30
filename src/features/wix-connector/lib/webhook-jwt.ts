/**
 * Wix delivers webhooks as a JWT (RS256, signed with the app's private key;
 * we hold the public key from the Dev Center). The `data` claim is a JSON
 * string whose own `data` is again a JSON string — hence the two parses.
 */
import { createVerify } from 'node:crypto';

export interface WixWebhookEvent {
  instanceId: string;
  /** Raw event type / slug as sent (`ProductChanged`, `wix.stores.v1.product_updated`…). */
  eventType: string;
  kind: 'created' | 'updated' | 'deleted' | 'app_removed' | 'other';
  productId: string | null;
}

export function verifyWixJwt(token: string, publicKeyPem: string): Record<string, unknown> | null {
  const parts = token.trim().split('.');
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  try {
    const h = JSON.parse(Buffer.from(header, 'base64url').toString('utf8')) as { alg?: string };
    if (h.alg !== 'RS256') return null;
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${header}.${payload}`);
    if (!verifier.verify(publicKeyPem, Buffer.from(signature, 'base64url'))) return null;
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    if (typeof claims.exp === 'number' && claims.exp * 1000 < Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}

function parseMaybeJson(v: unknown): Record<string, unknown> {
  if (v && typeof v === 'object') return v as Record<string, unknown>;
  if (typeof v === 'string') {
    try {
      const parsed: unknown = JSON.parse(v);
      if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

function kindOf(eventType: string, envelope: Record<string, unknown>): WixWebhookEvent['kind'] {
  const t = eventType.toLowerCase();
  if (t === 'appremoved' || t.endsWith('app_removed') || t.endsWith('.removed'))
    return 'app_removed';
  if (t.includes('delet') || envelope.deletedEvent) return 'deleted';
  if (t.includes('creat') || envelope.createdEvent) return 'created';
  if (t.includes('chang') || t.includes('updat') || envelope.updatedEvent) return 'updated';
  return 'other';
}

/** Legacy (`{data:'{"productId"}', instanceId, eventType}`) and REST-style (`entityId`, `slug`) envelopes. */
export function parseWixWebhookClaims(claims: Record<string, unknown>): WixWebhookEvent | null {
  const envelope = parseMaybeJson(claims.data);
  const inner = parseMaybeJson(envelope.data);
  const instanceId =
    (typeof envelope.instanceId === 'string' && envelope.instanceId) ||
    (typeof inner.instanceId === 'string' && inner.instanceId) ||
    '';
  if (!instanceId) return null;
  const eventType =
    (typeof envelope.eventType === 'string' && envelope.eventType) ||
    (typeof envelope.slug === 'string' &&
      `${String(envelope.entityFqdn ?? '')}_${envelope.slug}`) ||
    'unknown';
  const product = parseMaybeJson(inner.product);
  const productId =
    (typeof inner.productId === 'string' && inner.productId) ||
    (typeof product.id === 'string' && product.id) ||
    (typeof envelope.entityId === 'string' && envelope.entityId) ||
    null;
  return { instanceId, eventType, kind: kindOf(eventType, envelope), productId };
}
