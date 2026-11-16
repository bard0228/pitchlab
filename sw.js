const CACHE_NAME = 'pitchlab-shell-v14';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './assets/logo.png',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-maskable-512.png',
  './styles/liquid-glass-kit.css',
  './styles/app.css',
  './src/app.js',
  './src/audio-math.js',
  './src/cloud-sync.js',
  './src/dual-deck.js',
  './src/fixture-gen.js',
  './src/lyrics.js',
  './src/pitch-worklet.js',
  './src/pitch-judge.js',
  './src/mic-pitch.js',
  './src/web-separator.js',
  './src/zip-reader.js',
  './src/song-library.js',
  './src/android-overscroll.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // Network-first so HTML/CSS/JS always stay in sync when online, falling back to cache offline
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true }))
  );
});
