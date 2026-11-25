
/* ==========================================
   MONDAI v0.4
   Service Worker
========================================== */

const CACHE_NAME = "mondai-app-v04";

const BASE = self.registration.scope;

const ASSETS = [

  new URL("./index.html", BASE).href,

  new URL("./style.css?v=0.4", BASE).href,

  new URL("./script.js?v=0.4", BASE).href

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

      await cache.addAll(ASSETS);

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
   旧バージョンのキャッシュ削除
========================================== */

self.addEventListener("activate", event => {

  event.waitUntil(

    (async () => {

      const keys = await caches.keys();

      await Promise.all(

        keys

          .filter(key =>

            key.startsWith("mondai-app-") &&

            key !== CACHE_NAME

          )

          .map(key => caches.delete(key))

      );

      await self.clients.claim();

    })()

  );

});


/* ==========================================
   通信処理
========================================== */

self.addEventListener("fetch", event => {

  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  const sameOrigin =
    url.origin === self.location.origin;

  const firebaseModule =

    url.origin === "https://www.gstatic.com" &&

    url.pathname.startsWith(
      "/firebasejs/12.11.0/"
    );

  const insideApp =
    request.url.startsWith(BASE);

  /*
    Firebaseのデータ通信や認証通信は
    Service Workerでキャッシュしない。
  */

  if (

    sameOrigin &&

    insideApp &&

    request.mode === "navigate"

  ) {

    event.respondWith(

      (async () => {

        const cache = await caches.open(
          CACHE_NAME
        );

        try {

          const response = await fetch(request);

          if (response.ok) {

            await cache.put(

              new URL(
                "./index.html",
                BASE
              ).href,

              response.clone()

            );

          }

          return response;

        } catch {

          return (

            await cache.match(

              new URL(
                "./index.html",
                BASE
              ).href

            )

          ) || Response.error();

        }

      })()

    );

    return;

  }

  if (

    sameOrigin &&

    insideApp &&

    ASSETS.includes(request.url)

  ) {

    event.respondWith(

      (async () => {

        const cache = await caches.open(
          CACHE_NAME
        );

        try {

          const response = await fetch(request);

          if (response.ok) {

            await cache.put(

              request,

              response.clone()

            );

          }

          return response;

        } catch {

          return (

            await cache.match(request)

          ) || Response.error();

        }

      })()

    );

    return;

  }

  if (firebaseModule) {

    event.respondWith(

      (async () => {

        const cache = await caches.open(
          CACHE_NAME
        );

        const cached = await cache.match(request);

        if (cached) return cached;

        const response = await fetch(request);

        if (response.ok) {

          await cache.put(

            request,

            response.clone()

          );

        }

        return response;

      })()

    );

  }

});
