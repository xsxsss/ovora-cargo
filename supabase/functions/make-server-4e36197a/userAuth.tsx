// userAuth.tsx — сессионный JWT для CARGO-пользователей (email-аккаунты).
//
// Аналог aviaAuth.tsx для AVIA. До этого backend доверял полю callerEmail,
// которое клиент сам передавал в теле запроса — у значения не было связи с
// реально прошедшей аутентификацией, поэтому любой, кто знал чужой email, мог
// пройти проверки владельца (IDOR): править чужие грузы/офферы/отзывы, читать
// чужие чаты. Теперь POST /auth/login-email, /auth/login-phone и /auth/register
// выдают подписанный токен (заголовок X-User-Token, т.к. Authorization занят под
// Supabase anon key), а verifyUserActor() сверяет владельца токена с заявленным
// в запросе callerEmail.
//
// 🔒 Требует секрет USER_JWT_SECRET в Supabase Secrets.
//
// Отсутствие секрета БОЛЬШЕ НЕ означает «доверять callerEmail из тела запроса».
// Раньше это был fail-open, и удаление секрета молча возвращало IDOR по всем
// CARGO-эндпоинтам. Теперь без секрета проверка владельца отклоняет запрос, а
// прежнее поведение включается только явным USER_AUTH_LEGACY_OPEN=1 (аварийный
// рычаг на случай, если функция задеплоена раньше, чем добавлен секрет).
import { SignJWT, jwtVerify } from "npm:jose";

const TOKEN_TTL = '30d';

/** Код в теле 401-ответа: клиент по нему понимает, что нужно перелогиниться. */
export const USER_TOKEN_INVALID = 'USER_TOKEN_INVALID';

function getSecret(): Uint8Array | null {
  const raw = (Deno.env.get('USER_JWT_SECRET') || '').trim();
  return raw ? new TextEncoder().encode(raw) : null;
}

/** true, если USER_JWT_SECRET настроен и токен-авторизация активна (не legacy-режим). */
export function userAuthEnabled(): boolean {
  return getSecret() !== null;
}

/** Аварийный рычаг: доверять callerEmail из тела, пока секрет не настроен. */
export function userLegacyOpen(): boolean {
  return (Deno.env.get('USER_AUTH_LEGACY_OPEN') || '').trim() === '1';
}

/**
 * true, если проверки владельца должны применяться. Это ИЛИ настроенный секрет
 * (нормальный режим), ИЛИ отсутствие секрета без явного аварийного рычага —
 * в последнем случае getCallerEmail() вернёт null и владелец не подтвердится
 * ни для кого, что и есть fail-closed.
 */
export function userAuthEnforced(): boolean {
  return userAuthEnabled() || !userLegacyOpen();
}

/** Единый 401-ответ для проваленной проверки владельца сессии. */
export function userUnauthorized(c: any) {
  return c.json({ error: 'Unauthorized', code: USER_TOKEN_INVALID }, 401);
}

function normEmail(email: string): string {
  return (email || '').trim().toLowerCase();
}

/** Выдаёт токен сессии при успешном логине/регистрации. undefined, если секрет не настроен. */
export async function signUserToken(email: string): Promise<string | undefined> {
  const secret = getSecret();
  if (!secret) {
    console.warn('[User Auth] USER_JWT_SECRET not configured — token not issued, legacy callerEmail trust still in effect');
    return undefined;
  }
  return await new SignJWT({ email: normEmail(email) })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(TOKEN_TTL)
    .sign(secret);
}

/** Возвращает подтверждённый токеном email или null (для middleware, устанавливающего verifiedEmail). */
export async function verifiedEmailFromToken(c: any): Promise<string | null> {
  const secret = getSecret();
  if (!secret) return null;

  const token = (c.req.header('X-User-Token') || '').trim();
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, secret);
    return typeof payload.email === 'string' ? payload.email : null;
  } catch (err) {
    console.warn('[User Auth] Invalid/expired user JWT:', err);
    return null;
  }
}

/**
 * Проверяет, что claimedEmail (то, что клиент передал как «это я») действительно
 * принадлежит владельцу токена X-User-Token.
 * Секрет не настроен → отказ, кроме случая USER_AUTH_LEGACY_OPEN=1.
 */
export async function verifyUserActor(c: any, claimedEmail: string): Promise<boolean> {
  const secret = getSecret();
  if (!secret) {
    if (userLegacyOpen()) return true;
    console.error('[User Auth] USER_JWT_SECRET not configured — запрос отклонён (fail-closed)');
    return false;
  }
  if (!claimedEmail) return false;

  const token = (c.req.header('X-User-Token') || '').trim();
  if (!token) return false;

  try {
    const { payload } = await jwtVerify(token, secret);
    return normEmail(payload.email as string) === normEmail(claimedEmail);
  } catch (err) {
    console.warn('[User Auth] Invalid/expired user JWT:', err);
    return false;
  }
}
