import { projectId, publicAnonKey } from '../../../utils/supabase/info';
import { cacheClear as clearApiCache, adminHeaders } from './dataApi';
import { CSRF_HEADER, CSRF_TOKEN } from './csrfToken';

// authApi v2 - with getCachedUser export
const BASE = `https://${projectId}.supabase.co/functions/v1/make-server-4e36197a`;
const HEADERS = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${publicAnonKey}`,
  [CSRF_HEADER]: CSRF_TOKEN,
};

export interface OvoraUser {
  id?: string;
  email: string;
  role: 'driver' | 'sender';
  firstName: string;
  lastName: string;
  middleName?: string;
  fullName?: string;
  phone: string;
  vehicle?: {
    brand: string;
    model: string;
    year: string;
    plate: string;
  } | null;
  city?: string;
  birthDate?: string;
  about?: string;
  avatarUrl?: string;
  avatar?: string;
  createdAt?: string;
  updatedAt?: string;
}

const CURRENT_USER_KEY = 'ovora_current_user';
const USER_EMAIL_KEY = 'ovora_user_email';
const USER_ROLE_KEY = 'userRole';
const PERSISTENT_AUTH_KEY = 'ovora_auth_persistent'; // { email, role } — persistent across browser restarts
const USER_TOKEN_KEY = 'ovora_user_token'; // подписанный сервером JWT (X-User-Token), см. userAuth.tsx на бэкенде

// ── Очистить все пользовательские данные из localStorage ──────────────────────
function clearUserDataCache() {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (
        key.startsWith('ovora_chats') ||
        key.startsWith('ovora_msgs') ||
        key.startsWith('ovora_chat_contacts') ||
        key.startsWith('ovora_published_trips') ||
        key.startsWith('ovora_all_trips') ||
        key.startsWith('ovora_cached_offers') ||
        key.startsWith('ovora_seen_offer_ids')
      ) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
  } catch { /* ignore */ }
}

// ── Очистить данные предыдущего пользователя ──────────────────────────────────
function clearPreviousUserCache(newEmail: string) {
  try {
    const oldEmail = sessionStorage.getItem(USER_EMAIL_KEY);
    if (oldEmail && oldEmail.toLowerCase() !== newEmail.toLowerCase()) {
      localStorage.removeItem(CURRENT_USER_KEY);
      // Clear chat data that belongs to the previous user
      localStorage.removeItem('ovora_chats_v2');
      localStorage.removeItem('ovora_chat_contacts_v2');
      const msgKeys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith('ovora_msgs_v2_')) msgKeys.push(k);
      }
      msgKeys.forEach(k => localStorage.removeItem(k));
    }
  } catch { /* ignore */ }
}

function saveUserSession(email: string, role: 'driver' | 'sender') {
  sessionStorage.setItem(USER_EMAIL_KEY, email);
  sessionStorage.setItem(USER_ROLE_KEY, role);
  sessionStorage.setItem('isAuthenticated', 'true');
  // ✅ Persist auth across browser restarts
  localStorage.setItem(PERSISTENT_AUTH_KEY, JSON.stringify({ email, role }));
}

function clearUserSession() {
  sessionStorage.removeItem(USER_EMAIL_KEY);
  sessionStorage.removeItem(USER_ROLE_KEY);
  sessionStorage.removeItem('isAuthenticated');
  // ✅ Clear persistent auth too
  localStorage.removeItem(PERSISTENT_AUTH_KEY);
}

export function getUserSession(): { email: string; role: 'driver' | 'sender' } | null {
  let email = sessionStorage.getItem(USER_EMAIL_KEY);
  let role = sessionStorage.getItem(USER_ROLE_KEY) as 'driver' | 'sender' | null;

  // ✅ Restore session from localStorage if sessionStorage is empty (browser restart)
  if (!email || !role) {
    try {
      const persistent = JSON.parse(localStorage.getItem(PERSISTENT_AUTH_KEY) || '{}');
      if (persistent.email && persistent.role) {
        email = persistent.email;
        role = persistent.role;
        // Restore to sessionStorage
        sessionStorage.setItem(USER_EMAIL_KEY, email!);
        sessionStorage.setItem(USER_ROLE_KEY, role!);
        sessionStorage.setItem('isAuthenticated', 'true');
      }
    } catch { /* ignore */ }
  }

  if (!email || !role) return null;
  return { email, role };
}

export function getCachedUser(): Partial<OvoraUser> | null {
  const session = getUserSession();
  if (!session) return null;

  const cachedUserStr = localStorage.getItem(CURRENT_USER_KEY);
  if (cachedUserStr) {
    try {
      const cachedUser = JSON.parse(cachedUserStr);
      // ✅ Только сливаем если email совпадает — иначе это данные другого пользователя
      if (cachedUser?.email?.toLowerCase() === session.email.toLowerCase()) {
        return {
          ...cachedUser,
          email: session.email,
          role: session.role,
        };
      }
      localStorage.removeItem(CURRENT_USER_KEY);
      clearUserDataCache();
    } catch {}
  }
  
  return {
    email: session.email,
    role: session.role,
    firstName: '',
    lastName: '',
    phone: '',
  };
}

export async function registerUser(user: Partial<OvoraUser>): Promise<OvoraUser> {
  const res = await fetch(`${BASE}/auth/register`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(user),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Ошибка регистрации: ${err}`);
  }
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  
  // ✅ Чистим данные предыдущего пользователя перед сохранением нового
  clearPreviousUserCache(data.user.email);
  saveUserSession(data.user.email, data.user.role);
  localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(data.user));
  
  return data.user;
}

