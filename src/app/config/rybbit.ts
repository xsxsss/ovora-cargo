/**
 * Rybbit — аналитика без cookie: где люди заходят, на каком шаге уходят.
 * ID сайта не секрет (виден в коде страницы), передаётся через VITE_RYBBIT_SITE_ID.
 * Без него, в dev-режиме и на localhost скрипт не грузится.
 */
const SCRIPT_URL = 'https://app.rybbit.io/api/script.js';

function withBase(paths: string[]): string[] {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return paths.map(p => base + p);
}

// Админка — не пользователи сайта.
export const SKIP_PATTERNS = withBase(['/admin', '/admin/**']);

// В адресах лежат телефон и идентификаторы — в аналитику уходит только шаблон.
export const MASK_PATTERNS = withBase([
  '/trip/*',
  '/chat/*',
  '/track/*',
  '/avia/user/*',
  '/avia/flight/*/manifest',
]);

export function initRybbit(): void {
  const siteId = import.meta.env.VITE_RYBBIT_SITE_ID;
  if (!siteId || !import.meta.env.PROD) return;
  if (['localhost', '127.0.0.1'].includes(window.location.hostname)) return;

  const script = document.createElement('script');
  script.src = `${SCRIPT_URL}?siteId=${encodeURIComponent(siteId)}`;
  script.async = true;
  script.dataset.skipPatterns = JSON.stringify(SKIP_PATTERNS);
  script.dataset.maskPatterns = JSON.stringify(MASK_PATTERNS);
  document.head.appendChild(script);
}
