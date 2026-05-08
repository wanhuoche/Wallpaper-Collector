var CACHE = 'wallpaper-v2';
var ASSETS = [
  '/',
  '/index.html',
  '/login.html',
  '/register.html',
  '/style.css',
  '/js/theme.js',
  '/js/state.js',
  '/js/utils.js',
  '/js/source-config.js',
  '/js/search.js',
  '/js/storage.js',
  '/js/auth.js',
  '/js/app.js',
  '/js/favorites.js'
];

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE).then(function(cache) {
      return cache.addAll(ASSETS);
    }).then(function() { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE; }).map(function(k) { return caches.delete(k); })
      );
    }).then(function() { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(e) {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(function(cached) {
      var url = new URL(e.request.url);
      if (url.pathname.startsWith('/api/') || url.hostname !== self.location.hostname) {
        // API/外部图源：网络优先，失败兜底缓存
        return fetch(e.request).then(function(resp) {
          return resp;
        }).catch(function() {
          return cached || new Response('Offline', { status: 503 });
        });
      }
      // 同源静态资源：网络优先（确保更新即时生效），失败兜底缓存
      return fetch(e.request).then(function(resp) {
        var cloned = resp.clone();
        caches.open(CACHE).then(function(cache) { cache.put(e.request, cloned); });
        return resp;
      }).catch(function() {
        return cached || new Response('Offline', { status: 503 });
      });
    })
  );
});
