// Server entry (reads the request headers; no client components, the worker may
// load it through @/entities/user). Client code imports ./client.
import { headers } from 'next/headers';
import { EMBEDDED_HOST_HEADER, EMBEDDED_REQUEST_HEADER, type EmbeddedHost } from './lib';

export {
  EMBEDDED_HOSTS,
  EMBEDDED_HOST_HEADER,
  EMBEDDED_REQUEST_HEADER,
  WIX_SESSION_ISSUER,
  embeddedHostOf,
  SHOPIFY_FRAME_ANCESTORS,
  WIX_FRAME_ANCESTORS,
  WIX_TOKEN_PARAM,
  embeddedHomePath,
  embeddedLinkAction,
  embeddedRequestInfo,
  filenameFromDisposition
} from './lib';
export type { EmbeddedHost, EmbeddedLinkAction } from './lib';
export { WIX_BRIDGE_SCRIPT } from './wix-bridge';

/** True when the current request comes from inside the Shopify admin (set by the proxy). */
export async function isEmbeddedRequest(): Promise<boolean> {
  try {
    return (await headers()).get(EMBEDDED_REQUEST_HEADER) === '1';
  } catch {
    // No request scope (worker, scripts): never embedded.
    return false;
  }
}

/** Which admin the current request comes from, null outside any (set by the proxy). */
export async function embeddedHost(): Promise<EmbeddedHost | null> {
  try {
    const h = await headers();
    if (h.get(EMBEDDED_REQUEST_HEADER) !== '1') return null;
    return h.get(EMBEDDED_HOST_HEADER) === 'wix' ? 'wix' : 'shopify';
  } catch {
    return null;
  }
}
