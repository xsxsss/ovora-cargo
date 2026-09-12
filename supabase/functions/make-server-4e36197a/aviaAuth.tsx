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
// 🔒 Требует секрет AVIA_JWT_SECRET в Supabase Secrets.
//
// Отсутствие секрета БОЛЬШЕ НЕ означает «пропускать всех». Раньше здесь стоял
// fail-open (`if (!secret) return true`), и удаление секрета — случайное или
// намеренное — молча снимало защиту со всех AVIA-эндпоинтов, не оставляя следа
// ни в одном ответе. Теперь без секрета проверка отклоняет запрос, а прежнее
// поведение включается только явным AVIA_AUTH_LEGACY_OPEN=1 (аварийный рычаг на
// случай, если функция задеплоена раньше, чем добавлен секрет).
import { SignJWT, jwtVerify } from "npm:jose";

const TOKEN_TTL = '30d'; // соответствует SESSION_TTL_MS на фронте (aviaApi.ts)

/** Код в теле 401-ответа: клиент по нему понимает, что нужно перелогиниться,
 *  и отличает это от «неверный PIN» (тот же статус 401, но сессию не трогаем). */
export const AVIA_TOKEN_INVALID = 'AVIA_TOKEN_INVALID';

function getSecret(): Uint8Array | null {
  const raw = (Deno.env.get('AVIA_JWT_SECRET') || '').trim();
  return raw ? new TextEncoder().encode(raw) : null;
}

/** true, если AVIA_JWT_SECRET настроен и токен-авторизация активна (не legacy-режим). */
export function aviaAuthEnabled(): boolean {
  return getSecret() !== null;
}

/** Аварийный рычаг: пропускать запросы без проверки, пока секрет не настроен. */
export function aviaLegacyOpen(): boolean {
  return (Deno.env.get('AVIA_AUTH_LEGACY_OPEN') || '').trim() === '1';
}

/** Выдаёт токен сессии при успешном /avia/login или /avia/register. undefined, если секрет не настроен. */
export async function signAviaToken(phone: string): Promise<string | undefined> {
  const secret = getSecret();
  if (!secret) {
    console.warn('[AVIA Auth] AVIA_JWT_SECRET not configured — token not issued');
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
 *
 * Секрет не настроен → отказ, кроме случая AVIA_AUTH_LEGACY_OPEN=1.
 */
export async function verifyAviaActor(c: any, claimedPhone: string): Promise<boolean> {
  const secret = getSecret();
  if (!secret) {
    if (aviaLegacyOpen()) return true;
    console.error('[AVIA Auth] AVIA_JWT_SECRET not configured — запрос отклонён (fail-closed)');
    return false;
  }
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

/** Единый 401-ответ для проваленной проверки владельца сессии. */
export function aviaUnauthorized(c: any) {
  return c.json({ error: 'Unauthorized', code: AVIA_TOKEN_INVALID }, 401);
}
