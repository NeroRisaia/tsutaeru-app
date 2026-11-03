/* 移行用：以前ルート（/tsutaeru-app/）に登録されていた旧 Service Worker を解除するだけのファイル。
   アプリ本体は app/ に移動し、app/sw.js が別のスコープで動きます。
   旧版のキャッシュ（tsutaeru-v1.0.2）を消し、自分の登録を解除して、開いている画面を読み直します。 */
self.addEventListener('install', function () { self.skipWaiting(); });

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.delete('tsutaeru-v1.0.2')
      .then(function () { return self.registration.unregister(); })
      .then(function () { return self.clients.matchAll({ type: 'window' }); })
      .then(function (list) { list.forEach(function (c) { c.navigate(c.url); }); })
  );
});
