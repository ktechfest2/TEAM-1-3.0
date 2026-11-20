/*
 * TrustElect service worker: lets voters open the capture app and take photos with no network.
 * Only the voter capture pages (/capture, /capture/report) and the site's own static files are
 * cached. The API is on another address and is never cached; nothing personal is stored here.
 * Photos waiting to be sent live in the page's IndexedDB queue, not in this cache.
 */
const CACHE = 'te-capture-v1';
const PAGES = ['/capture', '/capture/report'];

/** A page and every static file it loads (scripts, styles, images, fonts) */
async function cachePage(cache, path, fetched) {
  const res = fetched ?? (await fetch(path, { cache: 'no-store' }));
  if (!res.ok) return;
  const html = await res.clone().text();
  await cache.put(path, res);
  const assets = [...new Set(html.match(/\/_next\/static\/[^"'\s)\\]+/g) ?? [])];
  await Promise.all(
    assets.map((url) =>
      cache.match(url).then((hit) =>
        hit
          ? undefined
          : fetch(url)
              .then((r) => (r.ok ? cache.put(url, r) : undefined))
              .catch(() => undefined),
      ),
    ),
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => Promise.all(PAGES.map((p) => cachePage(cache, p).catch(() => undefined))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('te-capture-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Capture pages: the network when there is one (always the latest), the saved copy when not
  if (req.mode === 'navigate' && PAGES.includes(url.pathname)) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cachePage(cache, url.pathname, copy)).catch(() => undefined);
          }
          return res;
        })
        .catch(() => caches.match(url.pathname).then((hit) => hit ?? Response.error())),
    );
    return;
  }

  // Static files never change under the same name: the saved copy first
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(req.url).then(
        (hit) =>
          hit ??
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((cache) => cache.put(req.url, copy));
            }
            return res;
          }),
      ),
    );
  }
});
