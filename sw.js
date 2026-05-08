var CACHE = 'wallpaper-v1';
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
      // 静态资源走缓存优先，API/外部图源走网络优先
      var url = new URL(e.request.url);
      if (url.pathname.startsWith('/api/') || url.hostname !== self.location.hostname) {
        return fetch(e.request).then(function(resp) {
          return resp;
        }).catch(function() {
          return cached || new Response('Offline', { status: 503 });
        });
      }
      return cached || fetch(e.request);
    })
  );
});