export async function findUserByEmail(email: string): Promise<OvoraUser | null> {
  const res = await fetch(`${BASE}/auth/login-email`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new Error(`Ошибка поиска: ${await res.text()}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.found ? data.user : null;
}

export async function findUserByPhone(phone: string): Promise<OvoraUser | null> {
  const res = await fetch(`${BASE}/auth/login-phone`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ phone }),
  });
  if (!res.ok) throw new Error(`Ошибка поиска по телефону: ${await res.text()}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.found ? data.user : null;
}

export function loginUser(user: OvoraUser) {
  const prevEmail = sessionStorage.getItem(USER_EMAIL_KEY);
  clearPreviousUserCache(user.email);
  // Сбрасываем in-memory кэш dataApi при смене пользователя
  if (prevEmail && prevEmail.toLowerCase() !== user.email.toLowerCase()) {
    clearApiCache();
  }
  saveUserSession(user.email, user.role);
  localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(user));
}

export async function updateUser(updates: Partial<OvoraUser> & { email: string }): Promise<OvoraUser> {
  const res = await fetch(`${BASE}/auth/user`, {
    method: 'PUT',
    headers: HEADERS,
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error(`Ошибка обновления: ${await res.text()}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  
  const cachedUser = getCachedUser();
  if (cachedUser) {
    localStorage.setItem(CURRENT_USER_KEY, JSON.stringify({ ...cachedUser, ...data.user }));
  }
  
  return data.user;
}

export function logoutUser() {
  clearUserSession();
  localStorage.removeItem(CURRENT_USER_KEY);
  try { localStorage.removeItem(USER_TOKEN_KEY); } catch { /* ignore */ }
  clearUserDataCache();
  clearApiCache(); // сбрасываем in-memory кэш dataApi — иначе следующий пользователь видит чужие данные
}

// ═════════════════════════════════════════════════════════════════════════════
//  PERMANENT CRYPTO CODE — постоянный код доступа на email
// ══════════════════════════════════════════════════════════════════════════════

export interface EmailCheckResult {
  hasCode: boolean;
  isNew: boolean;
  code?: string;       // только для нового email (показывается один раз!)
  message: string;
}

/**
 * Проверить email: новый или существующий?
 * Новый → сервер генерирует постоянный код и возвращает его ОДИН РАЗ
 * Существующий → возвращает hasCode:true, код не возвращается
 */
export async function checkEmailForCode(email: string): Promise<EmailCheckResult> {
  const res = await fetch(`${BASE}/auth/email-check`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ email: email.trim().toLowerCase() }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || 'Ошибка проверки email');
  return {
    hasCode: data.hasCode,
    isNew: data.isNew,
    code: data.code ?? undefined,
    message: data.message,
  };
}

/**
 * Верифицировать постоянный код доступа (SHA-256 на сервере)
 */
export async function verifyPermCode(email: string, code: string): Promise<void> {
  const res = await fetch(`${BASE}/auth/verify-perm-code`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ email: email.trim().toLowerCase(), code }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || 'Неверный код доступа');
  // Сохраняем сессионный токен (если бэкенд настроен с USER_JWT_SECRET; иначе undefined).
  if (data.token) {
    try { localStorage.setItem(USER_TOKEN_KEY, data.token); } catch { /* ignore */ }
  }
}

/**
 * Отправить 6-значный код подтверждения на почту.
 * Шаг для нового пользователя: без него сервер не даст установить PIN.
 */
export async function sendEmailCode(email: string): Promise<void> {
  const res = await fetch(`${BASE}/auth/send-email-code`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ email: email.trim().toLowerCase() }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || 'Не удалось отправить код на почту');
}

/** Проверить код из письма. После успеха открывается установка PIN. */
export async function verifyEmailCode(email: string, code: string): Promise<void> {
  const res = await fetch(`${BASE}/auth/verify-email-code`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ email: email.trim().toLowerCase(), code }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || 'Неверный код');
}

/**
 * Установить 6-значный код (только для нового пользователя, хранится SHA-256 хеш)
 */
export async function setUserCode(email: string, code: string): Promise<void> {
  const res = await fetch(`${BASE}/auth/set-code`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ email: email.trim().toLowerCase(), code }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || 'Ошибка установки кода');
}

/**
 * Сбросить код (удалить хеш) — пользователь сможет придумать новый
 */
export async function resetUserCode(email: string): Promise<void> {
  // 🔒 reset-code теперь требует прав админа на сервере (requireAdminChecked).
  // adminHeaders() добавляет X-Admin-Token/X-Admin-Code из sessionStorage.
  const res = await fetch(`${BASE}/auth/reset-code`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ email: email.trim().toLowerCase() }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || 'Ошибка сброса кода');
}

// ── Старые OTP функции (оставлены для обратной совместимости) ─────────────────

/**
 * Запросить крипто-код с сервера.
 * Сервер генерирует код, хранит только SHA-256 хеш в KV,
 * возвращает сырой код для отображения в уведомлении на сайте.
 */
export async function sendOtp(
  identifier: string,
  type: 'email' | 'phone',
  _digits?: number,
): Promise<{ code: string | null; expiresIn: number; emailSent: boolean | null; debug: string | null; rateLimited?: boolean; cooldownRemaining?: number }> {
  const res = await fetch(`${BASE}/auth/send-otp`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ identifier, type }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Ошибка отправки кода: ${err}`);
  }
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Не удалось сгенерировать код');
  return {
    code: data.code ?? null,
    expiresIn: data.expiresIn || 600,
    emailSent: false,
    debug: null,
    rateLimited: data.rateLimited ?? false,
    cooldownRemaining: data.cooldownRemaining ?? 0,
  };
}

/**
 * Верифицировать крипто-код на сервере.
 * Сервер хеширует введённый код и сравнивает с SHA-256 хешем в KV.
 */
export async function verifyOtp(
  identifier: string,
  type: 'email' | 'phone',
  code: string,
): Promise<true> {
  const res = await fetch(`${BASE}/auth/verify-otp`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ identifier, type, code }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Ошибка верификации: ${err}`);
  }
  const data = await res.json();
  if (!data.success) {
    throw new Error(data.error || 'Неверный код');
  }
  return true;
}