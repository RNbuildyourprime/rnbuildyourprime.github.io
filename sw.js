/* RN. · funciona sin internet: guarda la app en el dispositivo y la actualiza cuando hay conexión.
   Los datos NO pasan por aquí: viven en tu cuenta (Supabase) y en la copia local de la app. */
const V = 'rn-v6';
const CORE = ['./app.html', './shim.js', './config.js', './vendor/supabase.js', './manifest.webmanifest', './icon-192.png', './apple-touch-icon.png', './icon.svg'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
const timeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('lento')), ms))]);
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET') return;
  if (/supabase\.co$/.test(u.hostname)) return;                       // datos y sesión: siempre directo a la red
  if (/fonts\.(googleapis|gstatic)\.com$/.test(u.hostname)) {          // tipografías: primero la copia guardada
    e.respondWith(caches.open(V).then(c => c.match(r).then(hit => hit || fetch(r).then(res => { c.put(r, res.clone()); return res; }))));
    return;
  }
  if (u.origin !== location.origin) return;
  // App y archivos: primero la red (para recibir actualizaciones), y si no hay internet o tarda, la copia guardada
  e.respondWith(caches.open(V).then(c => timeout(fetch(r), 4000).then(res => { if (res.ok) c.put(r, res.clone()); return res; })
    .catch(() => c.match(r, { ignoreSearch: true }).then(hit => hit || (r.mode === 'navigate' ? c.match('./app.html') : Response.error())))));
});

/* Recordatorios: llegan desde la función rn-push de Supabase */
self.addEventListener('push', e => {
  let m = {}; try { m = e.data ? e.data.json() : {}; } catch (x) { m = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(m.title || 'RN.', { body: m.body || '', icon: 'icon-192.png', badge: 'icon-192.png', tag: m.tag || 'rn', renotify: true, data: { url: m.url || 'app.html' } }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || 'app.html', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => {
    const w = ws.find(c => c.url.startsWith(self.registration.scope));
    if (w) return w.navigate(url).then(c => (c || w).focus()).catch(() => w.focus());
    return self.clients.openWindow(url);
  }));
});
