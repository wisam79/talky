const CACHE_NAME = 'talky-pwa-v9';
const ASSET_PATHS = [
  '',
  'index.html',
  'css/style.css',
  'css/apple-hig.css',
  'js/gradio_api.js',
  'js/app.js',
  'js/vendor.js',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(
        ASSET_PATHS.map(path => new URL(path, self.registration.scope).toString())
      ))
  );
});

self.addEventListener('fetch', event => {
  // Only cache GET requests
  if (event.request.method !== 'GET') return;
  
  // Don't cache external Gradio API calls (audio generation)
  if (event.request.url.includes('hf.space')) return;

  const isDocument = event.request.mode === 'navigate' ||
    event.request.destination === 'document';
  event.respondWith(
    (isDocument ? fetch(event.request).then(fetchResponse => {
      if (fetchResponse.ok) {
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, fetchResponse.clone()));
      }
      return fetchResponse;
    }).catch(() => caches.match(event.request)) : caches.match(event.request)
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
      }))
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
