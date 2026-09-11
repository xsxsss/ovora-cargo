import { projectId, publicAnonKey } from '../../../utils/supabase/info';
import { CSRF_HEADER, CSRF_TOKEN } from './csrfToken';

const BASE = `https://${projectId}.supabase.co/functions/v1/make-server-4e36197a`;
const BASE_HEADERS = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${publicAnonKey}`,
  [CSRF_HEADER]: CSRF_TOKEN,
};

/** JSON-запросы: anon key + CSRF + (если есть сессия) X-Avia-Token владельца сессии */
function getHeaders(): Record<string, string> {
  const token = getAviaSession()?.token;
  return token ? { ...BASE_HEADERS, 'X-Avia-Token': token } : BASE_HEADERS;
}

/** Multipart-запросы (FormData) — без Content-Type, браузер сам выставит boundary.
 *  CSRF-заголовок обязателен: бэкенд отклоняет любой POST/PUT без него (403). */
function getFormHeaders(): Record<string, string> {
  const token = getAviaSession()?.token;
  const base: Record<string, string> = {
    Authorization: `Bearer ${publicAnonKey}`,
    [CSRF_HEADER]: CSRF_TOKEN,
  };
  return token ? { ...base, 'X-Avia-Token': token } : base;
}

// ── Типы ─────────────────────────────────────────────────────────────────────

export interface AviaUser {
  id: string;
  phone: string;
  role: 'courier' | 'sender';
  firstName?: string;
  lastName?: string;
  middleName?: string;
  birthDate?: string;
  passportNumber?: string;
  passportPhoto?: string;
  passportPhotoPath?: string;
  passportUploadedAt?: string;
  passportExpiryDate?: string;
  passportVerified?: boolean;
  passportExpired?: boolean;
  avatarUrl?: string;
  city?: string;
  telegram?: string;
  createdAt?: string;
  lastLoginAt?: string;
  updatedAt?: string;
}

export interface AviaFlight {
  id: string;
  courierId: string;
  courierName?: string;
  courierAvatar?: string;
  courierRating?: number;
  courierReviewCount?: number;
  from: string;
  to: string;
  date: string;
  flightNo?: string;
  // Cargo
  cargoEnabled?: boolean;
  cargoKg?: number;
  freeKg: number;
  reservedKg?: number;
  pricePerKg?: number;
  // Docs
  docsEnabled?: boolean;
  docsPrice?: number;
  // Currency (backward-compat default: 'USD')
  currency?: string;
  status: string;
  startedAt?: string;
  createdAt: string;
}

export interface AviaCheckResult {
  isNew: boolean;
  hasPin: boolean;
  hasProfile?: boolean;
}

export interface AviaOcrResult {
  success: boolean;
  fullName?: string | null;
  birthDate?: string | null;
  documentNumber?: string | null;
}

// ── Сессия ───────────────────────────────────────────────────────────────────

const AVIA_SESSION_KEY    = 'ovora_avia_session';
const SESSION_TTL_MS      = 30 * 24 * 60 * 60_000; // 30 дней

interface AviaSessionData {
  phone    : string;
  user     : AviaUser;
  token?   : string; // подписанный сервером JWT (X-Avia-Token), см. aviaAuth.tsx на бэкенде
  expiresAt: number; // unix ms
}

export function getAviaSession(): { phone: string; user: AviaUser; token?: string } | null {
  try {
    const raw = localStorage.getItem(AVIA_SESSION_KEY);
    if (!raw) return null;
    const parsed: AviaSessionData = JSON.parse(raw);

    // ── Проверяем TTL ──────────────────────────────────────────────────────
    if (parsed.expiresAt && Date.now() > parsed.expiresAt) {
      localStorage.removeItem(AVIA_SESSION_KEY);
      return null;
    }

    return { phone: parsed.phone, user: parsed.user, token: parsed.token };
  } catch {
    return null;
  }
}

/** token не передан → сохраняем токен текущей сессии (используется при обновлении профиля/аватара) */
export function saveAviaSession(phone: string, user: AviaUser, token?: string): void {
  const data: AviaSessionData = {
    phone,
    user,
    token: token ?? getAviaSession()?.token,
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
  localStorage.setItem(AVIA_SESSION_KEY, JSON.stringify(data));
}

export function clearAviaSession(): void {
  localStorage.removeItem(AVIA_SESSION_KEY);
}

/** Продлить TTL сессии при активном использовании (вызывать при логине) */
export function renewAviaSession(): void {
  const session = getAviaSession();
  if (!session) return;
  saveAviaSession(session.phone, session.user);
}

// ── Retry helper ──────────────────────────────────────────────────────────────

async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  { retries = 2, backoffMs = 500 } = {},
): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(input, init);
      // Don't retry on client errors (4xx), only on server/network errors
      if (res.ok || (res.status >= 400 && res.status < 500)) return res;
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err: any) {
      lastError = err;
    }
    if (attempt < retries) {
      await new Promise(r => setTimeout(r, backoffMs * Math.pow(2, attempt)));
    }
  }
  throw lastError || new Error('Fetch failed after retries');
}

// ── API вызовы ───────────────────────────────────────────────────────────────

/** Проверить телефон: новый или существующий? */
export async function checkPhone(phone: string): Promise<AviaCheckResult> {
  const res = await fetch(`${BASE}/avia/check-phone`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ phone }),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || 'Ошибка проверки телефона');
  return { isNew: data.isNew, hasPin: data.hasPin, hasProfile: data.hasProfile };
}

/** Регистрация: phone + pin + role */
export async function registerAvia(phone: string, pin: string, role: string): Promise<AviaUser> {
  const res = await fetch(`${BASE}/avia/register`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ phone, pin, role }),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || 'Ошибка регистрации');
  saveAviaSession(phone.replace(/\D/g, ''), data.user, data.token);
  return data.user;
}

/** Вход: phone + pin */
export async function loginAvia(phone: string, pin: string): Promise<AviaUser> {
  const res = await fetch(`${BASE}/avia/login`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ phone, pin }),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || 'Ошибка входа');
  saveAviaSession(phone.replace(/\D/g, ''), data.user, data.token);
  return data.user;
}

/** Получить профиль */
export async function getAviaProfile(phone: string): Promise<AviaUser | null> {
  const clean = phone.replace(/\D/g, '');
  const res = await fetchWithRetry(`${BASE}/avia/profile/${encodeURIComponent(clean)}`, {
    headers: getHeaders(),
  });
  const data = await res.json();
  if (!data.found) return null;
  return data.user;
}

/** Обновить профиль */
export async function updateAviaProfile(phone: string, updates: Partial<AviaUser>): Promise<AviaUser> {
  const res = await fetchWithRetry(`${BASE}/avia/profile`, {
    method: 'PUT',
    headers: getHeaders(),
    body: JSON.stringify({ phone, ...updates }),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || 'Ошибка обновления профиля');

  // Обновляем сессию
  const session = getAviaSession();
  if (session) {
    saveAviaSession(session.phone, { ...session.user, ...data.user });
  }

  return data.user;
}

/** Загрузка аватара AVIA (multipart) */
export async function uploadAviaAvatar(
  phone: string,
  file: File,
): Promise<{ avatarUrl: string; user: AviaUser }> {
  const clean = phone.replace(/\D/g, '');
  const formData = new FormData();
  formData.append('avatar', file);

  const res = await fetch(`${BASE}/avia/users/${encodeURIComponent(clean)}/avatar`, {
    method: 'POST',
    headers: getFormHeaders(),
    body: formData,
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || 'Ошибка загрузки аватара');

  // Обновляем сессию
  const session = getAviaSession();
  if (session) {
    saveAviaSession(session.phone, { ...session.user, avatarUrl: data.avatarUrl });
  }

  return { avatarUrl: data.avatarUrl, user: data.user };
}

/** OCR сканирование паспорта */
export async function scanPassport(imageBase64: string): Promise<AviaOcrResult> {
  const res = await fetch(`${BASE}/avia/scan-passport`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ imageBase64 }),
  });
  const data = await res.json();
  if (!res.ok && !data.success) throw new Error(data.error || 'Ошибка сканирования');
  return data;
}

/** Загрузка фото паспорта (ONE-TIME) + OCR */
export async function uploadPassport(
  phone: string,
  file: File,
  expiryDate?: string,
  skipOcr: boolean = false
): Promise<{ user: AviaUser; photoUrl: string; expiryDate: string; isExpired: boolean; ocrFullName?: string; ocrFailed?: boolean }> {
  const formData = new FormData();
  formData.append('phone', phone.replace(/\D/g, ''));
  formData.append('file', file);
  if (expiryDate) formData.append('expiryDate', expiryDate);
  if (skipOcr) formData.append('skipOcr', 'true');

  const res = await fetch(`${BASE}/avia/upload-passport`, {
    method: 'POST',
    headers: getFormHeaders(),
    body: formData,
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || 'Ошибка загрузки паспорта');

  // Обновляем сессию
  const session = getAviaSession();
  if (session) {
    saveAviaSession(session.phone, { ...session.user, ...data.user });
  }

  return data;
}

/** Получить свежий signed URL фото паспорта (только своего — callerPhone берётся из текущей сессии) */
export async function getPassportPhoto(phone: string): Promise<string | null> {
  const clean = phone.replace(/\D/g, '');
  const callerPhone = getAviaSession()?.phone || '';
  const qs = callerPhone ? `?callerPhone=${encodeURIComponent(callerPhone)}` : '';
  const res = await fetch(`${BASE}/avia/passport-photo/${encodeURIComponent(clean)}${qs}`, {
    headers: getHeaders(),
  });
  const data = await res.json();
  if (!data.found) return null;
  return data.photoUrl;
}

/** Проверка: можно ли создавать объявления? */
export function canCreateAd(user: AviaUser | null): { allowed: boolean; reason?: string } {
  if (!user) return { allowed: false, reason: 'Не авторизован' };
  if (!user.passportPhoto && !user.passportPhotoPath) {
    return { allowed: false, reason: 'Загрузите фото паспорта для создания объявлений' };
  }
  if (!user.firstName || !user.lastName) {
    return { allowed: false, reason: 'Заполните ФИО в профиле перед созданием объявления' };
  }
  if (user.passportExpired) {
    return { allowed: false, reason: 'Ваш паспорт просрочен. Создание объявлений невозможно.' };
  }
  if (user.passportExpiryDate) {
    const exp = new Date(user.passportExpiryDate);
    if (exp.getTime() < Date.now()) {
      return { allowed: false, reason: 'Ваш паспорт просрочен. Создание объявлений невозможно.' };
    }
  }
  if (user.role === 'sender') {
    return { allowed: false, reason: 'Отправители не могут создавать рейсы (только заявки)' };
  }
  return { allowed: true };
}

// ── Фильтры ──────────────────────────────────────────────────────────────────

export interface AviaFilters {
  from?: string;
  to?: string;
  date?: string;       // YYYY-MM-DD
  weightMin?: number;
  weightMax?: number;
}

function buildFilterParams(filters?: AviaFilters): string {
  if (!filters) return '';
  const p = new URLSearchParams();
  if (filters.from) p.set('from', filters.from);
  if (filters.to) p.set('to', filters.to);
  if (filters.date) p.set('date', filters.date);
  if (filters.weightMin && filters.weightMin > 0) p.set('weightMin', String(filters.weightMin));
  if (filters.weightMax && filters.weightMax > 0) p.set('weightMax', String(filters.weightMax));
  const s = p.toString();
  return s ? `?${s}` : '';
}

// ── Рейсы и Заявки ───────────────────────────────────────────────────────────

export async function getAviaFlights(filters?: AviaFilters): Promise<AviaFlight[]> {
  const qs = buildFilterParams(filters);
  const res = await fetchWithRetry(`${BASE}/avia/flights${qs}`, { headers: getHeaders() });
  if (!res.ok) return [];
  const data = await res.json();
  return data.flights || [];
}

export async function getAviaFlight(id: string, callerPhone?: string): Promise<AviaFlight | null> {
  const qs = callerPhone ? `?callerPhone=${encodeURIComponent(callerPhone.replace(/\D/g, ''))}` : '';
  const res = await fetchWithRetry(`${BASE}/avia/flights/${encodeURIComponent(id)}${qs}`, { headers: getHeaders() });
  if (!res.ok) return null;
  const data = await res.json();
  return data.flight || null;
}

export async function createAviaFlight(flightData: Partial<AviaFlight>): Promise<{ success: boolean; flight?: AviaFlight; error?: string }> {
  const res = await fetch(`${BASE}/avia/flights`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(flightData),
  });
  return res.json();
}

/** Редактировать рейс: цены, номер рейса, дату (маршрут и вес не меняются) */
export async function updateAviaFlight(
  id: string,
  callerPhone: string,
  updates: { pricePerKg?: number; docsPrice?: number; currency?: string; flightNo?: string; date?: string },
): Promise<{ success: boolean; flight?: AviaFlight; error?: string }> {
  const res = await fetch(`${BASE}/avia/flights/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: getHeaders(),
    body: JSON.stringify({ callerPhone, ...updates }),
  });
  return res.json();
}

