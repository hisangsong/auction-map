/* 경매·공매 지도 서비스워커
 * - 앱 셸(HTML/아이콘)은 캐시해 오프라인에서도 기본 화면이 뜨게 한다.
 * - 데이터(data/onbid/car/asset.json)와 /api 는 '네트워크 우선'으로 항상 최신을 받고,
 *   오프라인일 때만 캐시로 폴백한다. (data.json 은 24MB라 사전 캐시하지 않음)
 * - 카카오맵 등 외부 리소스는 건드리지 않고 브라우저에 맡긴다.
 */
const CACHE = "auction-map-v1";
const SHELL = ["./", "./index.html", "./manifest.json",
  "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
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
  if (url.origin !== location.origin) return; // 외부(카카오 등)는 그대로

  const isData = url.pathname.endsWith(".json") || url.pathname.startsWith("/api/");
  const isDoc = req.mode === "navigate" || url.pathname === "/" || url.pathname.endsWith(".html");

  if (isData || isDoc) {
    // 네트워크 우선 → 최신 유지, 실패 시 캐시 폴백
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (isDoc) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((m) => m || caches.match("./index.html")))
    );
    return;
  }

  // 정적 리소스(아이콘 등): 캐시 우선
  e.respondWith(caches.match(req).then((m) => m || fetch(req)));
});
