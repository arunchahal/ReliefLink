// Service Worker for ReliefLink PWA

const CACHE_NAME = 'relieflink-cache-v1';
const OFFLINE_URL = '/offline.html';

// List of core resources to cache
const CORE_ASSETS = [
  '/',
  '/index.html',
  '/src/main.jsx',
  '/src/App.jsx',
  '/src/api.js',
  '/src/socket.js',
  '/src/pages/CitizenPortal.jsx',
  '/src/pages/VolunteerPortal.jsx',
  '/src/pages/AdminPortal.jsx',
  '/src/pages/Login.jsx',
  '/src/pages/VolunteerPortal.jsx',
  '/src/pages/VolunteerPortal.jsx',
  '/src/pages/VolunteerPortal.jsx',
  '/src/pages/VolunteerPortal.jsx',
  // Add any additional static assets like CSS, images, fonts
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(CORE_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // For navigation requests, try network first, then fallback to cache or offline page
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .catch(() => caches.match(request))
        .then((response) => response || caches.match(OFFLINE_URL))
    );
    return;
  }
  // For API calls, try network, fallback to cache if available
  if (request.url.includes('/api/')) {
    event.respondWith(
      fetch(request)
        .catch(() => caches.match(request))
    );
    return;
  }
  // Default: try cache first, then network
  event.respondWith(
    caches.match(request).then((cached) => {
      return cached || fetch(request).then((response) => {
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(request, responseClone);
        });
        return response;
      });
    })
  );
});
