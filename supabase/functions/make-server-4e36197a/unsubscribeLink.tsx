// Подписанная ссылка отписки от писем. Без подписи кто угодно мог отписать любой адрес,
// подставив его в ссылку. Подпись — HMAC-SHA256 от адреса; синхронно, потому что шаблоны писем
// собираются синхронно. Секрет передаётся параметром — так функции тестируются без Deno.
import { createHmac, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";

function normalize(email: string): string {
  return email.toLowerCase().trim();
}

export function unsubscribeSignature(email: string, secret: string): string {
  return createHmac("sha256", secret).update(`unsubscribe:${normalize(email)}`).digest("base64url");
}

export function isValidUnsubscribeSignature(email: string, sig: string, secret: string): boolean {
  if (!email || !sig || !secret) return false;
  const expected = Buffer.from(unsubscribeSignature(email, secret));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Ссылка ведёт на страницу сайта: Supabase отдаёт HTML функций как text/plain, кнопку там не показать. */
export function unsubscribeUrl(siteUrl: string, email: string, secret: string): string {
  const e = normalize(email);
  return `${siteUrl.replace(/\/$/, '')}/unsubscribe?email=${encodeURIComponent(e)}&sig=${unsubscribeSignature(e, secret)}`;
}
