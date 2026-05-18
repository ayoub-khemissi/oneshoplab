/**
 * AWS SigV4 request signing for the Cloudflare R2 S3 API, run inside
 * nginx via njs (libnginx-mod-http-js >= 0.8).
 *
 * Purpose: cdn.oneshoplab.com is a read-only public edge in front of a
 * PRIVATE R2 bucket (public r2.dev access disabled). Every upstream
 * request to <account>.r2.cloudflarestorage.com must carry a valid
 * SigV4 Authorization header computed from a dedicated READ-ONLY R2
 * API token. The token never leaves the box: it lives in a root-only
 * nginx conf as js_var, is read here at request time, and is only
 * ever sent server→server to R2.
 *
 * Only GET/HEAD object reads are signed (the vhost rejects other
 * methods). Region is "auto" for R2. Payload is always empty for a
 * GET, so the content hash is the well-known SHA256 of "".
 *
 * Config contract (set in the root-only secrets conf):
 *   js_var $r2_access_key_id   <token access key id>
 *   js_var $r2_secret_key      <token secret>
 *   js_var $r2_s3_host         <account>.r2.cloudflarestorage.com
 *   js_var $r2_bucket          oneshoplab
 *
 * Exposed to nginx:
 *   js_set $r2_amzdate       r2sign.amzDate
 *   js_set $r2_authorization r2sign.authorization
 *   js_set $r2_canonical_uri r2sign.canonicalUri
 * The vhost then proxies to https://$r2_s3_host with that URI and the
 * Authorization / x-amz-date / x-amz-content-sha256 headers.
 */

import crypto from 'crypto';

// SHA256 of an empty body — constant for every GET/HEAD we proxy.
const EMPTY_PAYLOAD_SHA256 =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const REGION = 'auto';
const SERVICE = 's3';
const ALGO = 'AWS4-HMAC-SHA256';

/**
 * Per-request timestamp derived from nginx's $msec (request start).
 * Using a single source guarantees every js_set callback in the same
 * request agrees on the second, so the signed x-amz-date header and
 * the signature can never drift apart at a second boundary.
 */
function requestDate(r) {
  const msec = Number(r.variables.msec) * 1000;
  return new Date(msec);
}

function pad(n) {
  return n < 10 ? '0' + n : '' + n;
}

function amzDate(r) {
  const d = requestDate(r);
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    'T' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    'Z'
  );
}

function dateStamp(r) {
  const d = requestDate(r);
  return (
    d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate())
  );
}

/**
 * RFC3986 path encoding per SigV4: encode every segment, keep "/".
 * Object keys here are UUID/slug-ish so this is mostly identity, but
 * we stay strictly correct so a future key with an odd char can't
 * silently break the signature.
 */
function uriEncodeSegment(seg) {
  return encodeURIComponent(seg).replace(
    /[!'()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

/** The S3 path-style canonical URI: /<bucket>/<object key>. */
function canonicalUri(r) {
  const bucket = r.variables.r2_bucket;
  // r.uri is the decoded, normalized request path ("/products/..").
  const segments = r.uri.split('/').filter((s) => s.length > 0);
  const encoded = segments.map(uriEncodeSegment).join('/');
  return '/' + bucket + '/' + encoded;
}

function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}

function sha256hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function signingKey(secret, ds) {
  const kDate = hmac('AWS4' + secret, ds);
  const kRegion = hmac(kDate, REGION);
  const kService = hmac(kRegion, SERVICE);
  return hmac(kService, 'aws4_request');
}

function authorization(r) {
  const accessKey = r.variables.r2_access_key_id;
  const secret = r.variables.r2_secret_key;
  const host = r.variables.r2_s3_host;
  const ds = dateStamp(r);
  const amz = amzDate(r);
  const uri = canonicalUri(r);

  // We never proxy a query string to the object endpoint, so the
  // canonical query is empty.
  const canonicalHeaders =
    'host:' +
    host +
    '\n' +
    'x-amz-content-sha256:' +
    EMPTY_PAYLOAD_SHA256 +
    '\n' +
    'x-amz-date:' +
    amz +
    '\n';
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

  const canonicalRequest =
    'GET\n' +
    uri +
    '\n' +
    '\n' +
    canonicalHeaders +
    '\n' +
    signedHeaders +
    '\n' +
    EMPTY_PAYLOAD_SHA256;

  const scope = ds + '/' + REGION + '/' + SERVICE + '/aws4_request';
  const stringToSign =
    ALGO + '\n' + amz + '\n' + scope + '\n' + sha256hex(canonicalRequest);

  const signature = crypto
    .createHmac('sha256', signingKey(secret, ds))
    .update(stringToSign)
    .digest('hex');

  return (
    ALGO +
    ' Credential=' +
    accessKey +
    '/' +
    scope +
    ', SignedHeaders=' +
    signedHeaders +
    ', Signature=' +
    signature
  );
}

export default { amzDate, canonicalUri, authorization };
