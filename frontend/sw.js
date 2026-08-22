// ============================================================
// Dayflow HRMS — Service Worker (PWA Offline Asset Caching)
// ============================================================

const CACHE_NAME = 'dayflow-static-v1';

const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/app.js',
  '/js/api.js',
  '/js/offline-db.js',
  '/js/offline-sync.js',
  '/js/attendance.js',
  '/js/leave.js',
  '/js/payroll.js',
  '/js/profile.js',
  '/js/auth.js',
  '/js/ui.js',
  '/manifest.json',
  'https://unpkg.com/html5-qrcode' // CDN scripts fallback
];

// Install: Cache all core application shell static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        return cache.addAll(PRECACHE_ASSETS);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate: Clean up any old caches and claim control immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            return caches.delete(name);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: Network-First with Cache Fallback for assets & APIs
self.addEventListener('fetch', (event) => {
  // If it's a dynamic API call (contains /api/), attempt Network-First
  if (event.request.url.includes('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // If successful response, we could optionally cache it,
          // but usually API sync/modify actions shouldn't be cached.
          return response;
        })
        .catch(() => {
          // Offline fallback for GET API request if cached
          if (event.request.method === 'GET') {
            return caches.match(event.request);
          }
          // Return generic offline response or error for POST/PUT API requests
          return new Response(
            JSON.stringify({ error: "You are currently offline. Request has been queued locally." }),
            { status: 503, headers: { 'Content-Type': 'application/json' } }
          );
        })
    );
    return;
  }

  // For static assets, perform Cache-First or Network-First
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Put a clone of the fresh response into the cache
        if (response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // Fallback to cache if offline
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // Fallback if resource is not found in cache
          if (event.request.headers.get('accept').includes('text/html')) {
            return caches.match('/index.html');
          }
          return new Response('Offline Content Unavailable', { status: 404 });
        });
      })
  );
});
