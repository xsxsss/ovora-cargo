/**
 * Яндекс.Метрика: посещения, воронки, Вебвизор. Номер счётчика не секрет (виден в коде
 * страницы), передаётся через VITE_YANDEX_METRIKA_ID. Без него, в dev и на localhost не грузится.
 *
 * Сайт — SPA, поэтому счётчик создаётся с defer и каждый переход отправляется вручную
 * через подписку на роутер. Админка в статистику не попадает.
 */
const TAG_URL = 'https://mc.yandex.ru/metrika/tag.js';

// В адресах лежат телефон и идентификаторы — в Метрику уходит только шаблон.
const MASKS: [RegExp, string][] = [
  [/^\/avia\/user\/[^/]+/, '/avia/user/:phone'],
  [/^\/avia\/flight\/[^/]+\/manifest/, '/avia/flight/:id/manifest'],
  [/^\/trip\/[^/]+/, '/trip/:id'],
  [/^\/chat\/[^/]+/, '/chat/:id'],
  [/^\/track\/[^/]+/, '/track/:id'],
];

/**
 * Адрес страницы для Метрики: без базы сайта, без параметров запроса, с замаскированными
 * идентификаторами. null — страницу не считаем (админка).
 */
export function metrikaPath(pathname: string, base: string): string | null {
  const trimmedBase = base.replace(/\/$/, '');
  let path = trimmedBase && pathname.startsWith(trimmedBase) ? pathname.slice(trimmedBase.length) : pathname;
  if (!path.startsWith('/')) path = '/' + path;
  if (path === '/admin' || path.startsWith('/admin/')) return null;
  for (const [pattern, replacement] of MASKS) {
    if (pattern.test(path)) return path.replace(pattern, replacement);
  }
  return path;
}

interface RouterLike {
  state: { location: { pathname: string } };
  subscribe(listener: (state: { location: { pathname: string } }) => void): () => void;
}

type Ym = ((id: number, method: string, ...args: unknown[]) => void) & { a?: unknown[][]; l?: number };

export function initYandexMetrika(router: RouterLike): void {
  const id = Number(import.meta.env.VITE_YANDEX_METRIKA_ID);
  if (!id || !import.meta.env.PROD) return;
  if (['localhost', '127.0.0.1'].includes(window.location.hostname)) return;

  const base = import.meta.env.BASE_URL;
  const toUrl = (path: string) => window.location.origin + base.replace(/\/$/, '') + path;
  // Вебвизор пишет экран с момента загрузки: если сайт открыли сразу в админке, счётчик не ставим.
  const firstPath = metrikaPath(router.state.location.pathname, base);
  if (firstPath === null) return;

  const w = window as unknown as { ym?: Ym };
  if (!w.ym) {
    const queue: Ym = ((...args: unknown[]) => { (queue.a = queue.a || []).push(args); }) as Ym;
    queue.l = Date.now();
    w.ym = queue;
    const script = document.createElement('script');
    script.async = true;
    script.src = `${TAG_URL}?id=${id}`;
    document.head.appendChild(script);
  }

  w.ym!(id, 'init', {
    defer: true,
    clickmap: true,
    trackLinks: true,
    accurateTrackBounce: true,
    webvisor: true,
  });

  let lastUrl = toUrl(firstPath);
  w.ym!(id, 'hit', lastUrl, { title: document.title, referer: document.referrer });

  router.subscribe((state) => {
    const path = metrikaPath(state.location.pathname, base);
    if (path === null) return;
    const url = toUrl(path);
    if (url === lastUrl) return;
    w.ym!(id, 'hit', url, { title: document.title, referer: lastUrl });
    lastUrl = url;
  });
}
