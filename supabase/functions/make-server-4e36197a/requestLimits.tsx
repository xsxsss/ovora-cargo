// Общий лимит частоты на все адреса сервера — защита от спама и перебора.
// Точечные лимиты (вход, регистрация, коды) остаются и работают поверх этого.
// Чистая функция без Deno и без хранилища — покрыта тестами в requestLimits.test.ts.

export type Identity =
  | { kind: 'user'; id: string }   // проверенный X-User-Token
  | { kind: 'avia'; id: string }   // проверенный X-Avia-Token
  | { kind: 'ip'; id: string };    // без входа

export interface LimitPolicy {
  bucket: string;
  max: number;
  windowMs: number;
}

const MINUTE = 60_000;
const ROUTE_PREFIX = '/make-server-4e36197a';

// Лимиты с запасом над обычной работой: самые частые опросы в приложении — раз в 5 секунд,
// то есть ~12 запросов в минуту на экран. Анонимам больше на чтение: у мобильных операторов
// много людей выходят в интернет с одного IP.
const LIMITS = {
  admin: { read: 600, write: 200 },
  signedIn: { read: 300, write: 60 },
  anonymous: { read: 600, write: 60 },
};

export function isAdminPath(path: string): boolean {
  const p = path.startsWith(ROUTE_PREFIX) ? path.slice(ROUTE_PREFIX.length) : path;
  return p.startsWith('/admin/') || p.startsWith('/avia/admin/') || p.startsWith('/kv/');
}

/** null — запрос не ограничивается (preflight CORS). */
export function requestLimitPolicy(method: string, path: string, identity: Identity): LimitPolicy | null {
  const m = method.toUpperCase();
  if (m === 'OPTIONS') return null;
  const kind = m === 'GET' || m === 'HEAD' ? 'read' : 'write';
  const scope = isAdminPath(path) ? 'admin' : identity.kind === 'ip' ? 'anonymous' : 'signedIn';
  return {
    bucket: `global:${scope}:${kind}:${identity.kind}:${identity.id}`,
    max: LIMITS[scope][kind],
    windowMs: MINUTE,
  };
}

// Перебор кода админки: после 20 неудачных попыток с одного IP — пауза 15 минут.
export const ADMIN_AUTH_FAILURES = { max: 20, windowMs: 15 * MINUTE };
