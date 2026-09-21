// dist/service-worker.js 를 생성한다.
//
// 교실은 인터넷이 끊기거나 학교망이 외부 사이트를 막는 일이 잦다. 한 번 열어 둔
// 브라우저라면 네트워크 없이도 추첨이 되도록 빌드 산출물 전부를 미리 캐시한다.
//
// 원본 저장소의 이 파일은 옛 워커를 회수하는 kill switch 였다. 당시 precache 에
// .wasm 이 빠져 있어 Box2D 를 캐시하지 못했고, 그래서 오프라인 동작이 된 적이 없다.
// 여기서는 dist 에 있는 파일을 확장자로 거르지 않고 다 담는다(.map 만 뺀다).
//
// 갱신 전략
//   - 페이지(navigate 요청)는 네트워크 우선. 새 배포가 있으면 바로 받고, 끊겼을 때만 캐시.
//     index.html 이 캐시에 고착되면 그 안의 번들 해시도 함께 고착되어 옛 버전이 영영 남는다.
//   - 나머지 파일은 캐시 우선. 파일명에 content hash 가 붙어 있어 이름이 같으면 내용도 같다.
//   - 캐시 이름에 빌드 해시를 넣어, 새 워커가 활성화될 때 이전 빌드의 캐시를 지운다.

const assert = require('node:assert');
const crypto = require('node:crypto');
const { readdirSync, readFileSync, statSync, writeFileSync } = require('node:fs');
const path = require('node:path');

// 기본은 dist. 검증용으로 다른 폴더에 빌드했다면 인자로 넘긴다: node scripts/build-sw.js dist-check
const DIST = process.argv[2] || 'dist';
const SW_FILE = 'service-worker.js';

// github.io 는 origin 을 다른 프로젝트 페이지와 공유한다. 남의 캐시를 지우지 않도록
// 반드시 이 접두어로 시작하는 캐시만 건드린다.
const CACHE_PREFIX = 'marble-draw-';

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const files = walk(DIST)
  .map((full) => path.relative(DIST, full).split(path.sep).join('/'))
  .filter((rel) => rel !== SW_FILE && !rel.endsWith('.map'))
  .sort();

assert(files.includes('index.html'), 'dist/index.html 이 없다. parcel build 가 먼저 돌아야 한다');
assert(
  files.some((f) => f.endsWith('.wasm')),
  'Box2D wasm 이 precache 에 없다. 이게 빠지면 오프라인에서 물리 엔진이 뜨지 않는다'
);

// 내용이 하나라도 바뀌면 캐시 이름이 바뀌도록 모든 파일 내용으로 해시를 만든다
const hash = crypto.createHash('sha256');
for (const rel of files) {
  hash.update(rel);
  hash.update(readFileSync(path.join(DIST, rel)));
}
const version = hash.digest('hex').slice(0, 12);
const cacheName = `${CACHE_PREFIX}${version}`;

// 워커 위치 기준 상대 경로. 어느 하위 경로에 배포하든 그대로 동작한다
const precache = ['./', ...files.map((f) => `./${f}`)];

const worker = `// 자동 생성 파일 — scripts/build-sw.js 를 고칠 것
const CACHE = ${JSON.stringify(cacheName)};
const PREFIX = ${JSON.stringify(CACHE_PREFIX)};
const PRECACHE = ${JSON.stringify(precache, null, 2)};

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
`;

writeFileSync(path.join(DIST, SW_FILE), worker);
console.log(`service-worker.js: ${cacheName}, ${precache.length}개 파일 precache`);
