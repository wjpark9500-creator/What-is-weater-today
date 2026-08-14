const CACHE_NAME = "vent-app-v3";
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

  // 앱 셸(정적 파일)은 네트워크 우선 — 온라인이면 항상 최신 파일을 받아오고,
  // 오프라인일 때만 예전에 캐시해둔 버전을 보여준다.
  // 이 방식 덕분에 배포할 때마다 CACHE_NAME 버전을 수동으로 올릴 필요가 없다.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
