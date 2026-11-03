// Service worker: salva in cache i file dell'app così si apre subito anche senza rete.
// I dati (schede, allenamenti) vengono sempre letti da Supabase e non passano da qui.
const CACHE = "palestra-v6";
const SHELL = [
  "./", "index.html", "style.css", "app.js", "importer.js", "config.js",
  "manifest.webmanifest", "fonts/display-bold.woff", "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isLib = url.hostname === "cdn.jsdelivr.net";
  if (!sameOrigin && !isLib) return; // le chiamate a Supabase vanno dirette in rete

  // Stale-while-revalidate: risposta subito dalla cache, aggiornamento in background
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
