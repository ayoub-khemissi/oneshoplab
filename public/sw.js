/* eslint-disable */
/**
 * OneShopLab service worker — hand-written, dependency-free.
 *
 * It exists for two reasons: push notifications need one, and an installed app
 * that shows a blank Chrome error page when the phone loses signal does not
 * feel like an app.
 *
 * Deliberately conservative, so it can never serve a broken or stale app:
 *   - navigations are network-first, falling back to a cached copy and then to
 *     an offline page — stale HTML is never preferred;
 *   - content-hashed assets are cache-first, refreshed in the background;
 *   - everything else (any method but GET, /api, cross-origin) is passed
 *     straight through, exactly as if no worker were installed.
 *
 * Bump CACHE to invalidate everything on the next activation.
 */

const CACHE = 'oneshoplab-v1';
const OFFLINE_URL = '/offline.html';
const PRECACHE_URLS = [OFFLINE_URL, '/icons/icon-192.png'];

/** Same-origin prefixes whose responses must never be cached. */
const NETWORK_ONLY_PREFIXES = ['/api', '/auth'];
/** Same-origin prefixes treated as immutable assets. */
const STATIC_ASSET_PREFIXES = ['/_next/static', '/icons', '/brand', '/flags'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE_URLS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// --- Push: show what the server sent ---------------------------------------
self.addEventListener('push', (event) => {
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch (error) {
      payload = { body: event.data.text() };
    }
  }

  const title = payload.title || 'OneShopLab';
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/icons/icon-192.png',
    // Android paints the small badge from alpha only: a coloured icon there
    // comes out as a white square, so it gets the monochrome silhouette.
    badge: payload.badge || '/icons/badge-96.png',
    data: { url: payload.url || '/' }
  };
  // One notice per event: a second push carrying the same tag replaces the
  // first instead of stacking, and `renotify` still makes it heard.
  if (payload.tag) {
    options.tag = payload.tag;
    options.renotify = true;
  }

  event.waitUntil(self.registration.showNotification(title, options));
});

// --- Click: focus the tab already there, or steer one, or open one ----------
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      const target = new URL(targetUrl, self.location.origin);
      const onTarget = clientList.find((client) => {
        const url = new URL(client.url);
        return url.pathname === target.pathname && url.search === target.search;
      });
      if (onTarget && 'focus' in onTarget) return onTarget.focus();
      const anyTab = clientList.find((client) => 'navigate' in client);
      if (anyTab) return anyTab.focus().then((client) => client.navigate(target.href));
      if (self.clients.openWindow) return self.clients.openWindow(target.href);
      return undefined;
    })
  );
});

// --- Fetch routing ---------------------------------------------------------
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (NETWORK_ONLY_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }
  if (STATIC_ASSET_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
    event.respondWith(handleStaticAsset(request));
  }
});

async function handleNavigation(request) {
  try {
    const response = await fetch(request);
    // Only cache a real page: an error page cached here would outlive the error.
    if (response && response.ok) {
      const cache = await caches.open(CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    const offline = await caches.match(OFFLINE_URL);
    return offline ?? Response.error();
  }
}

async function handleStaticAsset(request) {
  const cached = await caches.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response && response.ok) {
        caches.open(CACHE).then((cache) => cache.put(request, response.clone()));
      }
      return response;
    })
    .catch(() => cached);
  return cached ?? network;
}
