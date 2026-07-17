// 1. Version Bump
const CACHE_NAME = 'rekindle-os-v10';

// 2. Cache only the shell. Application pages are fetched on demand.
const ASSETS_TO_CACHE = [
    './',
    './index',  
    './donate.svg',
    './logo.svg',
];

// Helper to clean redirected responses (Fixes Safari/Chrome errors)
function cleanResponse(response) {
    if (!response || !response.redirected) return response;

    const body = response.body;
    return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
    });
}

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('Opened cache');
                return cache.addAll(ASSETS_TO_CACHE);
            })
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(clients.claim());
    const cacheWhitelist = [CACHE_NAME];
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheWhitelist.indexOf(cacheName) === -1) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});

self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request)
            .then((response) => {
                if (response) {
                    return cleanResponse(response);
                }
                return fetch(event.request).then(networkResponse => {
                    return cleanResponse(networkResponse);
                });
            })
    );
});
