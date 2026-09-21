// 자동 생성 파일 — scripts/build-sw.js 를 고칠 것
const CACHE = "marble-draw-9cb0e653e974";
const PREFIX = "marble-draw-";
const PRECACHE = [
  "./",
  "./Box2D.b9b16b27.wasm",
  "./Box2D.f604a313.js",
  "./Box2D.simd.bc10b68f.js",
  "./Box2D.simd.dd31b167.wasm",
  "./android-icon-144x144.36ef70f8.png",
  "./android-icon-192x192.6c0734fc.png",
  "./android-icon-36x36.d6d4bf69.png",
  "./android-icon-48x48.6a3d6a84.png",
  "./android-icon-72x72.4726ed35.png",
  "./android-icon-96x96.9b4999a7.png",
  "./apple-icon-114x114.6cefcd75.png",
  "./apple-icon-120x120.462d8e84.png",
  "./apple-icon-144x144.36ef70f8.png",
  "./apple-icon-152x152.1f1d2b56.png",
  "./apple-icon-180x180.33666671.png",
  "./apple-icon-57x57.5ecd1650.png",
  "./apple-icon-60x60.b46a75af.png",
  "./apple-icon-72x72.4726ed35.png",
  "./apple-icon-76x76.72dbc1e1.png",
  "./assets/manifest.webmanifest",
  "./bomb.455f9b17.svg",
  "./check.7e390469.svg",
  "./favicon-16x16.b88a3ef4.png",
  "./favicon-32x32.b3414860.png",
  "./favicon-96x96.b086bd80.png",
  "./ff.7fdc9e82.svg",
  "./index.html",
  "./map.eb357c03.svg",
  "./marble-draw.375e6b70.css",
  "./marble-draw.9218440e.js",
  "./megaphone.da49dfc8.svg",
  "./moon.3f475bd2.svg",
  "./ms-icon-144x144.e402ee4a.png",
  "./play.d2b98249.svg",
  "./record.c71c4728.svg",
  "./shuffle.e9e498cf.svg",
  "./sun.ab6ec46d.svg",
  "./trophy.50d1ba0a.svg"
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // 하나라도 실패하면 설치가 실패하고 이전 워커가 계속 일한다. 반쯤 채운 캐시로 넘어가지 않는다
      await cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' })));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key.startsWith(PREFIX) && key !== CACHE).map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // 이 앱은 바깥으로 요청을 보내지 않는다. 혹시 생기더라도 손대지 않는다
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          // 배포가 꼬여 404 가 오는 순간에 멀쩡한 캐시를 덮어쓰면 안 된다
          if (fresh.ok) {
            const cache = await caches.open(CACHE);
            cache.put('./index.html', fresh.clone());
          }
          return fresh;
        } catch {
          const cache = await caches.open(CACHE);
          return (await cache.match('./index.html')) || (await cache.match('./')) || Response.error();
        }
      })()
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      // wasm 로더가 캐시 무효화용 쿼리를 붙이는 경우가 있어 쿼리는 무시하고 찾는다
      const cached = await cache.match(request, { ignoreSearch: true });
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) cache.put(request, response.clone());
      return response;
    })()
  );
});
