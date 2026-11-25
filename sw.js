
/* ==========================================
   MONDAI ver5.0
   Service Worker
========================================== */

const CACHE_NAME = "mondai-app-v50";

const BASE = self.registration.scope;

const INDEX_URL = new URL(

  "./index.html",

  BASE

).href;

const ASSETS = [

  INDEX_URL,

  new URL(

    "./style.css?v=5.0",

    BASE

  ).href,

  new URL(

    "./script.js?v=5.0",

    BASE

  ).href

];

const FIREBASE_ASSETS = [

  "https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js",

  "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js",

  "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js"

];


/* ==========================================
   インストール
========================================== */

self.addEventListener("install", event => {

  event.waitUntil(

    (async () => {

      const cache = await caches.open(
        CACHE_NAME
      );

      await cache.addAll(
        ASSETS
      );

      await Promise.allSettled(

        FIREBASE_ASSETS.map(

          url => cache.add(url)

        )

      );

      await self.skipWaiting();

    })()

  );
});


/* ==========================================
   旧アプリキャッシュの整理
========================================== */

self.addEventListener("activate", event => {

  event.waitUntil(

    (async () => {

      const keys = await caches.keys();

      await Promise.all(

        keys

          .filter(

            key =>

              key.startsWith("mondai-app-") &&

              key !== CACHE_NAME

          )

          .map(

            key => caches.delete(key)

          )

      );

      await self.clients.claim();

    })()

  );
});


/* ==========================================
   ネットワーク優先
========================================== */

async function networkFirst(
  request,
  fallbackKey = request
) {

  const cache = await caches.open(
    CACHE_NAME
  );

  try {

    const response = await fetch(request);

    if (response.ok) {

      await cache.put(

        fallbackKey,

        response.clone()

      );
    }

    return response;

  } catch {

    return (

      await cache.match(fallbackKey)

    ) || Response.error();
  }
}


/* ==========================================
   キャッシュ優先
========================================== */

async function cacheFirst(request) {

  const cache = await caches.open(
    CACHE_NAME
  );

  const cached = await cache.match(request);

  if (cached) {
    return cached;
  }

  const response = await fetch(request);

  if (response.ok) {

    await cache.put(

      request,

      response.clone()

    );
  }

  return response;
}


/* ==========================================
   通信処理
========================================== */

self.addEventListener("fetch", event => {

  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  const sameOrigin =

    url.origin === self.location.origin;

  const insideApp =

    request.url.startsWith(BASE);

  const firebaseModule =

    url.origin === "https://www.gstatic.com" &&

    url.pathname.startsWith(
      "/firebasejs/12.11.0/"
    );

  /*
    HTMLは常に最新版を優先する。
  */

  if (

    sameOrigin &&

    insideApp &&

    request.mode === "navigate"

  ) {

    event.respondWith(

      networkFirst(

        request,

        INDEX_URL

      )

    );

    return;
  }

  /*
    アプリ本体のCSS・JavaScript
  */

  if (

    sameOrigin &&

    insideApp &&

    ASSETS.includes(request.url)

  ) {

    event.respondWith(

      networkFirst(request)

    );

    return;
  }

  /*
    FirebaseのSDKだけをキャッシュ。

    Firestoreデータや認証通信は
    Service Workerでキャッシュしない。
  */

  if (firebaseModule) {

    event.respondWith(

      cacheFirst(request)

    );
  }
});

/* END */
