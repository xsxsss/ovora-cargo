// Service Worker для Ovora Cargo PWA
const CACHE_VERSION = 'v4.0.34';
const STATIC_CACHE  = `ovora-static-${CACHE_VERSION}`;
const DYNAMIC_CACHE = `ovora-dynamic-${CACHE_VERSION}`;
// Файл не проходит через Vite, поэтому базу вычисляем из собственного адреса:
// на GitHub Pages это /ovora-cargo/, на Vercel — /.
const BASE_PATH     = new URL('./', self.location).pathname;

function isImmutableAsset(url) {
  return (
    url.pathname.includes('/assets/') ||
    /\.(woff2?|ttf|otf|eot)$/.test(url.pathname)
  );
}

function isImage(url) {
  return /\.(png|jpg|jpeg|webp|svg|ico|gif|avif)$/.test(url.pathname);
}

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache =>
      cache.addAll([BASE_PATH, BASE_PATH + 'manifest.json'])
    )
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(names =>
      Promise.all(
        names
          .filter(n => n !== STATIC_CACHE && n !== DYNAMIC_CACHE)
          .map(n => caches.delete(n))
      )
    )
  );
  return self.clients.claim();
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.origin.includes('supabase.co')) return;

  if (isImmutableAsset(url) || isImage(url)) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          if (response.status === 200) {
            const clone = response.clone();
            caches.open(STATIC_CACHE).then(c => c.put(request, clone));
          }
          return response;
        });
      })
    );
  } else {
    // Навигацию (index.html) всегда тянем с сети мимо HTTP-кэша: иначе браузер
    // отдаёт index.html прошлой сборки, который просит уже удалённые куски кода,
    // и приложение падает в ошибку сразу после деплоя.
    const networkFetch = request.mode === 'navigate'
      ? fetch(request.url, { cache: 'reload', credentials: 'same-origin' })
      : fetch(request);
    event.respondWith(
      networkFetch
        .then(response => {
          if (response.status === 200) {
            const clone = response.clone();
            caches.open(DYNAMIC_CACHE).then(c => c.put(request, clone));
          }
          return response;
        })
        .catch(() =>
          caches.match(request).then(cached => cached || caches.match(BASE_PATH))
        )
    );
  }
});

self.addEventListener('push', event => {
  let data = {
    title: 'Ovora Cargo',
    body: 'У вас новое уведомление',
    icon: BASE_PATH + 'icons/logo-bird.png',
    tag: 'notification',
    url: BASE_PATH,
  };
  if (event.data) {
    try { data = { ...data, ...event.data.json() }; }
    catch { data.body = event.data.text(); }
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon,
      tag: data.tag,
      data: { url: data.url },
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || BASE_PATH;
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(list => {
      const existing = list.find(c => c.url.includes(url));
      if (existing) return existing.focus();
      return clients.openWindow(url);
    })
  );
});
