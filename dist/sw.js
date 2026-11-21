'use strict';

const CACHE_NAME = 'terra-app-v4';
const coreFiles = [
  './', 'style.css', 'theme.js', 'd3-array.min.js', 'd3-geo.min.js', 'world.js', 'atlases.js',
  'country-info.js', 'game-progress.js', 'app.js', 'country-photos.js', 'catalog.js', 'mobile.js', 'account.js',
  'manifest.webmanifest', 'icons/terra-180.png', 'icons/terra-192.png', 'icons/terra-512.png', 'icons/terra-maskable.png'
];
const root = new URL('./', self.location.href).href;
const knownAssets = new Set(coreFiles.slice(1).map(path => new URL(path, root).href));

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Precache the site shell only if this session can reach the real game.
    const index = await fetch(root, { cache: 'reload', redirect: 'error' });
    if (!index.ok || !index.headers.get('content-type')?.includes('text/html')) throw new Error('Game page unavailable');
    const markup = await index.clone().text();
    if (!markup.includes('id="game-page"')) throw new Error('Game page unavailable');
    await cache.addAll([...knownAssets].map(url => new Request(url, { cache: 'reload', redirect: 'error' })));
    await cache.put(root, index);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('terra-app-') && name !== CACHE_NAME) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || !request.url.startsWith(root)) return;
  const shell = request.mode === 'navigate' && [root, new URL('index.html', root).href].includes(request.url);
  const flag = /^[A-Z]{2}\.svg$/i.test(request.url.slice((root + 'flags/').length)) && request.url.startsWith(root + 'flags/');
  if (!shell && !flag && !knownAssets.has(request.url)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const localKey = shell ? root : request.url;
    try {
      const reply = await fetch(request);
      if (flag && reply.ok && !reply.redirected && reply.headers.get('content-type')?.includes('image/svg+xml')) {
        await cache.put(localKey, reply.clone());
      }
      return reply;
    } catch {
      return await cache.match(localKey) || Response.error();
    }
  })());
});
