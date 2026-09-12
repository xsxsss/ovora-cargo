/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  SUPABASE AUTH — заполнение карточки пользователя                        ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * В дашборде Supabase (Authentication → Users) колонки Display name и Phone
 * стояли пустыми: письмо с кодом мы просим у GoTrue, передавая только email,
 * а имя и телефон человек заполняет позже, уже в своём профиле — и в Auth они
 * не попадали. Здесь мы досылаем их через Admin API.
 *
 * Работает через SERVICE_ROLE_KEY — вызывать только из бэкенда.
 * Ни одна ошибка отсюда не должна ронять основной запрос: заполнение карточки
 * в Auth — вспомогательная вещь, профиль живёт в KV.
 */

import * as kv from "./kv_store.tsx";

const uidKey = (email: string) => `ovora:auth_uid:${email.toLowerCase().trim()}`;

function authUrl(path: string): string {
  return `${(Deno.env.get('SUPABASE_URL') || '').replace(/\/$/, '')}/auth/v1${path}`;
}

function serviceHeaders(): Record<string, string> | null {
  const key = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim();
  if (!key) return null;
  return { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` };
}

/** Запомнить id пользователя в Auth — его возвращает GoTrue при проверке кода. */
export async function rememberAuthUserId(email: string, id?: string | null): Promise<void> {
  if (!email || !id) return;
  try {
    await kv.set(uidKey(email), { id, email: email.toLowerCase().trim() });
  } catch (e) {
    console.warn('[AuthIdentity] не удалось запомнить auth uid:', e);
  }
}

/** id пользователя в Auth: сначала из KV, иначе спрашиваем Admin API. */
export async function findAuthUserId(email: string): Promise<string | null> {
  const clean = (email || '').toLowerCase().trim();
  if (!clean) return null;

  try {
    const cached: any = await kv.get(uidKey(clean));
    if (cached?.id) return cached.id;
  } catch { /* ignore */ }

  const headers = serviceHeaders();
  if (!headers) return null;

  try {
    const res = await fetch(authUrl(`/admin/users?per_page=200&filter=${encodeURIComponent(clean)}`), { headers });
    if (!res.ok) return null;
    const data: any = await res.json();
    const found = (data?.users || []).find((u: any) => (u?.email || '').toLowerCase() === clean);
    if (found?.id) {
      await rememberAuthUserId(clean, found.id);
      return found.id;
    }
  } catch (e) {
    console.warn('[AuthIdentity] поиск пользователя в Auth не удался:', e);
  }
  return null;
}

/** Телефон для Auth: только цифры с ведущим + (E.164), иначе GoTrue его не примет. */
function toE164(phone?: string | null): string | null {
  const digits = (phone || '').replace(/\D/g, '');
  if (digits.length < 9 || digits.length > 15) return null;
  return `+${digits}`;
}

export interface AuthIdentityFields {
  displayName?: string | null;
  phone?: string | null;
  role?: string | null;
  platform?: 'cargo' | 'avia';
}

/**
 * Дописать в карточку Supabase Auth имя и телефон.
 * Имя и телефон пишутся раздельно: телефон в Auth уникален, и если он уже
 * занят другим аккаунтом, GoTrue вернёт ошибку — имя при этом должно
 * сохраниться, поэтому это два отдельных запроса.
 */
export async function syncAuthIdentity(email: string, fields: AuthIdentityFields): Promise<void> {
  const headers = serviceHeaders();
  if (!headers) return;

  const clean = (email || '').toLowerCase().trim();
  if (!clean) return;

  const id = await findAuthUserId(clean);
  if (!id) return; // человек ещё не заводился в Auth — заведётся при первом коде на почту

  const displayName = (fields.displayName || '').trim();
  const e164        = toE164(fields.phone);

  // 1) Имя и прочие данные — в user_metadata. Дашборд показывает display_name,
  //    другие клиенты чаще читают full_name/name, поэтому пишем все три.
  if (displayName || fields.role || fields.platform || e164) {
    const meta: Record<string, unknown> = {};
    if (displayName) { meta.display_name = displayName; meta.full_name = displayName; meta.name = displayName; }
    if (e164)             meta.phone    = e164;
    if (fields.role)      meta.role     = fields.role;
    if (fields.platform)  meta.platform = fields.platform;

    try {
      const res = await fetch(authUrl(`/admin/users/${id}`), {
        method : 'PUT',
        headers,
        body   : JSON.stringify({ user_metadata: meta }),
      });
      if (!res.ok) {
        console.warn(`[AuthIdentity] метаданные не обновлены (${res.status}):`, (await res.text().catch(() => '')).slice(0, 200));
      }
    } catch (e) {
      console.warn('[AuthIdentity] ошибка обновления метаданных:', e);
    }
  }

  // 2) Колонка Phone в дашборде — это отдельное поле auth.users.phone.
  if (e164) {
    try {
      const res = await fetch(authUrl(`/admin/users/${id}`), {
        method : 'PUT',
        headers,
        body   : JSON.stringify({ phone: e164, phone_confirm: true }),
      });
      if (!res.ok) {
        // Обычная причина — этот номер уже привязан к другому аккаунту.
        console.warn(`[AuthIdentity] телефон не записан (${res.status}):`, (await res.text().catch(() => '')).slice(0, 200));
      }
    } catch (e) {
      console.warn('[AuthIdentity] ошибка записи телефона:', e);
    }
  }
}

/** Собрать «Имя Фамилия» из полей профиля CARGO/AVIA. */
export function buildDisplayName(u: { firstName?: string; lastName?: string; middleName?: string; fullName?: string; name?: string }): string {
  const direct = (u.fullName || u.name || '').trim();
  if (direct) return direct;
  return [u.lastName, u.firstName, u.middleName].map(v => (v || '').trim()).filter(Boolean).join(' ');
}
