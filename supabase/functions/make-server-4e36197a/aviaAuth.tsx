// aviaAuth.tsx — сессионный JWT для AVIA-пользователей (не админка, см. adminAuth.tsx).
//
// До этого момента backend доверял полю callerPhone/phone, которое клиент сам
// передавал в теле/query запроса — у этого значения не было никакой связи с
// реально прошедшей PIN-аутентификацией, поэтому любой, кто знал номер телефона
// (не PIN!), мог пройти все IDOR-проверки, подставив чужой номер. Теперь
// POST /avia/login и /avia/register выдают подписанный токен (передаётся
// отдельным заголовком X-Avia-Token, т.к. Authorization зарезервирован под
// Supabase anon key), и verifyAviaActor() сверяет реального владельца токена
// с тем, что клиент заявляет в запросе.
//
// 🔒 Требует секрет AVIA_JWT_SECRET в Supabase Secrets. Пока он не настроен,
// verifyAviaActor() работает в legacy-режиме (пропускает любой claimedPhone
// без проверки) — иначе продакшен сломался бы для всех пользователей до того,
// как секрет будет добавлен.
import { SignJWT, jwtVerify } from "npm:jose";

const TOKEN_TTL = '30d'; // соответствует SESSION_TTL_MS на фронте (aviaApi.ts)

function getSecret(): Uint8Array | null {
  const raw = (Deno.env.get('AVIA_JWT_SECRET') || '').trim();
  return raw ? new TextEncoder().encode(raw) : null;
}

/** Выдаёт токен сессии при успешном /avia/login или /avia/register. undefined, если секрет не настроен. */
export async function signAviaToken(phone: string): Promise<string | undefined> {
  const secret = getSecret();
  if (!secret) {
    console.warn('[AVIA Auth] AVIA_JWT_SECRET not configured — token not issued, legacy callerPhone trust still in effect');
    return undefined;
  }
  return await new SignJWT({ phone })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(TOKEN_TTL)
    .sign(secret);
}

/**
 * Проверяет, что claimedPhone (значение, которое клиент передал как «это я»)
 * действительно принадлежит владельцу токена в заголовке X-Avia-Token.
 * Legacy-режим (секрет не настроен) — пропускает без проверки.
 */
export async function verifyAviaActor(c: any, claimedPhone: string): Promise<boolean> {
  const secret = getSecret();
  if (!secret) return true;
  if (!claimedPhone) return false;

  const token = (c.req.header('X-Avia-Token') || '').trim();
  if (!token) return false;

  try {
    const { payload } = await jwtVerify(token, secret);
    return payload.phone === claimedPhone;
  } catch (err) {
    console.warn('[AVIA Auth] Invalid/expired avia JWT:', err);
    return false;
  }
}
