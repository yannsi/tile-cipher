// オフラインでも開けるよう、アプリのファイルを端末に保存しておく
// アプリを更新したら CACHE の番号を上げる（v1 → v2）と、新しいファイルに入れ替わる
const CACHE = "tile-cipher-v1";
const APP_FILES = [
  "./", "index.html", "app.js", "core.js", "worker.js", "encoding.min.js", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png", "icons/favicon-64.png",
];
const FONT_CACHE = "tile-cipher-fonts";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== FONT_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;

  // フォント: 保存済みがあればそれを使い、裏で新しいものを取りに行く
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith(caches.open(FONT_CACHE).then(async (c) => {
      const hit = await c.match(e.request);
      const net = fetch(e.request).then((r) => { if (r.ok || r.type === "opaque") c.put(e.request, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }

  // アプリのファイル: ネットにつながればまず新しいものを、だめなら保存済みを使う
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(e.request)
        .then((r) => { if (r.ok) caches.open(CACHE).then((c) => c.put(e.request, r.clone())); return r; })
        .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match("index.html")))
    );
  }
});