/** Удалить рейс (мягкое удаление) */
export async function deleteAviaFlight(id: string, callerPhone: string): Promise<{ success: boolean; error?: string }> {
  const res = await fetch(`${BASE}/avia/flights/${encodeURIComponent(id)}?callerPhone=${encodeURIComponent(callerPhone)}`, {
    method: 'DELETE',
    headers: getHeaders(),
  });
  return res.json();
}

/** Начать поездку (status → in_progress, рейс скрывается из публичного поиска) */
export async function startAviaFlight(id: string, callerPhone: string): Promise<{ success: boolean; flight?: AviaFlight; error?: string }> {
  const res = await fetch(`${BASE}/avia/flights/${encodeURIComponent(id)}/start`, {
    method: 'PATCH',
    headers: getHeaders(),
    body: JSON.stringify({ callerPhone }),
  });
  return res.json();
}

/** Закрыть рейс (status → closed) */
export async function closeAviaFlight(id: string, callerPhone: string): Promise<{ success: boolean; flight?: AviaFlight; error?: string }> {
  const res = await fetch(`${BASE}/avia/flights/${encodeURIComponent(id)}/close`, {
    method: 'PATCH',
    headers: getHeaders(),
    body: JSON.stringify({ callerPhone }),
  });
  return res.json();
}

