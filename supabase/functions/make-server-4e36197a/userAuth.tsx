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
// 🔒 Требует секрет USER_JWT_SECRET в Supabase Secrets. Пока он не настроен,
// verifyUserActor() работает в legacy-режиме (пропускает любой callerEmail без
// проверки) — иначе продакшен сломался бы для всех пользователей до того, как
// секрет будет добавлен и фронт начнёт присылать токен.
import { SignJWT, jwtVerify } from "npm:jose";

const TOKEN_TTL = '30d';

function getSecret(): Uint8Array | null {
  const raw = (Deno.env.get('USER_JWT_SECRET') || '').trim();
  return raw ? new TextEncoder().encode(raw) : null;
}

/** true, если USER_JWT_SECRET настроен и токен-авторизация активна (не legacy-режим). */
export function userAuthEnabled(): boolean {
  return getSecret() !== null;
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
 * Legacy-режим (секрет не настроен) — пропускает без проверки.
 */
export async function verifyUserActor(c: any, claimedEmail: string): Promise<boolean> {
  const secret = getSecret();
  if (!secret) return true;
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
