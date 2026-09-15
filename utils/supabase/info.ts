// Какой проект Supabase использует сайт. Anon key не секрет: он и так виден в коде любой страницы.
//
// Тестовые версии веток на Cloudflare (<версия>-ovora-cargo.saburov.workers.dev) и локальный запуск
// работают с тестовой базой — проверки не трогают настоящих пользователей. Основной адрес и старый
// GitHub Pages — с боевой. VITE_SUPABASE_PROJECT_ID / VITE_SUPABASE_ANON_KEY перекрывают выбор.

const PRODUCTION = {
  projectId: 'mkbcjxnoeevtkzaqcpsh', // pragma: allowlist secret
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1rYmNqeG5vZWV2dGt6YXFjcHNoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1MzIyNjIsImV4cCI6MjA4ODEwODI2Mn0.Xs69UZv49GxjWcJesdQ05brrEVFQYYNKydVqkIGoJJE', // pragma: allowlist secret
};

const STAGING = {
  projectId: 'xrtqquuwlnnihphszyns', // pragma: allowlist secret
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhydHFxdXV3bG5uaWhwaHN6eW5zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0NDgwODgsImV4cCI6MjEwNTAyNDA4OH0.6NXG664rsvZ2jZwZmh5705YbSxepf-tExHhzsdK9XgM', // pragma: allowlist secret
};

export function isStagingHost(hostname: string): boolean {
  return /^[a-z0-9-]+-ovora-cargo\.saburov\.workers\.dev$/.test(hostname)
    || hostname === 'localhost' || hostname === '127.0.0.1';
}

const env = (import.meta as any).env ?? {};
const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
const target = isStagingHost(hostname) ? STAGING : PRODUCTION;

export const isStaging: boolean = target === STAGING && !env.VITE_SUPABASE_PROJECT_ID;
export const projectId: string = env.VITE_SUPABASE_PROJECT_ID ?? target.projectId;
export const publicAnonKey: string = env.VITE_SUPABASE_ANON_KEY ?? target.anonKey;
