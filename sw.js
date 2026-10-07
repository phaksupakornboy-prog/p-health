// Online-only by design (SPEC): this worker exists so the app can be installed.
// It passes every request straight to the network and caches nothing.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