/** Завершить поездку (status → completed, все принятые сделки → completed) */
export async function completeAviaFlight(id: string, callerPhone: string): Promise<{ success: boolean; flight?: AviaFlight; completedDeals?: number; error?: string }> {
  const res = await fetch(`${BASE}/avia/flights/${encodeURIComponent(id)}/complete`, {
    method: 'PATCH',
    headers: getHeaders(),
    body: JSON.stringify({ callerPhone }),
  });
  return res.json();
}

/** Получить мои объявления (рейсы, включая закрытые) */
export async function getMyAviaAds(phone: string): Promise<{ flights: AviaFlight[] }> {
  const clean = phone.replace(/\D/g, '');
  const res = await fetchWithRetry(`${BASE}/avia/my/${encodeURIComponent(clean)}?callerPhone=${encodeURIComponent(clean)}`, { headers: getHeaders() });
  if (!res.ok) return { flights: [] };
  return res.json();
}

// ── Уведомления AVIA (изолированное пространство ovora:avia-notif:*) ──────────

export interface AviaNotification {
  id: string;
  phone: string;
  type: 'flight' | 'request' | 'system' | 'passport' | 'info';
  iconName: string;
  iconBg: string;
  title: string;
  description: string;
  isUnread: boolean;
  createdAt: string;
}

