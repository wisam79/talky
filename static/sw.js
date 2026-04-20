const CACHE_NAME = 'talky-pwa-v3';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/app.js',
  '/manifest.json'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(ASSETS_TO_CACHE);
      })
  );
});

self.addEventListener('fetch', event => {
  // Only cache GET requests (don't cache POST requests like /api/generate)
  if (event.request.method !== 'GET') return;
  
  // Don't cache API endpoints
  if (event.request.url.includes('/api/')) return;

  event.respondWith(
    caches.match(event.request)
      .then(response => {
        return response || fetch(event.request).then(fetchResponse => {
          // Only cache static assets and fonts, avoiding dynamic requests
          if (fetchResponse.ok && fetchResponse.status === 200 && (event.request.url.match(/\.(js|css|html|json|svg|png|jpg|woff2?|ttf)(\?.*)?$/) || event.request.url.includes('fonts.googleapis.com') || event.request.url.includes('fonts.gstatic.com'))) {
            return caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, fetchResponse.clone());
              return fetchResponse;
            });
          }
          return fetchResponse;
        }).catch(() => {
          return new Response('Offline. Please check your connection.', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'text/plain' }
          });
        });
      })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});
