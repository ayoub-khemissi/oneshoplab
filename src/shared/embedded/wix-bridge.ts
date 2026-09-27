import { WIX_TOKEN_PARAM } from './lib';

/**
 * Inside the Wix dashboard, what App Bridge does for us inside Shopify: the
 * page has no cookie of ours, so our session token must ride on every
 * same-origin fetch (Next's client navigations, server actions, downloads)
 * as `Authorization: Bearer`. The first document load brings it in the URL
 * (`osl_token`); this script keeps it, adds it to fetches, and renews it
 * before it expires. Inline and first in <head>, so it runs before any of
 * Next's own requests.
 */
export const WIX_BRIDGE_SCRIPT = `(function () {
  var P = ${JSON.stringify(WIX_TOKEN_PARAM)};
  var token = new URLSearchParams(location.search).get(P);
  try {
    if (token) sessionStorage.setItem(P, token);
    else token = sessionStorage.getItem(P);
  } catch (e) {}
  if (!token) return;
  window.__oslWixToken = token;
  var original = window.fetch.bind(window);
  window.fetch = function (input, init) {
    try {
      var raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (new URL(raw, location.href).origin === location.origin) {
        var h = new Headers((init && init.headers) || (input instanceof Request ? input.headers : undefined));
        if (!h.has('authorization')) {
          h.set('authorization', 'Bearer ' + window.__oslWixToken);
          init = Object.assign({}, init, { headers: h });
        }
      }
    } catch (e) {}
    return original(input, init);
  };
  setInterval(function () {
    original('/api/wix/app/session', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + window.__oslWixToken }
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (d && d.token) {
          window.__oslWixToken = d.token;
          try { sessionStorage.setItem(P, d.token); } catch (e) {}
        }
      })
      .catch(function () {});
  }, 20 * 60 * 1000);
})();`;