/** Проверка: является ли ошибка штатной отменой fetch */
function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; code?: number; message?: string };
  return (
    e.name === 'AbortError' ||
    e.name === 'CancelledError' ||
    (e as any) instanceof DOMException && (e as any).code === 20
  );
}

/** Проверка: является ли ошибка транзиентной сетевой (холодный старт / обрыв) */
function isNetworkError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; message?: string };
  if (e.name === 'TypeError' && typeof e.message === 'string') {
    const msg = e.message.toLowerCase();
    return (
      msg.includes('failed to fetch') ||
      msg.includes('network request failed') ||
      msg.includes('load failed') ||
      msg.includes('networkerror')
    );
  }
  return false;
}

/** Получить все уведомления AVIA для пользователя */
export async function getAviaNotifications(phone: string, signal?: AbortSignal): Promise<AviaNotification[]> {
  const clean = phone.replace(/\D/g, '');
  if (!clean) return [];
  // Если сигнал уже отменён — не делаем запрос
  if (signal?.aborted) return [];
  try {
    const res = await fetch(`${BASE}/avia/notifications/${encodeURIComponent(clean)}`, {
      headers: getHeaders(),
      signal,
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.notifications || [];
  } catch (err) {
    // Штатная отмена (unmount / навигация)
    if (isAbortError(err) || signal?.aborted) return [];
    // Транзиентная сетевая ошибка (холодный старт, обрыв) — не критично для polling
    if (isNetworkError(err)) {
      return [];
    }
    console.error('[aviaApi] getAviaNotifications error:', err);
    return [];
  }
}

/** Пометить уведомление(я) прочитанными. id = конкретный ID или 'all' */
export async function markAviaNotificationsRead(phone: string, id: string): Promise<void> {
  const clean = phone.replace(/\D/g, '');
  if (!clean) return;
  try {
    await fetch(`${BASE}/avia/notifications/read`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ phone: clean, id }),
    });
  } catch (err) {
    if (!isAbortError(err)) console.error('[aviaApi] markAviaNotificationsRead error:', err);
  }
}

