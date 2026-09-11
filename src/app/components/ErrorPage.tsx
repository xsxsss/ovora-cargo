import { useRouteError, isRouteErrorResponse, useNavigate } from 'react-router';
import { AlertTriangle, Home, RefreshCw } from 'lucide-react';
import { useEffect } from 'react';
import { useTheme } from '../context/ThemeContext';
import { Sentry } from '../config/sentry';

// After a new deploy, an already-open tab may still reference an old
// content-hashed chunk filename that no longer exists on the server.
const CHUNK_RELOAD_KEY = 'ovora_chunk_reload_ts';

export function ErrorPage() {
  const error = useRouteError();
  const navigate = useNavigate();
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  let message = 'Что-то пошло не так';
  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? 'Страница не найдена' : `Ошибка ${error.status}`;
  } else if (error instanceof Error) {
    message = error.message;
  }

  const isStaleChunk = /dynamically imported module/i.test(message);

  useEffect(() => {
    if (!isStaleChunk) Sentry.captureException(error);
  }, [error, isStaleChunk]);

  // Auto-recover once: reload to fetch the fresh app shell instead of
  // stranding the user on this screen. Guarded by a timestamp so a
  // genuinely broken deploy can't trigger a reload loop.
  useEffect(() => {
    if (!isStaleChunk) return;
    const lastReload = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) || 0);
    if (Date.now() - lastReload < 30_000) return;
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
    // Голая перезагрузка не помогает: кэш и service worker снова отдадут тот же
    // устаревший index.html, который просит удалённые куски кода. Поэтому сначала
    // сбрасываем их, и только потом перезагружаемся — иначе цикл не разорвать.
    (async () => {
      try {
        if ('caches' in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map(k => caches.delete(k)));
        }
        if ('serviceWorker' in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map(r => r.unregister()));
        }
      } catch { /* очистка — лучшее усилие, перезагружаемся в любом случае */ }
      window.location.reload();
    })();
  }, [isStaleChunk]);

  return (
    <div
      className={`min-h-screen flex flex-col items-center justify-center px-6 font-['Sora'] ${
        isDark ? 'bg-[#0d1521] text-white' : 'bg-[#f6f7f8] text-[#0f172a]'
      }`}
    >
      {/* Icon */}
      <div className={`w-20 h-20 rounded-3xl flex items-center justify-center mb-6 ${
        isDark ? 'bg-red-500/15' : 'bg-red-50'
      }`}>
        <AlertTriangle className="w-9 h-9 text-red-500" />
      </div>

      {/* Title */}
      <h1 className="text-xl font-extrabold mb-2 text-center">Произошла ошибка</h1>
      <p className={`text-sm text-center mb-8 max-w-xs leading-relaxed ${
        isDark ? 'text-[#64748b]' : 'text-[#94a3b8]'
      }`}>
        {message}
      </p>

      {/* Actions */}
      <div className="flex flex-col gap-3 w-full max-w-xs">
        <button
          onClick={() => window.location.reload()}
          className="flex items-center justify-center gap-2 h-12 rounded-2xl bg-[#1978e5] text-white text-sm font-bold"
        >
          <RefreshCw className="w-4 h-4" />
          Перезагрузить
        </button>
        <button
          onClick={() => navigate('/dashboard')}
          className={`flex items-center justify-center gap-2 h-12 rounded-2xl border text-sm font-bold ${
            isDark
              ? 'border-[#1e2d3a] text-[#94a3b8] hover:bg-[#1e2d3a]'
              : 'border-[#e2e8f0] text-[#64748b] hover:bg-white'
          }`}
        >
          <Home className="w-4 h-4" />
          На главную
        </button>
      </div>
    </div>
  );
}
