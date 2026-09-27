// Server entry (reads the request headers; no client components, the worker may
// load it through @/entities/user). Client code imports ./client.
import { headers } from 'next/headers';
import { EMBEDDED_REQUEST_HEADER } from './lib';

export {
  EMBEDDED_REQUEST_HEADER,
  SHOPIFY_FRAME_ANCESTORS,
  embeddedLinkAction,
  embeddedRequestInfo,
  filenameFromDisposition
} from './lib';
export type { EmbeddedLinkAction } from './lib';

/** True when the current request comes from inside the Shopify admin (set by the proxy). */
export async function isEmbeddedRequest(): Promise<boolean> {
  try {
    return (await headers()).get(EMBEDDED_REQUEST_HEADER) === '1';
  } catch {
    // No request scope (worker, scripts): never embedded.
    return false;
  }
}