/** Удалить одно уведомление */
export async function deleteAviaNotification(phone: string, id: string): Promise<void> {
  const clean = phone.replace(/\D/g, '');
  if (!clean || !id) return;
  try {
    await fetch(`${BASE}/avia/notifications/${encodeURIComponent(clean)}/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
  } catch (err) {
    if (!isAbortError(err)) console.error('[aviaApi] deleteAviaNotification error:', err);
  }
}

/** Быстрая проверка числа непрочитанных (легковесный polling) */
export async function checkAviaUnread(phone: string, signal?: AbortSignal): Promise<number> {
  const clean = phone.replace(/\D/g, '');
  if (!clean) return 0;
  if (signal?.aborted) return 0;
  try {
    const res = await fetch(`${BASE}/avia/notifications/check/${encodeURIComponent(clean)}`, {
      headers: getHeaders(),
      signal,
    });
    if (!res.ok) return 0;
    const data = await res.json();
    return data.unread || 0;
  } catch (err) {
    if (isAbortError(err) || signal?.aborted) return 0;
    // Транзиентная сетевая ошибка — не логируем для polling
    if (isNetworkError(err)) return 0;
    return 0;
  }
}

/** Сменить PIN-код (с ограничением попыток) */
export async function changeAviaPin(
  phone: string,
  currentPin: string,
  newPin: string,
): Promise<{ success: boolean; error?: string; lockedUntil?: string; lockedSeconds?: number; attemptsLeft?: number }> {
  const clean = phone.replace(/\D/g, '');
  const res = await fetch(`${BASE}/avia/users/${encodeURIComponent(clean)}/pin`, {
    method: 'PATCH',
    headers: getHeaders(),
    body: JSON.stringify({ currentPin, newPin }),
  });
  const data = await res.json();
  if (!res.ok) {
    return {
      success: false,
      error: data.error || 'Ошибка смены PIN',
      lockedUntil: data.lockedUntil,
      lockedSeconds: data.lockedSeconds,
      attemptsLeft: data.attemptsLeft,
    };
  }
  return { success: true };
}