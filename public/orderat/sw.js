// The app shell, network first with a cached fallback. Only this origin's GET requests are handled:
// the Edge Functions (sync, sign-in, AI, photos) are on another origin and always go to the network,
// and anything under a /functions/ path is never cached either.
const CACHE='orderat-web-v2';
const FILES=['./','./index.html','./app.css','./config.js','./cloud-map.js','./cloud-api.js','./cloud-sync.js','./cloud-auth.js','./live-core.js','./vendor/qrcode.js','./i18n.js','./demo.js','./live.js','./app.js','./favicon.svg','./manifest.webmanifest','./icon-192.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting()))});
// Also clears older orderat-* caches (the demo's orderat-web-v1, the old prototype's).
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('orderat-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==self.location.origin||u.pathname.includes('/functions/'))return;e.respondWith(fetch(e.request).then(r=>{if(r.ok){const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy))}return r}).catch(()=>caches.match(e.request).then(r=>r||new Response('Offline. Reconnect to load this page.',{status:503}))))});
