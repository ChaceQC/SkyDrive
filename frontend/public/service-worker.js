// This is a basic service worker file.
// For now, it's empty but can be extended for caching, offline capabilities, etc.

self.addEventListener('install', (event) => {
  console.log('Service Worker installed');
  self.skipWaiting(); // Activate new service worker immediately
});

self.addEventListener('activate', (event) => {
  console.log('Service Worker activated');
  event.waitUntil(clients.claim()); // Take control of all clients immediately
});

self.addEventListener('fetch', (event) => {
  // This service worker doesn't do anything with fetch events yet.
  // It can be extended to cache assets and serve them offline.
});
