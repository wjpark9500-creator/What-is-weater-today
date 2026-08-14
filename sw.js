const CACHE_NAME = "vent-app-v1";
const SHELL_FILES = [
  "/",
  "/index.html",
  "/style.css",
  "/app.js",
  "/manifest.json",
  "/favicon.ico",
  "/favicon-32x32.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // 날씨/판정 API와 외부(기상청·에어코리아·역지오코딩) 요청은 항상 네트워크에서 최신 값을 가져옴
  if (url.pathname.startsWith("/api/") || url.origin !== self.location.origin) {
    event.respondWith(
      fetch(event.request).catch(
        () => new Response(JSON.stringify({ error: "오프라인 상태입니다." }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        })
      )
    );
    return;
  }

  // 앱 셸(정적 파일)은 캐시 우선, 실패 시 네트워크
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
