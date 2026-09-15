// Сервер тестовой площадки. Anon key не секрет — он в коде любой страницы сайта.
export const API = process.env.E2E_API_URL
  || 'https://xrtqquuwlnnihphszyns.supabase.co/functions/v1/make-server-4e36197a';

export const ANON_KEY = process.env.E2E_ANON_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhydHFxdXV3bG5uaWhwaHN6eW5zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0NDgwODgsImV4cCI6MjEwNTAyNDA4OH0.6NXG664rsvZ2jZwZmh5705YbSxepf-tExHhzsdK9XgM'; // pragma: allowlist secret

export const SITE_ORIGIN = new URL(process.env.E2E_BASE_URL || 'https://staging-ovora-cargo.saburov.workers.dev').origin;

/** Заголовки, с которыми ходит сайт: anon key, CSRF и origin сайта. */
export function siteHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    apikey: ANON_KEY,
    Authorization: `Bearer ${ANON_KEY}`,
    'X-Csrf-Token': 'ovora-pwa-v1',
    Origin: SITE_ORIGIN,
    'Content-Type': 'application/json',
    ...extra,
  };
}
