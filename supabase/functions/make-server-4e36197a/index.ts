import { Hono } from "npm:hono";
import { setupAviaRoutes } from "./aviaRoutes.tsx";
import { signUserToken, verifiedEmailFromToken, userAuthEnabled, revokeUserTokens } from "./userAuth.tsx";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import { createClient } from "npm:@supabase/supabase-js";
import webpush from "npm:web-push";
import { SignJWT } from "npm:jose";
import {
  type AdminRole as AdminRoleType,
  resolveAdminRole,
  requireAdmin,
  requireRole,
  isAdminCaller,
} from "./adminAuth.tsx";
import { rateLimitMiddleware, RL, aviaRL } from "./rateLimit.tsx";
import { requestLimitPolicy, ADMIN_AUTH_FAILURES, type Identity } from "./requestLimits.tsx";
import { verifiedAviaPhone } from "./aviaAuth.tsx";
import { isValidUnsubscribeSignature } from "./unsubscribeLink.tsx";
import { announceIfNew, recordServerError, errorKind } from "./alerts.tsx";
import { isE2eLoginEnabled, isE2eEmail } from "./e2eLogin.tsx";
import { calculateAverageRating, recalculateRating } from "./rating.tsx";
import * as kv from "./kv_store.tsx";
import * as capacity from "./capacity.tsx";
import * as store from "./bookingStore.tsx";
import * as profile from "./profileStore.tsx";
import { DOCUMENT_STATUSES, DOCUMENT_TYPES } from "./profileRows.tsx";
import { usePermCodeUserLookup } from "./permCode.tsx";
import { Blacklist } from "./blacklist.tsx";
import { AuditLog as CargoAuditLog } from "./cargoAudit.tsx";
import { AuditLog as AviaAuditLog } from "./aviaAudit.tsx";
import { syncAuthIdentity, buildDisplayName } from "./authIdentity.tsx";
import { getLoginDevices } from "./deviceInfo.tsx";
import { handleSendOtp, handleVerifyOtp } from "./otp.tsx";
import { handleEmailCheck, handleSetCode, handleVerifyPermCode, handleResetCode, handleAdminListCodes, handleSendEmailCode, handleVerifyEmailCode } from "./permCode.tsx";
import {
  sendEmail, throttleEmail, setUnsubscribed, purgeExpiredThrottleKeys,
  welcomeTemplate, newOfferTemplate,
  offerAcceptedTemplate, offerRejectedTemplate,
  tripCompletedTemplate, newMessageTemplate,
  userStatusTemplate, documentStatusTemplate, adminActionTemplate,
} from "./email.tsx";

const app = new Hono();
app.use('*', logger(console.log));

// ── Оповещения об ошибках в Telegram (alerts.tsx) ────────────────────────────
// Стоит первым: видит итоговый статус любого ответа, в том числе после исключения.
const ALERT_SITE = (Deno.env.get('SUPABASE_URL') || '').includes('mkbcjxnoeevtkzaqcpsh') ? 'боевой' : 'тестовый';
let alertsAnnounced = false;
let alertsChecked = 0;
app.use('*', async (c, next) => {
  await next();
  const token = (Deno.env.get('TELEGRAM_BOT_TOKEN') || '').trim();
  if (!token) return;
  try {
    // Пока чат не найден (владелец ещё не написал боту) — пробуем снова, но не чаще раза в 5 минут.
    if (!alertsAnnounced && Date.now() - alertsChecked > 5 * 60_000) {
      alertsChecked = Date.now();
      alertsAnnounced = (await announceIfNew(kv, fetch, token, ALERT_SITE)) || typeof (await kv.get('ovora:alerts:telegram_chat_id')) === 'number';
    }
    if (c.res.status >= 500) {
      await recordServerError(kv, fetch, token, ALERT_SITE, errorKind(c.req.method, c.req.path, c.res.status));
    }
  } catch (err) {
    console.warn('[alerts] не удалось записать или отправить оповещение:', err);
  }
});

// ── Chat pair-id helper (mirrors src/app/api/chatUtils.ts generatePairChatId) ──
function generateEmailHash(email: string): string {
  const hash = (email || '')
    .split('')
    .reduce((acc, char) => ((acc << 5) - acc + char.charCodeAt(0)) | 0, 0);
  return Math.abs(hash).toString(36).slice(0, 8);
}
function generatePairChatId(emailA: string, emailB: string): string {
  const sorted = [emailA || 'guest', emailB || 'guest'].sort();
  return `pair_${generateEmailHash(sorted[0])}_${generateEmailHash(sorted[1])}`;
}

// ── Учёт мест и отмены — функции в базе (bookingStore.tsx), правила ролей — capacity.tsx ──
const ACCEPT_ERRORS: Record<string, [number, string]> = {
  insufficient: [409, 'INSUFFICIENT_CAPACITY: not enough seats/cargo capacity left on this trip'],
  closed: [409, 'TRIP_CLOSED: this trip is cancelled or completed'],
  trip_not_found: [404, 'Trip not found'],
  not_found: [404, 'Offer not found'],
  wrong_status: [409, 'OFFER_CHANGED: the offer was updated by someone else, refresh'],
  cargo_not_found: [404, 'Груз не найден'],
  cargo_taken: [409, 'На этот груз уже принят другой оффер'],
};

async function notifyCancellation(to: string, title: string, description: string): Promise<void> {
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await kv.set(`ovora:notification:${to}:${id}`, {
    id, userEmail: to,
    type: 'trip_cancelled', iconName: 'XCircle', iconBg: 'bg-red-500/10 text-red-500',
    title, description, isUnread: true, createdAt: new Date().toISOString(),
  }).catch(() => {});
}

const LIVE_OFFER_STATUSES = ['pending', 'accepted'];

type CancelledOffer = store.CancelledOffer;

/** Отправители отменённых заявок узнают об отмене поездки. */
async function notifyTripCancelled(cancelled: CancelledOffer[], trip: any, reason?: string, skipEmail?: string): Promise<void> {
  const description = reason || `Водитель отменил поездку ${trip?.from || ''} → ${trip?.to || ''}`;
  for (const offer of cancelled) {
    if (offer.senderEmail && offer.senderEmail !== skipEmail) {
      await notifyCancellation(offer.senderEmail, 'Поездка отменена', description);
    }
  }
}

/** Рейтинг водителя в карточках его поездок (карточка — поле data, места не трогаются). */
async function applyUserRating(driverEmail: string, rating: number): Promise<void> {
  await profile.users.patch(supabase, driverEmail, { rating });
  for (const trip of await store.trips.listByDriver(supabase, driverEmail)) {
    if (trip.deletedAt || trip.driverRating === rating) continue;
    await store.trips.patch(supabase, trip.id, { driverRating: rating });
  }
}

/** Снимает груз с живыми откликами; водителей с принятым откликом уведомляет. */
async function cancelCargoWithOffers(cargoId: string, cargo: any, skipNotify?: string): Promise<number> {
  const cancelled: CancelledOffer[] = (await store.cargos.cancel(supabase, cargoId)) || [];
  for (const co of cancelled) {
    if (co.previous === 'accepted' && co.driverEmail && co.driverEmail !== skipNotify) {
      await notifyCancellation(co.driverEmail, 'Груз снят',
        `Отправитель снял груз ${cargo?.from || ''} → ${cargo?.to || ''}. Перевозка отменена`);
    }
  }
  return cancelled.length;
}

/**
 * Всё, что должно отмениться вместе с пользователем. Идемпотентно: уже отменённое пропускается,
 * поэтому упавший на середине запуск можно повторить. Чаты и отзывы не трогаем — они
 * принадлежат и второй стороне.
 */
async function cascadeDeletedUser(email: string): Promise<Record<string, number>> {
  const counts = { trips: 0, tripOffers: 0, cargos: 0, cargoOffers: 0, notifications: 0, pushSubs: 0, documents: 0 };

  // 1. Поездки водителя — вместе с заявками одной транзакцией
  for (const trip of await store.trips.listByDriver(supabase, email)) {
    if (trip.deletedAt) continue;
    const cancelled: CancelledOffer[] = (await store.trips.cancel(supabase, trip.id, true)) || [];
    counts.trips++;
    counts.tripOffers += cancelled.length;
    await notifyTripCancelled(cancelled, trip,
      `Поездка ${trip.from || ''} → ${trip.to || ''} отменена: водитель больше не работает на платформе`, email);
  }

  // 2. Заявки пользователя на чужие поездки — места возвращаются водителям
  for (const offer of await store.offers.listBySender(supabase, email)) {
    if (!LIVE_OFFER_STATUSES.includes(offer.status)) continue;
    const change = await store.offers.change(supabase, offer.tripId, offer.offerId, 'cancelled', LIVE_OFFER_STATUSES, 'cancelledAt');
    if (change.result !== 'ok') continue;
    counts.tripOffers++;
    if (change.previous === 'accepted' && offer.driverEmail && offer.driverEmail !== email) {
      await notifyCancellation(offer.driverEmail, 'Бронь отменена',
        `Отправитель ${offer.senderName || ''} больше не на платформе. Места освобождены`);
    }
  }

  // 3. Отклики пользователя-водителя на грузы — принятый груз возвращается в поиск
  for (const co of await store.cargoOffers.listByDriver(supabase, email)) {
    if (!LIVE_OFFER_STATUSES.includes(co.status)) continue;
    const change = await store.cargoOffers.change(supabase, co.cargoId, co.offerId, 'cancelled', LIVE_OFFER_STATUSES, 'cancelledAt');
    if (change.result !== 'ok') continue;
    counts.cargoOffers++;
    if (change.previous === 'accepted' && co.senderEmail && co.senderEmail !== email) {
      await notifyCancellation(co.senderEmail, 'Водитель выбыл',
        'Принятый водитель больше не на платформе. Ваш груз снова виден в поиске');
    }
  }

  // 4. Грузы пользователя-отправителя и отклики на них
  for (const cargo of await store.cargos.listBySender(supabase, email)) {
    if (cargo.deletedAt) continue;
    counts.cargos++;
    counts.cargoOffers += await cancelCargoWithOffers(cargo.id, cargo, email);
  }

  // 5. Личные записи: уведомления, push-подписки, документы
  const notifs: any[] = await kv.getByPrefix(`ovora:notification:${email}:`);
  for (const n of notifs) {
    if (n?.id) { await kv.del(`ovora:notification:${email}:${n.id}`).catch(() => {}); counts.notifications++; }
  }
  const pushSubs: any[] = await kv.getByPrefix(`ovora:push:sub:${email}:`);
  for (const sub of pushSubs) {
    if (!sub?.endpoint) continue;
    const subId = btoa(sub.endpoint).replace(/[^a-zA-Z0-9]/g, '').substring(0, 40);
    await kv.del(`ovora:push:sub:${email}:${subId}`).catch(() => {});
    counts.pushSubs++;
  }
  // Записи документов база удаляет вместе с пользователем (cascade); сканы в Storage — здесь.
  const docs = await profile.documents.listByUser(supabase, email);
  const scanPaths = docs.map(d => d.photoPath).filter(Boolean);
  if (scanPaths.length) {
    const { error } = await supabase.storage.from(BUCKET).remove(scanPaths);
    if (error) console.warn('[cascadeDeletedUser] scans not removed:', error.message);
  }
  counts.documents = docs.length;

  return counts;
}

// ── Input sanitization helper ──────────────────────────────────────────────
function clampStr(s: unknown, max: number): string {
  if (typeof s !== 'string') return '';
  return s.trim().slice(0, max);
}
function assertMaxLen(fields: Record<string, unknown>, limits: Record<string, number>): string | null {
  for (const [key, max] of Object.entries(limits)) {
    const val = fields[key];
    if (typeof val === 'string' && val.length > max) {
      return `Field '${key}' exceeds maximum length of ${max} characters`;
    }
  }
  return null;
}
const ALLOWED_ORIGINS = [
  "https://ovora-cargo.ru",
  "http://ovora-cargo.ru",
  "https://www.ovora-cargo.ru",
  "http://www.ovora-cargo.ru",
  // GitHub Pages текущего аккаунта. Прежний домен magamed99.github.io удалён:
  // аккаунт заблокирован GitHub и обслуживать сайт уже не может.
  "https://xsxsss.github.io",
  // Cloudflare Workers — основной сайт.
  "https://ovora-cargo.saburov.workers.dev",
  // local dev
  "http://localhost:5173",
  "http://localhost:4173",
  "http://127.0.0.1:5173",
];
app.use("/*", cors({
  origin: (origin) => {
    // Allow requests with no origin (mobile apps, curl, Postman)
    if (!origin) return origin;
    if (ALLOWED_ORIGINS.includes(origin)) return origin;
    // Allow any subdomain of ovora-cargo.ru (http and https)
    if (/^https?:\/\/([a-z0-9-]+\.)?ovora-cargo\.ru$/.test(origin)) return origin;
    // Тестовые версии веток на Cloudflare: https://<версия>-ovora-cargo.saburov.workers.dev
    if (/^https:\/\/[a-z0-9-]+-ovora-cargo\.saburov\.workers\.dev$/.test(origin)) return origin;
    return null; // deny
  },
  allowHeaders: ["Content-Type", "Authorization", "X-Admin-Code", "X-Admin-Token", "X-Csrf-Token", "X-User-Token", "X-Avia-Token"],
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  exposeHeaders: ["Content-Length"],
  credentials: true,
  maxAge: 600,
}));

// ── CSRF protection (0.6) ──────────────────────────────────────────────────────
// Бэкенд не использует cookie-сессии (вся авторизация — в заголовках), поэтому
// классический double-submit cookie неприменим. Вместо этого требуем кастомный
// заголовок на всех мутирующих запросах: значение не секрет, его роль — форсировать
// CORS preflight, который CORS allowlist уже отклоняет для чужих origin. Без
// preflight браузер не отправит сам запрос, а без этой проверки сервер отклонит
// его явно (защита от form-based / no-cors запросов, которые preflight не требуют).
const CSRF_HEADER_NAME = "x-csrf-token";
const CSRF_EXPECTED = "ovora-pwa-v1";
const CSRF_PROTECTED_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
app.use("/*", async (c, next) => {
  if (!CSRF_PROTECTED_METHODS.has(c.req.method)) return await next();
  if (c.req.header(CSRF_HEADER_NAME) !== CSRF_EXPECTED) {
    return c.json({ error: "Missing or invalid CSRF token" }, 403);
  }
  return await next();
});

// ── User-auth: проставляем verifiedEmail из X-User-Token ──────────────────────
// Если USER_JWT_SECRET настроен и токен валиден — кладём подтверждённый email в
// контекст, откуда его читает getCallerEmail(). Без секрета — no-op (legacy).
app.use("/*", async (c, next) => {
  const email = await verifiedEmailFromToken(c);
  if (email) c.set("verifiedEmail", email);
  return await next();
});

// ── Общий лимит частоты на все адреса ────────────────────────────────────────
// Вошедшие считаются по аккаунту (токен проверен, подделать нельзя), остальные по IP.
// Лимит в памяти экземпляра функции: при нескольких экземплярах он приблизительный,
// но спам и перебор с одного источника отсекает.
app.use("/*", async (c, next) => {
  const email = c.get("verifiedEmail") as string | undefined;
  const phone = email ? null : await verifiedAviaPhone(c);
  const identity: Identity = email ? { kind: 'user', id: email }
    : phone ? { kind: 'avia', id: phone }
    : { kind: 'ip', id: c.req.header('x-forwarded-for') || 'unknown' };
  const policy = requestLimitPolicy(c.req.method, c.req.path, identity);
  if (!policy) return await next();
  const result = aviaRL.check(policy.bucket, policy.max, policy.windowMs);
  if (!result.allowed) {
    console.warn(`[RateLimit] BLOCKED ${policy.bucket} | ${c.req.method} ${c.req.path}`);
    c.header('Retry-After', String(Math.ceil(result.retryAfterMs / 1000)));
    return c.json({ error: 'Слишком много запросов. Подождите и попробуйте снова.', retryAfterMs: result.retryAfterMs }, 429);
  }
  return await next();
});

// ── Admin Middleware — защита всех /admin/* и /kv/* маршрутов ─────────────────
// Логика вынесена в adminAuth.tsx (юнит-тестируется отдельно от Hono/Deno-обвязки).
type AdminRole = AdminRoleType;

// ── JWT revocation (logout-all при компрометации) ───────────────────────────
// KV: ovora:admin:jwt_revoked_at → number (Date.now() в момент revoke-all).
// Любой admin-JWT с iat (сек) раньше этой метки считается отозванным независимо
// от своего TTL (8ч) — даёт мгновенный «разлогинить всех админов» при утечке токена.
// Fail-open при ошибке чтения KV: отзыв — defense-in-depth поверх подписи JWT,
// а не единственная защита, поэтому сбой хранилища не должен блокировать всех админов.
async function isAdminJwtRevoked(issuedAtSec: number): Promise<boolean> {
  try {
    const revokedAt = await kv.get('ovora:admin:jwt_revoked_at') as number | null;
    if (!revokedAt) return false;
    return issuedAtSec * 1000 < revokedAt;
  } catch (err) {
    console.warn('[AdminAuth] Не удалось проверить отзыв JWT (fail-open):', err);
    return false;
  }
}
// Перебор кода админки: X-Admin-Code принимается на любом адресе /admin/*, поэтому лимит
// самого /admin/auth его не защищает. Неудачные попытки с IP считаются на всех адресах.
async function requireAdminChecked(c: any, next: any) {
  const failKey = `admin-auth-fail:${c.req.header('x-forwarded-for') || 'unknown'}`;
  if (aviaRL.isBlocked(failKey)) {
    console.warn(`[requireAdmin] Too many failed admin attempts: ${failKey}`);
    return c.json({ error: 'Слишком много неудачных попыток. Подождите 15 минут.' }, 429);
  }
  const hadCredentials = !!(c.req.header('X-Admin-Code') || c.req.header('X-Admin-Token'));
  const response = await requireAdmin(c, next, isAdminJwtRevoked);
  if (hadCredentials && !c.get('adminRole')) {
    aviaRL.check(failKey, ADMIN_AUTH_FAILURES.max, ADMIN_AUTH_FAILURES.windowMs);
  }
  return response;
}

// Кто именно выполнил админ-действие — роль из проверенного токена.
// Без неё в журнале стоит просто «admin», и нельзя понять, директор это был
// или сотрудник площадки. Роль ставит requireAdmin (c.set('adminRole', …)).
//
// Побочный эффект: помечаем запрос как «залогирован подробно», чтобы сквозной
// журнал (auditFallback ниже) не продублировал его строкой admin.request.
// Инвариант: adminActor вызывается ТОЛЬКО внутри AuditLog.record(...).
function adminActor(c: any): string {
  c.set('auditLogged', true);
  return `admin:${c.get('adminRole') || 'unknown'}`;
}

// ── Сквозной журнал админки ──────────────────────────────────────────────────
// Подробные записи расставлены вручную и покрывают не все эндпоинты — новый
// раздел админки легко забыть залогировать, и тогда действие исчезает из
// журнала совсем. Этот перехват пишет ЛЮБОЕ изменяющее обращение к админке
// (POST/PUT/PATCH/DELETE), если обработчик не сделал подробную запись сам.
// Ставится ПОСЛЕ проверок доступа, поэтому в журнал попадают только запросы
// с подтверждённой ролью, а не анонимные попытки входа.
// Вход в админку — отдельная запись: сквозной журнал её не видит, потому что
// /admin/auth идёт до проверки прав. Пишем и удачные, и неудачные попытки —
// по ним видно подбор кода. Запись уходит в журнал той площадки, к которой
// относится роль (avia-admin → AVIA, остальные → CARGO).
async function recordAdminLogin(c: any, role: 'super-admin' | 'cargo-admin' | 'avia-admin' | null) {
  const actor   = `admin:${role || 'unknown'}`;
  const details = {
    ok       : !!role,
    ip       : c.req.header('x-forwarded-for') || 'unknown',
    userAgent: (c.req.header('user-agent') || '').slice(0, 200),
  };
  if (role === 'avia-admin') {
    await AviaAuditLog.record({ action: 'admin.login', actorPhone: actor, targetType: 'session', details });
  } else {
    await CargoAuditLog.record({ action: 'admin.login', actorEmail: actor, targetType: 'session', details });
  }
}

function auditFallback(platform: 'cargo' | 'avia') {
  return async (c: any, next: any) => {
    await next();
    try {
      const method = c.req.method;
      if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
      if (c.get('auditLogged')) return;
      const actor = `admin:${c.get('adminRole') || 'unknown'}`;
      const path   = c.req.path.replace('/make-server-4e36197a', '');
      const status = c.res?.status ?? 0;
      const details = { method, status };
      if (platform === 'cargo') {
        await CargoAuditLog.record({ action: 'admin.request', actorEmail: actor, targetId: path, targetType: 'request', details });
      } else {
        await AviaAuditLog.record({ action: 'admin.request', actorPhone: actor, targetId: path, targetType: 'request', details });
      }
    } catch (e) {
      console.warn('[auditFallback] non-fatal:', e);
    }
  };
}

// ── callerEmail: prefer JWT, fallback to body (legacy) ─────────────────────
// Когда USER_JWT_SECRET настроен, доверяем ТОЛЬКО email из проверенного токена
// (его ставит user-auth middleware ниже). Значение callerEmail из тела запроса
// в этом режиме игнорируется — иначе IDOR-проверки можно обойти подстановкой
// чужого email. Пока секрет не задан — legacy-режим (тело), чтобы не сломать
// прод до активации токенов на фронте.
function getCallerEmail(c: any, body?: any): string | null {
  const jwtEmail = c.get("verifiedEmail");
  if (jwtEmail) return jwtEmail;
  if (userAuthEnabled()) return null;
  return body?.callerEmail || null;
}

// Кто делает запрос. Email в теле, адресе или форме — просто текст: подставить можно любой.
// При токен-авторизации верим только подписанному токену; без секрета (legacy) — заявленному.
function actingAs(c: any, claimed: unknown): string {
  return getCallerEmail(c, { callerEmail: claimed == null ? null : String(claimed) }) || '';
}

function isActingAs(c: any, email: unknown): boolean {
  const verified = c.get("verifiedEmail");
  if (verified) return String(verified).toLowerCase().trim() === String(email || '').toLowerCase().trim();
  return !userAuthEnabled();
}

const FORBIDDEN_NOT_YOU = { error: "Forbidden: you can only act on your own account" };

// Применяем middleware ко всем /admin/* и /kv/* маршрутам (КРОМЕ /admin/auth).
// CARGO-эндпоинты доступны cargo-admin и super-admin (см. CLAUDE.md RBAC).
app.use('/make-server-4e36197a/admin/*', async (c, next) => {
  // Пропускаем /admin/auth — он нужен для получения токена
  if (c.req.path === '/make-server-4e36197a/admin/auth') {
    return await next();
  }
  return await requireAdminChecked(c, next);
});
app.use('/make-server-4e36197a/admin/*', async (c, next) => {
  if (c.req.path === '/make-server-4e36197a/admin/auth') {
    return await next();
  }
  return await requireRole(['cargo-admin'])(c, next);
});

// ── Общеплатформенные разделы — только главный админ (директор) ──────────────
// Реклама, чёрный список и коды доступа относятся ко всей платформе, а не к
// одной площадке, поэтому сотрудникам CARGO их не открываем: иначе скрытие
// раздела в меню ничего не даёт — API остаётся доступным напрямую.
// /admin/settings сюда НЕ входит: это настройки CARGO (см. Settings.tsx).
const GENERAL_ADMIN_PREFIXES = [
  '/make-server-4e36197a/admin/ads',
  '/make-server-4e36197a/admin/blacklist',
  '/make-server-4e36197a/admin/codes',
];
app.use('/make-server-4e36197a/admin/*', async (c, next) => {
  if (!GENERAL_ADMIN_PREFIXES.some(p => c.req.path.startsWith(p))) {
    return await next();
  }
  return await requireRole(['super-admin'])(c, next);
});

// Вход в админку логируется отдельно (в самом /admin/auth — там известна роль),
// поэтому сквозной журнал его пропускает, чтобы не было двух записей.
app.use('/make-server-4e36197a/admin/*', async (c, next) => {
  if (c.req.path === '/make-server-4e36197a/admin/auth') return await next();
  return await auditFallback('cargo')(c, next);
});

// Защищаем все /kv/* маршруты (они очень опасны — прямой доступ к БД)
app.use('/make-server-4e36197a/kv/*', requireAdminChecked);

// Защищаем все /avia/admin/* маршруты (управление AVIA-пользователями/карточками/аудитом).
// AVIA-эндпоинты доступны avia-admin и super-admin.
app.use('/make-server-4e36197a/avia/admin/*', requireAdminChecked);
app.use('/make-server-4e36197a/avia/admin/*', requireRole(['avia-admin']));
app.use('/make-server-4e36197a/avia/admin/*', auditFallback('avia'));

// ── Supabase client (for storage) ─────────────────────────────────────────────
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

// ── Bucket setup (idempotent) ─────────────────────────────────────────────────
const BUCKET = 'make-4e36197a-documents';
// Разбор документов работает с ФИО, датой рождения и номером паспорта. В логи Supabase это не пишем:
// логи читает любой с доступом к проекту и хранятся они вне наших правил удаления данных.
// Для отладки распознавания — секрет OCR_DEBUG=1 на тестовом проекте.
const ocrDebug: (...args: unknown[]) => void = Deno.env.get('OCR_DEBUG') === '1' ? console.log : () => {};
const AVATAR_BUCKET = 'make-4e36197a-avatars';
const ADS_BUCKET = 'make-4e36197a-ads';
const AVIA_PASSPORT_BUCKET = 'make-4e36197a-avia-passports';
const POD_BUCKET = 'make-4e36197a-pod';
const RADIO_VOICE_BUCKET = 'make-4e36197a-radio-voice';
(async () => {
  const { data: buckets } = await supabase.storage.listBuckets();
  if (!buckets?.some(b => b.name === BUCKET)) {
    await supabase.storage.createBucket(BUCKET);
  }
  if (!buckets?.some(b => b.name === AVATAR_BUCKET)) {
    await supabase.storage.createBucket(AVATAR_BUCKET, { public: true });
  }
  if (!buckets?.some(b => b.name === ADS_BUCKET)) {
    await supabase.storage.createBucket(ADS_BUCKET, { public: true });
    console.log('[Startup] Created ads bucket:', ADS_BUCKET);
  }
  if (!buckets?.some(b => b.name === AVIA_PASSPORT_BUCKET)) {
    await supabase.storage.createBucket(AVIA_PASSPORT_BUCKET);
    console.log('[Startup] Created AVIA passport bucket:', AVIA_PASSPORT_BUCKET);
  }
  if (!buckets?.some(b => b.name === POD_BUCKET)) {
    await supabase.storage.createBucket(POD_BUCKET);
    console.log('[Startup] Created POD (Proof of Delivery) bucket:', POD_BUCKET);
  }
  if (!buckets?.some(b => b.name === RADIO_VOICE_BUCKET)) {
    await supabase.storage.createBucket(RADIO_VOICE_BUCKET, { public: true, fileSizeLimit: 2_000_000 });
    console.log('[Startup] Created radio voice bucket:', RADIO_VOICE_BUCKET);
  }
})();

// ══════════════════════════════════════════════════════════════════════════════
//  WEB PUSH / VAPID — push notifications to browser/phone
//  KV: ovora:vapid:keys               → { publicKey, privateKey }
//  KV: ovora:push:sub:{email}:{subId} → PushSubscription JSON
// ══════════════════════════════════════════════════════════════════════════════

let vapidPublicKey = '';
let vapidReady = false;
let vapidLoading: Promise<boolean> | null = null;

// Ключи грузятся по первому требованию и дожидаются. Раньше загрузка шла по таймеру через 12 с
// после старта: Supabase поднимает новые экземпляры функции каждые 1–2 минуты, и в эти 12 с
// /push/vapid-key отвечал 503, а sendPushToUser молча выбрасывал уведомления.
function ensureVapid(): Promise<boolean> {
  if (vapidReady) return Promise.resolve(true);
  if (!vapidLoading) {
    vapidLoading = (async () => {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          let keys: any = await kv.get('ovora:vapid:keys');
          if (!keys?.publicKey || !keys?.privateKey) {
            keys = webpush.generateVAPIDKeys();
            await kv.set('ovora:vapid:keys', { publicKey: keys.publicKey, privateKey: keys.privateKey });
            console.log('[VAPID] New VAPID keys generated and stored');
          }
          webpush.setVapidDetails('mailto:support@ovora.app', keys.publicKey, keys.privateKey);
          vapidPublicKey = keys.publicKey;
          vapidReady = true;
          return true;
        } catch (err) {
          console.warn(`[VAPID] Init attempt ${attempt}/3 failed:`, err instanceof Error ? err.message : err);
          if (attempt < 3) await new Promise(r => setTimeout(r, 500 * attempt));
        }
      }
      return false;
    })().finally(() => { vapidLoading = null; });
  }
  return vapidLoading;
}

/** Send a Web Push notification to ALL subscribed devices of a user */
async function sendPushToUser(
  email: string,
  payload: { title: string; body: string; url?: string; tag?: string; icon?: string },
): Promise<void> {
  if (!email || !(await ensureVapid())) return;
  try {
    const subs: any[] = await kv.getByPrefix(`ovora:push:sub:${email}:`);
    if (!subs.length) return;

    const payloadStr = JSON.stringify({
      title: payload.title,
      body: payload.body,
      icon: payload.icon || '/icon-192.png',
      badge: '/icon-192.png',
      tag: payload.tag || 'notification',
      url: payload.url || '/notifications',
    });

    for (const sub of subs) {
      if (!sub?.endpoint) continue;
      try {
        await webpush.sendNotification(sub, payloadStr);
        console.log(`[Push] Sent "${payload.title}" to ${email}`);
      } catch (err: any) {
        if (err?.statusCode === 410 || err?.statusCode === 404) {
          // Подписка истекла — удаляем
          const subId = btoa(sub.endpoint).replace(/[^a-zA-Z0-9]/g, '').substring(0, 40);
          await kv.del(`ovora:push:sub:${email}:${subId}`).catch(() => {});
          console.log(`[Push] Removed expired subscription for ${email}`);
        } else {
          console.warn(`[Push] Error sending to ${email}:`, err?.message || err);
        }
      }
    }
  } catch (err) {
    console.warn('[Push] sendPushToUser error:', err);
  }
}

// ── Push Routes ───────────────────────────────────────────────────────────────

/** Отдать публичный VAPID-ключ фронтенду */
app.get("/make-server-4e36197a/push/vapid-key", async (c) => {
  if (!(await ensureVapid())) {
    return c.json({ error: 'VAPID not ready yet, try again' }, 503);
  }
  return c.json({ publicKey: vapidPublicKey });
});

/** Сохранить push-подписку устройства для пользователя */
app.post("/make-server-4e36197a/push/subscribe", async (c) => {
  try {
    const { subscription } = await c.req.json();
    if (!subscription?.endpoint) {
      return c.json({ error: 'subscription.endpoint required' }, 400);
    }
    const email = getCallerEmail(c);
    if (!email) {
      return c.json({ error: 'Authentication required' }, 401);
    }
    const subId = btoa(subscription.endpoint).replace(/[^a-zA-Z0-9]/g, '').substring(0, 40);
    await kv.set(`ovora:push:sub:${email}:${subId}`, { ...subscription, email, savedAt: new Date().toISOString() });
    console.log(`[Push] Subscription saved for ${email}, subId=${subId}`);
    return c.json({ success: true });
  } catch (err) {
    console.log('Error POST /push/subscribe:', err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

/** Удалить push-подписку (при выходе или ручном отключении) */
app.post("/make-server-4e36197a/push/unsubscribe", async (c) => {
  try {
    const { endpoint } = await c.req.json();
    const email = getCallerEmail(c);
    if (!email) return c.json({ error: 'Authentication required' }, 401);
    if (endpoint) {
      const subId = btoa(endpoint).replace(/[^a-zA-Z0-9]/g, '').substring(0, 40);
      await kv.del(`ovora:push:sub:${email}:${subId}`);
    } else {
      // Удалить все подписки пользователя
      const subs: any[] = await kv.getByPrefix(`ovora:push:sub:${email}:`);
      for (const sub of subs) {
        if (!sub?.endpoint) continue;
        const subId = btoa(sub.endpoint).replace(/[^a-zA-Z0-9]/g, '').substring(0, 40);
        await kv.del(`ovora:push:sub:${email}:${subId}`);
      }
    }
    console.log(`[Push] Unsubscribed ${email}`);
    return c.json({ success: true });
  } catch (err) {
    console.log('Error POST /push/unsubscribe:', err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// ── Отписка от email-уведомлений (ссылка из футера писем) ─────────────────────
// Страница отписки живёт на сайте (/unsubscribe): Supabase отдаёт HTML функций как text/plain.
// GET из старых писем перенаправляет туда. Отписка — только POST по кнопке: почтовые сканеры
// сами открывают ссылки из писем и отписали бы человека без его ведома.
app.get("/make-server-4e36197a/email/unsubscribe", (c) => {
  const site = (Deno.env.get("SITE_URL") || "https://ovora-cargo.saburov.workers.dev").replace(/\/$/, "");
  const q = new URLSearchParams({ email: c.req.query("email") || "", sig: c.req.query("sig") || "" });
  return c.redirect(`${site}/unsubscribe?${q}`, 302);
});

app.post("/make-server-4e36197a/email/unsubscribe", async (c) => {
  const body: any = await c.req.json().catch(() => ({}));
  const email = String(body?.email || "").toLowerCase().trim();
  const secret = (Deno.env.get("USER_JWT_SECRET") || "").trim();
  if (!email.includes("@") || !isValidUnsubscribeSignature(email, String(body?.sig || ""), secret)) {
    return c.json({ success: false, error: "INVALID_LINK" }, 400);
  }
  await setUnsubscribed(email, true);
  console.log(`[Email] Unsubscribed via signed link: ${email}`);
  return c.json({ success: true });
});

// ── Вход для сквозных тестов (только тестовая площадка, см. e2eLogin.tsx) ──────
app.post("/make-server-4e36197a/e2e/login", async (c) => {
  if (!isE2eLoginEnabled(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("E2E_LOGIN_ENABLED"))) {
    return c.json({ error: "Not found" }, 404);
  }
  const body: any = await c.req.json().catch(() => ({}));
  const email = String(body?.email || "");
  const role = body?.role === "driver" ? "driver" : "sender";
  if (!isE2eEmail(email)) return c.json({ error: "Only e2e+<name>@ovora.test" }, 400);

  await profile.users.upsert(supabase, email, (existing) =>
    existing || { email, role, firstName: "E2E", lastName: role, phone: "" });
  const token = await signUserToken(email);
  if (!token) return c.json({ error: "USER_JWT_SECRET not configured" }, 500);
  return c.json({ token, email, role });
});

// ── Health ────────────────────────────────────────────────────────────────────
app.get("/make-server-4e36197a/health", (c) => c.json({ status: "ok" }));

// ── Admin Auth — проверка кода из env ─────────────────────────────────────────
app.post("/make-server-4e36197a/admin/auth",
  rateLimitMiddleware(RL.LOGIN, (c) => c.req.header('x-forwarded-for') || 'unknown'),
  async (c) => {
  try {
    const { code } = await c.req.json();
    const superCode = (Deno.env.get('ADMIN_ACCESS_CODE') || '').trim();
    const cargoCode = (Deno.env.get('ADMIN_ACCESS_CODE_CARGO') || '').trim();
    const aviaCode  = (Deno.env.get('ADMIN_ACCESS_CODE_AVIA') || '').trim();
    const jwtSecret = (Deno.env.get('ADMIN_JWT_SECRET') || '').trim();

    if (!superCode) {
      console.log('[AdminAuth] ADMIN_ACCESS_CODE not set in env');
      return c.json({ success: false, error: 'Код доступа не настроен на сервере' }, 500);
    }

    if (!code || typeof code !== 'string') {
      return c.json({ success: false, error: 'Код обязателен' }, 400);
    }

    const trimmed = code.trim();
    let role: 'super-admin' | 'cargo-admin' | 'avia-admin' | null = null;
    if (trimmed === superCode) role = 'super-admin';
    else if (cargoCode && trimmed === cargoCode) role = 'cargo-admin';
    else if (aviaCode && trimmed === aviaCode) role = 'avia-admin';

    if (!role) {
      console.log('[AdminAuth] Wrong admin code attempt');
      await recordAdminLogin(c, null);
      return c.json({ success: false, error: 'Неверный код доступа' });
    }

    // Роли cargo-admin/avia-admin работают ТОЛЬКО через JWT (X-Admin-Token) —
    // у них нет своего legacy X-Admin-Code пути, поэтому без ADMIN_JWT_SECRET
    // их сессия не будет работать ни на одном запросе.
    if (role !== 'super-admin' && !jwtSecret) {
      console.error(`[AdminAuth] Role ${role} requires ADMIN_JWT_SECRET, but it's not configured`);
      return c.json({ success: false, error: 'Эта роль требует настройки ADMIN_JWT_SECRET на сервере' }, 500);
    }

    console.log(`[AdminAuth] Admin access granted, role=${role}, issuing JWT`);

    // Issue a signed JWT (8 h expiry) so the plaintext code never travels in headers again
    let token: string | undefined;
    if (jwtSecret) {
      const secret = new TextEncoder().encode(jwtSecret);
      token = await new SignJWT({ role })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('8h')
        .sign(secret);
    } else {
      console.warn('[AdminAuth] ADMIN_JWT_SECRET not set — token not issued, legacy X-Admin-Code still works (super-admin only)');
    }

    await recordAdminLogin(c, role);
    return c.json({ success: true, token, role });
  } catch (err) {
    console.log('Error POST /admin/auth:', err);
    return c.json({ success: false, error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// ── Admin: отозвать все выданные admin-JWT (logout-all при компрометации) ────
// Под /admin/* — уже защищён глобальным requireAdminChecked; requireRole здесь
// сужает доступ до super-admin (разлогинивает абсолютно всех, включая себя).
app.post("/make-server-4e36197a/admin/auth/revoke-all", requireRole(['super-admin']), async (c) => {
  try {
    await kv.set('ovora:admin:jwt_revoked_at', Date.now());
    console.warn('[AdminAuth] Все admin-JWT отозваны (logout-all) вызывающим super-admin');
    return c.json({ success: true });
  } catch (err) {
    console.log('Error POST /admin/auth/revoke-all:', err);
    return c.json({ success: false, error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// ── Config: Yandex API Key ────────────────────────────────────────────────────
app.get("/make-server-4e36197a/config/yandex-key", requireAdminChecked, (c) => {
  try {
    const apiKey = Deno.env.get('YANDEX_GEOCODER_API_KEY') || '';
    if (!apiKey) {
      console.warn('[Config] YANDEX_GEOCODER_API_KEY not found in environment');
    }
    return c.json({ apiKey });
  } catch (err) {
    console.log("Error /config/yandex-key:", err);
    return c.json({ error: 'Внутренняя ошибка сервера', apiKey: '' }, 500);
  }
});

// ── Config: OCR API Key Status ────────────────────────────────────────────────
app.get("/make-server-4e36197a/config/ocr-status", (c) => {
  try {
    const apiKey = Deno.env.get('OCR_SPACE_API_KEY');
    
    if (!apiKey) {
      return c.json({ 
        status: 'missing',
        message: 'OCR_SPACE_API_KEY не настроен',
        configured: false,
      });
    }

    // Показываем частичный ключ для верификации
    const maskedKey = apiKey.substring(0, 4) + '...' + apiKey.substring(apiKey.length - 6);
    
    return c.json({ 
      status: 'configured',
      message: 'OCR API ключ настроен',
      configured: true,
      keyPreview: maskedKey,
      keyLength: apiKey.length,
    });
  } catch (err) {
    console.log("Error /config/ocr-status:", err);
    return c.json({ error: 'Внутренняя ошибка сервера', configured: false }, 500);
  }
});

// ── Статус почты (Resend) ────────────────────────────────────────────────────
// Без RESEND_API_KEY sendEmail молча пропускает отправку, и письмо с кодом входа
// просто не уйдёт. Эндпоинт показывает только факт наличия ключа и его длину —
// сам ключ не раскрывается.
app.get("/make-server-4e36197a/config/email-status", (c) => {
  try {
    const apiKey = (Deno.env.get('RESEND_API_KEY') || '').trim();
    const from = Deno.env.get('EMAIL_FROM') || 'Ovora Cargo <onboarding@resend.dev>';

    if (!apiKey) {
      return c.json({
        status: 'missing',
        message: 'RESEND_API_KEY не настроен — письма не отправляются',
        configured: false,
        from,
      });
    }

    return c.json({
      status: 'configured',
      message: 'Ключ Resend настроен',
      configured: true,
      keyPreview: apiKey.substring(0, 4) + '...' + apiKey.substring(apiKey.length - 4),
      keyLength: apiKey.length,
      from,
    });
  } catch (err) {
    console.log("Error /config/email-status:", err);
    return c.json({ error: 'Внутренняя ошибка сервера', configured: false }, 500);
  }
});

// ── Direct OCR API Test (admin only) ─────────────────────────────────────────
app.get("/make-server-4e36197a/config/test-ocr-direct", requireAdminChecked, async (c) => {
  const apiKey = Deno.env.get('OCR_SPACE_API_KEY');
  
  console.log('[TEST] Starting direct OCR.space API test...');
  
  if (!apiKey) {
    return c.json({ 
      success: false,
      error: 'OCR_SPACE_API_KEY not found',
      message: 'API ключ не настроен в Environment Variables'
    });
  }

  console.log('[TEST] API Key found:', apiKey.substring(0, 4) + '...' + apiKey.substring(apiKey.length - 4));

  try {
    // Простейшее тестовое изображение (1x1 белый пиксель PNG в base64)
    const testImageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
    
    const formData = new FormData();
    formData.append('base64Image', `data:image/png;base64,${testImageBase64}`);
    formData.append('language', 'eng');
    formData.append('apikey', apiKey);

    console.log('[TEST] Sending test request to OCR.space...');

    const response = await fetch('https://api.ocr.space/parse/image', {
      method: 'POST',
      body: formData,
    });

    console.log('[TEST] Response status:', response.status);

    const data = await response.json();
    console.log('[TEST] Full response:', JSON.stringify(data, null, 2));

    if (!response.ok) {
      return c.json({
        success: false,
        httpStatus: response.status,
        error: 'OCR.space API returned error',
        details: data,
        message: `HTTP ${response.status}: Возможно, API ключ недействителен`
      });
    }

    if (data.IsErroredOnProcessing) {
      return c.json({
        success: false,
        error: 'OCR processing error',
        errorMessage: data.ErrorMessage,
        errorDetails: data.ErrorDetails,
        message: 'OCR.space вернул ошибку обработки'
      });
    }

    return c.json({
      success: true,
      message: 'OCR.space API работает. Ключ валидный.',
      apiResponse: data,
      keyPreview: apiKey.substring(0, 4) + '...' + apiKey.substring(apiKey.length - 4)
    });

  } catch (error) {
    console.error('[TEST] Exception:', error);
    return c.json({
      success: false,
      error: 'Exception during test',
      message: error?.message || String(error),
      stack: error?.stack
    });
  }
});

// ── OCR: Pre-scan document (client-side preview before upload) ────────────────
app.post("/make-server-4e36197a/ocr/scan-document", async (c) => {
  try {
    const body = await c.req.json();
    const { imageBase64, documentType } = body;
    const callerEmail = actingAs(c, body.callerEmail);

    // Require authenticated user — prevents cost hijacking by anonymous callers
    if (!callerEmail) {
      return c.json({ error: 'callerEmail is required' }, 400);
    }
    const callerUser = await profile.users.get(supabase, String(callerEmail).toLowerCase().trim());
    if (!callerUser) {
      return c.json({ error: 'Unauthorized: user not found' }, 401);
    }

    if (!imageBase64) {
      return c.json({ error: 'imageBase64 is required' }, 400);
    }

    console.log('[OCR Prescan] Starting pre-scan for document type:', documentType);

    const result = await extractDocumentData(imageBase64, documentType || 'passport');


    // Convert birthDate from DD.MM.YYYY → YYYY-MM-DD for frontend date input
    let birthDateISO: string | null = null;
    if (result.birthDate) {
      const parts = result.birthDate.split(/[.\/-]/);
      if (parts.length === 3) {
        const [dd, mm, yyyy] = parts;
        if (yyyy && yyyy.length === 4) {
          birthDateISO = `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
        } else {
          birthDateISO = result.birthDate;
        }
      }
    }

    // Всегда success:true если OCR отработал — даже если парсер не нашёл данные,
    // пользователь увидит поля для ручного ввода, а не ошибку
    return c.json({
      success: true,
      fullName: result.fullName || null,
      birthDate: birthDateISO,
      detectedType: result.detectedType || null,
      rawBirthDate: result.birthDate || null,
      documentNumber: result.documentNumber || null,
    });
  } catch (err) {
    console.log('[OCR Prescan] Error:', err);
    return c.json({ error: `OCR pre-scan failed: ${err}`, success: false }, 500);
  }
});

// ═══════════���════════════════════���═════════════════════════════════════════════
//  AUTH ROUTES
//  Таблица users (profileStore.tsx)
// ���═════════════════════════════════════════════════════════════════════════════

app.post("/make-server-4e36197a/auth/register",
  rateLimitMiddleware(RL.REGISTER, (c) => c.req.header('x-forwarded-for') || 'unknown'),
  async (c) => {
  try {
    const body = await c.req.json();
    const { email, firstName, lastName, phone, role, vehicle } = body;
    if (!email || !role) return c.json({ error: "email and role are required" }, 400);
    // Регистрация идёт после подтверждения почты (set-code / verify-perm-code выдают токен).
    // Без проверки любой перезаписывал чужой профиль: роль, имя, телефон.
    if (!isActingAs(c, email)) return c.json(FORBIDDEN_NOT_YOU, 403);
    if (role !== 'driver' && role !== 'sender') return c.json({ error: "role must be driver or sender" }, 400);

    const lenErr = assertMaxLen({ email, firstName, lastName, phone, vehicle },
      { email: 254, firstName: 60, lastName: 60, phone: 20, vehicle: 100 });
    if (lenErr) return c.json({ error: lenErr }, 400);

    // ── Проверка чёрного списка ──────────────────────────────────────────────
    if (phone) {
      const blEntry = await Blacklist.check(phone);
      if (blEntry) {
        return c.json({
          error: "Этот номер телефона заблокирован администратором. Регистрация недоступна.",
          blacklisted: true,
        }, 403);
      }
    }

    const now = new Date().toISOString();
    let isNewUser = false; // первая регистрация
    const user: any = await profile.users.upsert(supabase, email, (current) => {
      const existing: any = current || {};
      isNewUser = !current;
      return {
        ...existing,
        email: clampStr(email, 254).toLowerCase(),
        firstName: clampStr(firstName, 60) || existing.firstName || "",
        lastName: clampStr(lastName, 60) || existing.lastName || "",
        phone: clampStr(phone, 20) || existing.phone || "",
        role,
        vehicle: vehicle ? clampStr(vehicle, 100) : (existing.vehicle || null),
        createdAt: existing.createdAt || now,
        updatedAt: now,
      };
    });

    // ── Приветственное письмо — только для НОВЫХ пользователей ───────────────
    if (isNewUser && user.email && user.firstName) {
      (async () => {
        const throttled = await throttleEmail(user.email, 'welcome', 86_400_000); // 1 раз в сутки
        if (!throttled) {
          const tpl = welcomeTemplate({ firstName: user.firstName, role: user.role, email: user.email });
          await sendEmail({ to: user.email, subject: tpl.subject, html: tpl.html });
        }
      })().catch(e => console.warn('[Email] welcome failed:', e));
    }

    // Досылаем имя и телефон в карточку Supabase Auth — иначе в дашборде
    // Display name и Phone остаются пустыми (в Auth уходил только email).
    syncAuthIdentity(user.email, {
      displayName: buildDisplayName(user),
      phone      : user.phone,
      role       : user.role,
      platform   : 'cargo',
    }).catch(e => console.warn('[AuthIdentity] register sync failed:', e));

    return c.json({ success: true, user });
  } catch (err) {
    console.log("Error /auth/register:", err);
    return c.json({ error: `Register failed: ${err}` }, 500);
  }
});

app.post("/make-server-4e36197a/auth/login-email",
  rateLimitMiddleware(RL.LOGIN, (c) => `login:${c.req.header('x-forwarded-for') || 'unknown'}`),
  async (c) => {
  try {
    const { email } = await c.req.json();
    if (!email) return c.json({ error: "email required" }, 400);
    // Профиль отдаётся только владельцу почты: раньше по любому email отдавались имя, телефон и роль.
    if (!isActingAs(c, email)) return c.json(FORBIDDEN_NOT_YOU, 403);
    const user = await profile.users.get(supabase, email.toLowerCase().trim());
    if (!user) return c.json({ found: false });
    // ── Проверка блокировки ────────────────────────────────────────────────
    if ((user as any)?.status === "blocked") {
      console.log(`[auth/login-email] Blocked user: ${email}`);
      return c.json({ found: false, blocked: true, error: "Ваш аккаунт заблокирован. Обратитесь в поддержку." }, 403);
    }
    const { codeHash: _ch, passportNumber: _pn, passportData: _pd } = user as any;
    const safeUser = { ...(user as any) };
    delete safeUser.codeHash; delete safeUser.passportNumber; delete safeUser.passportData;
    return c.json({ found: true, user: safeUser });
  } catch (err) {
    console.log("Error /auth/login-email:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});


// Fields users must never be allowed to change via self-service update
const USER_PROTECTED_FIELDS = new Set([
  'role', 'status', 'codeHash', 'blocked', 'isVerified',
  'passportNumber', 'passportData', 'email', 'createdAt',
  // Считает сервер: рейтинг — из отзывов, проверка документов — админ. Раньше их можно было прислать самому.
  'rating', 'documentsVerified', 'updatedAt',
]);

app.put("/make-server-4e36197a/auth/user", async (c) => {
  try {
    const body = await c.req.json();
    const { email, ...rawUpdates } = body;
    if (!email) return c.json({ error: "email required" }, 400);
    if (!isActingAs(c, email)) return c.json(FORBIDDEN_NOT_YOU, 403);
    const existing: any = await profile.users.get(supabase, email);
    if (!existing) return c.json({ error: "User not found" }, 404);

    // Strip protected fields — prevents privilege escalation
    const updates: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rawUpdates)) {
      if (!USER_PROTECTED_FIELDS.has(k)) updates[k] = v;
    }

    const updated: any = await profile.users.patch(supabase, email, updates);
    if (!updated) return c.json({ error: "User not found" }, 404);

    // Профиль поменялся — обновляем карточку в Supabase Auth.
    syncAuthIdentity(updated.email, {
      displayName: buildDisplayName(updated),
      phone      : updated.phone,
      role       : updated.role,
      platform   : 'cargo',
    }).catch(e => console.warn('[AuthIdentity] profile sync failed:', e));

    // Return safe user (never expose codeHash or passportNumber)
    const { codeHash: _ch, passportNumber: _pn, passportData: _pd, ...safeUser } = updated;
    return c.json({ success: true, user: safeUser });
  } catch (err) {
    console.log("Error PUT /auth/user:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

app.get("/make-server-4e36197a/auth/user/:email", async (c) => {
  try {
    const email = decodeURIComponent(c.req.param("email"));
    const user: any = await profile.users.get(supabase, email.toLowerCase().trim());
    if (!user) return c.json({ found: false });
    // ✅ FIX N-1 + PII: скрываем чувствительные поля в публичном профиле
    const { phone: _ph, birthDate: _bd, codeHash: _ch, passportNumber: _pn, passportData: _pd, ...safeUser } = user;
    return c.json({ found: true, user: safeUser });
  } catch (err) {
    console.log("Error GET /auth/user:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// ── ROOT-6: «Выйти на всех устройствах» ─────────────────────────────────────
// Отзывает ВСЕ токены пользователя. Не подключать к обычной кнопке «Выйти» —
// она выходит только на текущем устройстве (токен стирается локально).
app.post("/make-server-4e36197a/auth/logout-all", async (c) => {
  try {
    const email = getCallerEmail(c);
    if (!email) return c.json({ error: "Authentication required" }, 401);
    await revokeUserTokens(email);
    console.log(`[Auth] Tokens revoked for ${email} (logout-all)`);
    return c.json({ success: true });
  } catch (err) {
    console.log("Error POST /auth/logout-all:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  TRIPS ROUTES
//  Таблица trips (bookingStore.tsx), JSON API — bookingRows.tsx
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 🗺️ Очистка адреса - оставляет только город/район/область
 * Убирает страны и лишние данные перед сохранением в БД
 */
function cleanAddress(address: string): string {
  if (!address) return address;
  
  // Список стран для исключения
  const countries = ['Таджикистан', 'Россия', 'Узбекистан', 'Казахстан', 'Кыргызстан', 'Туркменистан'];
  
  // Если адрес - это просто страна, возвращаем как есть
  if (countries.includes(address.trim())) {
    return address;
  }
  
  // Разбиваем по запятым
  const parts = address.split(',').map(p => p.trim());
  
  // Фильтруем ст��аны
  const filtered = parts.filter(part => !countries.includes(part));
  
  // Возвращаем первую часть (город/район/область) или оригинальный адрес
  return filtered[0] || address;
}

// ─────────────────────────────────────────────────────────────────────────────
// АВТОУДАЛЕНИЕ АРХИВА ПОЕЗДОК — через 30 дней после завершения поездки
// (даёт водителю/отправителю месяц на обращение в поддержку при споре).
// Отзывы (ovora:review:*) НЕ удаляются — они хранят свою копию данных
// (tripRoute и т.п.) и должны переживать поездку навсегда.
// ─────────────────────────────────────────────────────────────────────────────
const TRIP_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const TRIP_PURGE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
let tripPurgeInFlight = false;

async function purgeExpiredTrips(): Promise<number> {
  const cutoff = Date.now() - TRIP_RETENTION_MS;
  const trips: any[] = await store.trips.listAll(supabase);
  // ✅ Отменённые поездки раньше не попадали в авто-очистку вообще: фильтр учитывал
  // только status==='completed'. После удаления ручной кнопки «Удалить» у водителя
  // (PR #40) это означало бы, что отменённые поездки накапливаются навечно.
  // Водитель отменяет поездку через PUT /trips/:id { status: 'cancelled' } —
  // он не пишет deletedAt, поэтому используем updatedAt как момент отмены
  // (deletedAt остаётся как приоритетное поле для старого DELETE-флоу).
  const expired = trips.filter((t: any) => {
    if (!t) return false;
    if (t.status === 'completed' && t.completedAt) {
      return new Date(t.completedAt).getTime() < cutoff;
    }
    if (t.status === 'cancelled') {
      const cancelledAt = t.deletedAt || t.updatedAt;
      return cancelledAt && new Date(cancelledAt).getTime() < cutoff;
    }
    return false;
  });
  if (expired.length === 0) return 0;

  for (const trip of expired) {
    const tripId = trip.id;
    try {
      // 1. Чаты, привязанные к этой поездке (по chatmeta.tripId)
      const allMeta: any[] = await kv.getByPrefix('ovora:chatmeta:');
      const linkedMeta = allMeta.filter((m: any) => m && String(m.tripId) === String(tripId));
      for (const meta of linkedMeta) {
        if (!meta.chatId) continue;
        const msgs: any[] = await kv.getByPrefix(`ovora:chat:${meta.chatId}:`);
        for (const msg of msgs) {
          if (msg?.msgId) await kv.del(`ovora:chat:${meta.chatId}:${msg.msgId}`).catch(() => {});
        }
        await kv.del(`ovora:chatmeta:${meta.chatId}`).catch(() => {});
      }

      // 2. Данные трекинга/POD-фото
      await kv.del(`ovora:shipment:${tripId}`).catch(() => {});

      // 3. Сама поездка с заявками — последней, чтобы сбой выше не оставил осиротевшую запись
      await store.trips.hardDelete(supabase, tripId);

      console.log(`[purge] Поездка ${tripId} удалена (завершена ${trip.completedAt}), отзывы сохранены`);
    } catch (err) {
      console.log(`[purge] Не удалось удалить поездку ${tripId}:`, err);
    }
  }
  return expired.length;
}

// Throttled fire-and-forget trigger — вызывается из часто запрашиваемых эндпоинтов,
// без cron-инфраструктуры. Не блокирует ответ и не чаще раза в сутки.
function maybeTriggerTripPurge(): void {
  if (tripPurgeInFlight) return;
  tripPurgeInFlight = true;
  (async () => {
    try {
      const last = await kv.get('ovora:meta:lastTripPurge');
      const lastTs = last ? new Date(last).getTime() : 0;
      if (Date.now() - lastTs < TRIP_PURGE_CHECK_INTERVAL_MS) return;
      await kv.set('ovora:meta:lastTripPurge', new Date().toISOString());
      const purged = await purgeExpiredTrips();
      if (purged > 0) console.log(`[purge] Автоудаление: очищено ${purged} поездок старше 30 дней`);

      // ROOT-7: Cleanup expired email throttle keys (runs with same cadence as trip purge)
      const cleaned = await purgeExpiredThrottleKeys();
      if (cleaned > 0) console.log(`[purge] Cleaned ${cleaned} expired throttle keys`);
    } catch (err) {
      console.log('[purge] Ошибка проверки автоудаления:', err);
    } finally {
      tripPurgeInFlight = false;
    }
  })();
}

app.post("/make-server-4e36197a/trips", async (c) => {
  try {
    const body = await c.req.json();

    const lenErr = assertMaxLen(body, { from: 200, to: 200, notes: 1000, vehicle: 100, email: 254 });
    if (lenErr) return c.json({ error: lenErr }, 400);

    // ✅ Рейс без мест И без вместимости для груза одновременно — бессмысленный
    // рейс, который никто не сможет забронировать (SearchResults и так
    // отфильтровывает такие рейсы из выдачи).
    if (!(Number(body.availableSeats) > 0) && !(Number(body.cargoCapacity) > 0)) {
      return c.json({ error: "Trip must have either availableSeats or cargoCapacity greater than 0" }, 400);
    }
    if (!body.driverEmail) return c.json({ error: "driverEmail required" }, 400);
    if (!isActingAs(c, body.driverEmail)) return c.json(FORBIDDEN_NOT_YOU, 403);
    for (const field of ['availableSeats', 'childSeats', 'cargoCapacity', 'pricePerSeat', 'pricePerKg']) {
      if (body[field] != null && body[field] !== '' && !(Number(body[field]) >= 0)) {
        return c.json({ error: `${field} must be a non-negative number` }, 400);
      }
    }

    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    // 🗺️ Очищаем адреса перед сохранением в БД
    const cleanedFrom = cleanAddress(body.from || '');
    const cleanedTo = cleanAddress(body.to || '');
    
    const trip = { 
      ...body, 
      from: cleanedFrom,  // ✅ Сохраняем очищенный адрес
      to: cleanedTo,      // ✅ Сохраняем очищенный адрес
      id, 
      createdAt: now, 
      updatedAt: now, 
      deletedAt: undefined,
      completedAt: undefined,
      // Новая поездка всегда planned (CreateAnnouncementPage.tsx шлёт его же): иначе можно
      // создать сразу «завершённую» или «в пути», минуя переходы статусов PUT /trips.
      status: 'planned',
    };
    
    const saved = await store.trips.insert(supabase, trip);

    if (trip.driverEmail) {
      await CargoAuditLog.record({ action: 'trip.create', actorEmail: trip.driverEmail, targetId: id, targetType: 'trip', details: { from: trip.from, to: trip.to } });
    }

    return c.json({ success: true, trip: saved });
  } catch (err) {
    console.log("Error POST /trips:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

app.get("/make-server-4e36197a/trips", async (c) => {
  try {
    maybeTriggerTripPurge();
    const sorted = (await store.trips.listOpen(supabase))
      .map(trip => ({ ...trip, from: cleanAddress(trip.from || ''), to: cleanAddress(trip.to || '') }));
    return c.json({ trips: sorted });
  } catch (err) {
    console.log("Error GET /trips:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// ── Batch: get trips by IDs (includes completed/cancelled) ──
app.post("/make-server-4e36197a/trips/batch", async (c) => {
  try {
    const { ids } = await c.req.json();
    if (!Array.isArray(ids) || ids.length === 0) {
      return c.json({ trips: [] });
    }
    const results = (await store.trips.getMany(supabase, ids.slice(0, 500).map(String)))
      .filter(trip => !trip.deletedAt && trip.status !== 'deleted')
      .map(trip => ({ ...trip, from: cleanAddress(trip.from || ''), to: cleanAddress(trip.to || '') }));
    return c.json({ trips: results });
  } catch (err) {
    console.log("Error POST /trips/batch:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// ── All trips for a specific user (driver) — includes completed/cancelled ──
app.get("/make-server-4e36197a/trips/my/:email", async (c) => {
  try {
    const email = decodeURIComponent(c.req.param("email"));

    const userTrips = (await store.trips.listByDriver(supabase, email))
      .filter(trip => !trip.deletedAt && trip.status !== 'deleted')
      .map(trip => ({ ...trip, from: cleanAddress(trip.from || ''), to: cleanAddress(trip.to || '') }));
    console.log(`[GET /trips/my] Returning ${userTrips.length} trips for ${email}`);
    return c.json({ trips: userTrips });
  } catch (err) {
    console.log("Error GET /trips/my/:email:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

app.get("/make-server-4e36197a/trips/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const trip: any = await store.trips.get(supabase, id);
    
    if (!trip) {
      return c.json({ found: false });
    }
    
    // 🗺️ Очищаем адреса при загрузке
    const cleanedTrip = {
      ...trip,
      from: cleanAddress(trip.from || ''),
      to: cleanAddress(trip.to || ''),
    };
    
    return c.json({ found: true, trip: cleanedTrip });
  } catch (err) {
    console.log("Error GET /trips/:id:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

app.put("/make-server-4e36197a/trips/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json();
    const existing: any = await store.trips.get(supabase, id);
    if (!existing || existing.deletedAt) return c.json({ error: "Trip not found" }, 404);

    // ✅ FIX C-2: проверка владельца (пропускаем для admin-оверрайда — X-Admin-Code или JWT)
    const isAdmin = await isAdminCaller(c, isAdminJwtRevoked);
    if (!isAdmin) {
      const callerEmail = getCallerEmail(c, body);
      if (!callerEmail) {
        return c.json({ error: 'Authentication required: callerEmail missing' }, 401);
      }
      if (existing.driverEmail && callerEmail !== existing.driverEmail) {
        console.warn(`[PUT /trips/${id}] Forbidden: caller=${callerEmail}, owner=${existing.driverEmail}`);
        return c.json({ error: 'Forbidden: you are not the owner of this trip' }, 403);
      }
    }

    // ✅ FIX LOG-1: белый список обновляемых полей + валидация переходов статуса
    const ALLOWED_UPDATE_FIELDS = [
      'status', 'completedAt', 'prevStatus',
      'from', 'to', 'date',
      // Места здесь не меняются — только функции учёта в базе, иначе можно «добавить» мест поверх броней.
      'pricePerSeat', 'pricePerKg', 'pricePerChild',
      'notes', 'vehicle', 'fromLat', 'fromLng', 'toLat', 'toLng',
    ] as const;

    const ALL_STATUSES = ['planned','active','inProgress','frozen','completed','cancelled'];
    const VALID_STATUS_TRANSITIONS: Record<string, string[]> = {
      planned:    ['inProgress', 'frozen', 'cancelled'],
      active:     ['inProgress', 'frozen', 'cancelled'], // старые поездки: бэкенд ставил active по умолчанию
      inProgress: ['completed', 'frozen', 'cancelled'],
      frozen:     ['planned', 'active', 'inProgress', 'cancelled'],
      completed:  [],
      cancelled:  [],
    };

    // Проверяем запрос на статус
    if (body.status && body.status !== existing.status) {
      if (!ALL_STATUSES.includes(body.status)) {
        return c.json({ error: `Неизвестный статус: ${body.status}` }, 400);
      }
      const allowed = VALID_STATUS_TRANSITIONS[existing.status];
      if (allowed && !allowed.includes(body.status)) {
        return c.json({ error: `Недопустимый переход: ${existing.status} → ${body.status}` }, 400);
      }
      if (!allowed) {
        console.warn(`[PUT /trips] Неизвестный текущий статус ${existing.status} — переход пропущен`);
      }
    }

    // 🗺️ Очищаем адреса если они обновляются
    // ✅ Удаляем callerEmail из данных — служебное поле, не должно храниться в KV
    const { callerEmail: _ignored, ...rawBody } = body as any;
    const cleanedBody: Record<string, unknown> = {};
    for (const key of ALLOWED_UPDATE_FIELDS) {
      if (key in rawBody) cleanedBody[key] = rawBody[key];
    }
    if (cleanedBody.from) {
      cleanedBody.from = cleanAddress(String(cleanedBody.from));
    }
    if (cleanedBody.to) {
      cleanedBody.to = cleanAddress(String(cleanedBody.to));
    }

    console.log(`[PUT /trips/${id}] Updating trip:`, {
      from: { original: body.from, cleaned: cleanedBody.from },
      to: { original: body.to, cleaned: cleanedBody.to },
    });

    // Отмена — одной транзакцией вместе со всеми заявками. Остальные поля меняются без мест.
    const { status: nextStatus, ...fields } = cleanedBody as any;
    let updated: any = existing;
    const patchNow = nextStatus && nextStatus !== 'cancelled' ? cleanedBody : fields;
    if (Object.keys(patchNow).length) {
      updated = await store.trips.patch(supabase, id, patchNow, body.status ? existing.status : undefined);
      if (updated === 'moved') return c.json({ error: "Поездка изменилась, обновите страницу" }, 409);
      if (!updated) return c.json({ error: "Trip not found" }, 404);
    }
    if (nextStatus === 'cancelled' && existing.status !== 'cancelled') {
      const cancelled = await store.trips.cancel(supabase, id, false);
      await notifyTripCancelled(cancelled || [], existing);
      updated = await store.trips.get(supabase, id);
    }

    // ── Email обоим участникам при завершении поездки ─────────────────────────
    if (updated.status === 'completed' && existing.status !== 'completed') {
      ;(async () => {
        try {
          const tripRoute = `${updated.from} → ${updated.to}`;
          const tripDate = updated.date;
          const tripOffers: any[] = await store.offers.listByTrip(supabase, id);
          const acceptedOffers = tripOffers.filter(o => o && o.status === 'accepted' && o.senderEmail);
          for (const offer of acceptedOffers) {
            const [senderUser, driverUser]: [any, any] = await Promise.all([
              profile.users.get(supabase, offer.senderEmail).catch(() => null),
              updated.driverEmail ? profile.users.get(supabase, updated.driverEmail).catch(() => null) : null,
            ]);
            const senderFirstName = senderUser?.firstName || 'Клиент';
            const driverFirstName = driverUser?.firstName || 'Водитель';
            const driverFullName  = driverUser ? `${driverUser.firstName} ${driverUser.lastName}`.trim() : 'Водитель';
            const senderFullName  = senderUser ? `${senderUser.firstName} ${senderUser.lastName}`.trim() : 'Клиент';
            // Email отправителю
            if (offer.senderEmail) {
              const throttled = await throttleEmail(offer.senderEmail, `trip-completed-${id}`, 3_600_000);
              if (!throttled) {
                const tpl = tripCompletedTemplate({ recipientName: senderFirstName, recipientRole: 'sender', partnerName: driverFullName, tripRoute, tripDate, email: offer.senderEmail });
                sendEmail({ to: offer.senderEmail, subject: tpl.subject, html: tpl.html }).catch(() => {});
              }
            }
            // Email водителю (однажды)
            if (updated.driverEmail) {
              const throttled = await throttleEmail(updated.driverEmail, `trip-completed-${id}`, 3_600_000);
              if (!throttled) {
                const tpl = tripCompletedTemplate({ recipientName: driverFirstName, recipientRole: 'driver', partnerName: senderFullName, tripRoute, tripDate, email: updated.driverEmail });
                sendEmail({ to: updated.driverEmail, subject: tpl.subject, html: tpl.html }).catch(() => {});
              }
            }
          }
          console.log(`[Email] trip-completed emails dispatched for trip ${id}`);
        } catch (e) { console.warn('[Email] trip-completed failed:', e); }
      })();
    }

    const editorEmail = (body as any).callerEmail || existing.driverEmail;
    if (editorEmail) {
      await CargoAuditLog.record({ action: 'trip.edit', actorEmail: editorEmail, targetId: id, targetType: 'trip', details: { fields: Object.keys(cleanedBody) } });
    }

    return c.json({ success: true, trip: updated });
  } catch (err) {
    console.log("Error PUT /trips/:id:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

app.delete("/make-server-4e36197a/trips/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const existing: any = await store.trips.get(supabase, id);
    if (!existing) return c.json({ error: "Trip not found" }, 404);

    // ✅ FIX C-2: проверка владельца (пропускаем для admin-оверрайда — X-Admin-Code или JWT)
    const isAdmin = await isAdminCaller(c, isAdminJwtRevoked);
    let callerEmail = '';
    if (!isAdmin) {
      try { callerEmail = (await c.req.json()).callerEmail || ''; } catch { /* тело может отсутствовать */ }
      if (!callerEmail) {
        return c.json({ error: 'callerEmail required' }, 400);
      }
      if (existing.driverEmail && callerEmail !== existing.driverEmail) {
        console.warn(`[DELETE /trips/${id}] Forbidden: caller=${callerEmail}, owner=${existing.driverEmail}`);
        return c.json({ error: 'Forbidden: you are not the owner of this trip' }, 403);
      }
    }

    const cancelled = await store.trips.cancel(supabase, id, true);
    if (cancelled === null) return c.json({ error: "Trip not found" }, 404);
    await notifyTripCancelled(cancelled, existing);

    const deleterEmail = callerEmail || existing.driverEmail;
    if (deleterEmail) {
      await CargoAuditLog.record({ action: 'trip.delete', actorEmail: deleterEmail, targetId: id, targetType: 'trip' });
    }

    return c.json({ success: true });
  } catch (err) {
    console.log("Error DELETE /trips/:id:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  CARGOS ROUTES (Created by Senders)
//  Таблица cargos (bookingStore.tsx)
// ══════════════════════════════════════════════════════════════════════════════

app.post("/make-server-4e36197a/cargos",
  rateLimitMiddleware(RL.GENERAL_WRITE, (c) => `cargo-create:${c.req.header('x-forwarded-for') || 'unknown'}`),
  async (c) => {
  try {
    const body = await c.req.json();

    const lenErr = assertMaxLen(body, { from: 200, to: 200, notes: 1000, senderEmail: 254, senderName: 100, description: 500 });
    if (lenErr) return c.json({ error: lenErr }, 400);
    if (!body.senderEmail) return c.json({ error: "senderEmail required" }, 400);
    if (!isActingAs(c, body.senderEmail)) return c.json(FORBIDDEN_NOT_YOU, 403);

    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    // Очищаем адреса
    const cleanedFrom = cleanAddress(body.from || '');
    const cleanedTo = cleanAddress(body.to || '');
    
    const cargo = { 
      ...body, 
      from: cleanedFrom,
      to: cleanedTo,
      id, 
      createdAt: now, 
      updatedAt: now, 
      deletedAt: undefined,
      // Статусом груза управляет замок отклика (active → matched): создаётся всегда active.
      status: 'active',
    };
    
    const saved = await store.cargos.insert(supabase, cargo);
    await CargoAuditLog.record({ action: 'cargo.create', actorEmail: saved.senderEmail, targetId: id, targetType: 'cargo', details: { from: saved.from, to: saved.to } });
    return c.json({ success: true, cargo: saved });
  } catch (err) {
    console.log("Error POST /cargos:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

app.get("/make-server-4e36197a/cargos", async (c) => {
  try {
    const sorted = (await store.cargos.listOpen(supabase)).filter(cg => cg.status !== 'completed');
    return c.json({ cargos: sorted });
  } catch (err) {
    console.log("Error GET /cargos:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

app.get("/make-server-4e36197a/cargos/my/:email", async (c) => {
  try {
    const email = decodeURIComponent(c.req.param("email"));
    const userCargos = (await store.cargos.listBySender(supabase, email)).filter(cg => !cg.deletedAt && cg.status !== 'deleted');
    return c.json({ cargos: userCargos });
  } catch (err) {
    console.log("Error GET /cargos/my/:email:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

app.get("/make-server-4e36197a/cargos/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const cargo: any = await store.cargos.get(supabase, id);
    if (!cargo) return c.json({ found: false });
    return c.json({ found: true, cargo });
  } catch (err) {
    console.log("Error GET /cargos/:id:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

const CARGO_OWNER_EDITABLE = [
  'from', 'to', 'date', 'fromLat', 'fromLng', 'toLat', 'toLng',
  'cargoWeight', 'budget', 'currency', 'notes', 'senderName', 'senderPhone', 'senderAvatar',
] as const;

app.put("/make-server-4e36197a/cargos/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json();
    const existing: any = await store.cargos.get(supabase, id);
    if (!existing || existing.deletedAt) return c.json({ error: "Cargo not found" }, 404);

    // Ownership check — only the cargo sender may update it
    const callerEmail = getCallerEmail(c, body);
    if (!callerEmail) {
      return c.json({ error: "Authentication required: callerEmail missing" }, 401);
    }
    if (existing.senderEmail && existing.senderEmail !== callerEmail) {
      console.warn(`[PUT /cargos] IDOR attempt: ${callerEmail} tried to update cargo ${id} owned by ${existing.senderEmail}`);
      return c.json({ error: "Forbidden: you are not the owner of this cargo" }, 403);
    }

    // Статус, владелец и даты — только через сервер: статусом управляет замок отклика
    // (active → matched), снятие — DELETE. Иначе вернув «active», можно принять второй отклик.
    const cleanedBody: Record<string, unknown> = {};
    for (const field of CARGO_OWNER_EDITABLE) {
      if (field in body) cleanedBody[field] = body[field];
    }
    if (cleanedBody.from) cleanedBody.from = cleanAddress(String(cleanedBody.from));
    if (cleanedBody.to) cleanedBody.to = cleanAddress(String(cleanedBody.to));

    const saved = await store.cargos.patch(supabase, id, cleanedBody);
    if (!saved || saved === 'moved' || saved.deletedAt) return c.json({ error: "Cargo not found" }, 404);
    await CargoAuditLog.record({ action: 'cargo.edit', actorEmail: callerEmail, targetId: id, targetType: 'cargo', details: { fields: Object.keys(cleanedBody) } });
    return c.json({ success: true, cargo: saved });
  } catch (err) {
    console.log("Error PUT /cargos/:id:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

app.delete("/make-server-4e36197a/cargos/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    const callerEmail = getCallerEmail(c, body);
    const existing: any = await store.cargos.get(supabase, id);
    if (!existing) return c.json({ error: "Cargo not found" }, 404);

    if (!callerEmail) return c.json({ error: "Authentication required: callerEmail missing" }, 401);
    if (existing.senderEmail && existing.senderEmail !== callerEmail) {
      console.warn(`[DELETE /cargos] IDOR attempt: ${callerEmail} tried to delete cargo ${id} owned by ${existing.senderEmail}`);
      return c.json({ error: "Forbidden: you are not the owner of this cargo" }, 403);
    }

    await cancelCargoWithOffers(id, existing);
    await CargoAuditLog.record({ action: 'cargo.delete', actorEmail: callerEmail, targetId: id, targetType: 'cargo' });
    return c.json({ success: true });
  } catch (err) {
    console.log("Error DELETE /cargos/:id:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  OFFERS ROUTES
//  Таблица offers (bookingStore.tsx)
// ══════════════════════════════════════════════════════════════════════════════

app.post("/make-server-4e36197a/offers",
  rateLimitMiddleware(RL.GENERAL_WRITE, (c) => `offer-create:${c.req.header('x-forwarded-for') || 'unknown'}`),
  async (c) => {
  try {
    const body = await c.req.json();
    const { tripId, senderEmail, senderName } = body;

    const lenErr = assertMaxLen(body, { senderEmail: 254, senderName: 100, notes: 1000, driverEmail: 254, driverName: 100 });
    if (lenErr) return c.json({ error: lenErr }, 400);

    // ✅ FIX #7: Валидация обязательных полей
    if (!tripId) return c.json({ error: "tripId required" }, 400);
    if (!senderEmail) return c.json({ error: "senderEmail required" }, 400);
    if (!senderName) return c.json({ error: "senderName required" }, 400);

    // 🔒 Нельзя создать оферту от чужого имени: при активной токен-авторизации
    // senderEmail должен совпадать с владельцем токена. В legacy-режиме — no-op.
    if (userAuthEnabled()) {
      const caller = getCallerEmail(c, body);
      if (!caller || caller.toLowerCase().trim() !== senderEmail.toLowerCase().trim()) {
        return c.json({ error: "Forbidden: senderEmail must match authenticated user" }, 403);
      }
    }

    // Водитель, маршрут и цена берутся из поездки, а не из запроса: иначе можно назначить
    // водителем себя и списывать места с чужой поездки или забронировать по своей цене.
    const trip: any = await store.trips.get(supabase, String(tripId));
    if (!trip || trip.deletedAt) return c.json({ error: "Trip not found" }, 404);
    if (capacity.isTripClosed(trip)) return c.json({ error: "TRIP_CLOSED: this trip is cancelled or completed" }, 409);
    if (!trip.driverEmail) return c.json({ error: "Trip has no driver" }, 409);
    if (trip.driverEmail.toLowerCase().trim() === senderEmail.toLowerCase().trim()) {
      return c.json({ error: "You cannot book your own trip" }, 400);
    }
    const parsedCounts = capacity.parseOfferCounts(body);
    if (!parsedCounts.ok) return c.json({ error: parsedCounts.error }, 400);
    const counts = parsedCounts.counts;

    const offerId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    // LOG-8: цена считается на сервере. Та же формула, что во фронте (capacity.expectedOfferPrice);
    // расхождение больше 1 — ошибка клиента, пропуск цены — тоже.
    const expectedTotal = capacity.expectedOfferPrice(trip, counts);
    const clientPrice = Number(body.price ?? body.totalPrice ?? 0);
    if (!Number.isFinite(clientPrice) || Math.abs(clientPrice - expectedTotal) > 1) {
      console.warn(`[POST /offers] Price mismatch: client=${body.price}, expected=${expectedTotal}`);
      return c.json({ error: `Price mismatch: expected ${expectedTotal}, got ${body.price}` }, 400);
    }

    // Whitelist allowed fields instead of spreading entire body (LOG-8 broader fix)
    const offer = {
      offerId, tripId, createdAt: now, updatedAt: now, status: 'pending',
      senderEmail: body.senderEmail, senderName: body.senderName, senderPhone: body.senderPhone,
      driverEmail: trip.driverEmail, driverName: trip.driverName || body.driverName,
      type: body.type, ...counts,
      price: expectedTotal, totalPrice: expectedTotal, currency: trip.currency || body.currency || 'TJS',
      weight: body.weight, volume: body.volume,
      notes: body.notes, from: trip.from, to: trip.to, date: trip.date,
      vehicleType: trip.vehicle || body.vehicleType, cargoType: body.cargoType,
    };
    // Дубль ожидающей заявки отсекает уникальный индекс в базе — два запроса подряд не пройдут оба.
    const inserted = await store.offers.insert(supabase, offer);
    if (inserted.duplicate) {
      const duplicate = (await store.offers.listByTrip(supabase, String(tripId)))
        .find(o => o.senderEmail === String(senderEmail).toLowerCase().trim() && o.status === 'pending');
      return c.json({ error: "DUPLICATE_OFFER: you already have a pending offer for this trip", offer: duplicate }, 409);
    }

    // ✅ Создать уведомление водителю о новой оферте
    try {
      if (offer.driverEmail && offer.senderName) {
        const tripRoute = trip ? `${trip.from} → ${trip.to}` : 'вашу поездку';
        const notificationId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        await kv.set(`ovora:notification:${offer.driverEmail}:${notificationId}`, {
          id: notificationId,
          userEmail: offer.driverEmail,
          type: 'offer',
          iconName: 'Package',
          iconBg: 'bg-blue-500/10 text-blue-500',
          title: 'Новая оферта на перевозку',
          description: `${offer.senderName} отправил оферту на маршрут ${tripRoute}`,
          isUnread: true,
          createdAt: now,
        });
        console.log(`[offers] Notification created for driver ${offer.driverEmail}`);
        sendPushToUser(offer.driverEmail, {
          title: 'Новая оферта на перевозку',
          body: `${offer.senderName} отправил оферту на маршрут ${tripRoute}`,
          url: '/trips',
          tag: 'offer-new',
        }).catch(() => {});

        // ── Email водителю о новой оферте ────────────────────────────────────
        const driverUser: any = await profile.users.get(supabase, offer.driverEmail).catch(() => null);
        const driverFirstName = driverUser?.firstName || 'Водитель';
        ;(async () => {
          const throttled = await throttleEmail(offer.driverEmail, `new-offer-${tripId}`, 1_800_000); // 30 мин
          if (!throttled) {
            const tpl = newOfferTemplate({
              driverName: driverFirstName,
              senderName: offer.senderName,
              tripRoute,
              tripDate: trip?.date,
              cargoWeight: offer.cargoWeight || offer.requestedCargo,
              price: offer.price || offer.totalPrice,
              currency: offer.currency || 'TJS',
              notes: offer.notes,
              email: offer.driverEmail,
            });
            await sendEmail({ to: offer.driverEmail, subject: tpl.subject, html: tpl.html });
          }
        })().catch(e => console.warn('[Email] new-offer failed:', e));
      }
    } catch (notifErr) {
      console.log('[offers] Error creating notification:', notifErr);
    }

    await CargoAuditLog.record({ action: 'offer.create', actorEmail: senderEmail, targetId: `${tripId}:${offerId}`, targetType: 'offer', details: { driverEmail: offer.driverEmail } });

    return c.json({ success: true, offer });
  } catch (err) {
    console.log("Error POST /offers:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

app.get("/make-server-4e36197a/offers/trip/:tripId", async (c) => {
  try {
    const tripId = c.req.param("tripId");
    // Заявки содержат имя, телефон и почту отправителей: все — только водителю этой поездки
    // (и админу), отправителю — только его собственная, постороннему — ничего.
    const trip: any = await store.trips.get(supabase, tripId);
    const isAdmin = await isAdminCaller(c, isAdminJwtRevoked);
    const canSeeAll = isAdmin || (trip?.driverEmail && isActingAs(c, trip.driverEmail));
    const caller = getCallerEmail(c);
    if (!canSeeAll && !caller && userAuthEnabled()) return c.json({ offers: [] });
    const offers: any[] = await store.offers.listByTrip(supabase, tripId);
    const sorted = offers
      .filter(o => o && (canSeeAll || !userAuthEnabled() || String(o.senderEmail || '').toLowerCase() === String(caller).toLowerCase()))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return c.json({ offers: sorted });
  } catch (err) {
    console.log("Error GET /offers/trip/:tripId:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

app.get("/make-server-4e36197a/offers/user/:email", async (c) => {
  try {
    const email = decodeURIComponent(c.req.param("email"));
    if (!isActingAs(c, email)) return c.json(FORBIDDEN_NOT_YOU, 403);

    const userOffers: any[] = await store.offers.listBySender(supabase, email);

    // ✅ FIX #5: Фильтрация статусов — согласованно с GET /offers/driver
    const filtered = userOffers.filter((o: any) =>
      o.status !== 'cancelled' && o.status !== 'declined' && o.status !== 'deleted' && o.status !== 'rejected'
    );
    const sorted = filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return c.json({ offers: sorted });
  } catch (err) {
    console.log("Error GET /offers/user:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// Получить все оферты на рейсы водителя (по driverEmail)
// Выборка по driver_email (индекс в таблице offers).
// Fallback на full-scan если индекс пуст (backward compat + попутно заполняет индекс).
app.get("/make-server-4e36197a/offers/driver/:email", async (c) => {
  try {
    const email = decodeURIComponent(c.req.param("email"));
    if (!isActingAs(c, email)) return c.json(FORBIDDEN_NOT_YOU, 403);

    const driverOffers: any[] = await store.offers.listByDriver(supabase, email);

    // ── Шаг 2: фильтрация активных ──────────────────────────────────────────
    // ✅ FIX #4: GET больше не пишет в KV — чистый read-only запрос
    const activeOffers = driverOffers
      .filter((o: any) =>
        o.status !== 'cancelled' && o.status !== 'declined' && o.status !== 'deleted' && o.status !== 'rejected'
      )
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    console.log(`[GET /offers/driver] ${email}: ${activeOffers.length} active offers`);
    return c.json({ offers: activeOffers });
  } catch (err) {
    console.log("Error GET /offers/driver:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// ✅ FIX #4: Авто-отмена осиротевших offers вынесена в POST (не побочный эффект GET)
app.post("/make-server-4e36197a/offers/cleanup", async (c) => {
  try {
    const { driverEmail } = await c.req.json();
    if (!driverEmail) return c.json({ error: 'driverEmail required' }, 400);
    if (!isActingAs(c, driverEmail)) return c.json(FORBIDDEN_NOT_YOU, 403);

    // Все pending offers водителя
    const offers: any[] = await store.offers.listByDriver(supabase, driverEmail);
    // ✅ FIX: грейс-период — оферта, созданная меньше 2 минут назад, никогда
    // не считается "осиротевшей". Без этого создание чата (initChatRoom —
    // fire-and-forget на клиенте) могло не успеть записаться на сервере к
    // моменту, когда сработает cleanup, и свежая оферта попадала под
    // авто-отмену прямо в момент, когда пользователь её открывает/принимает.
    const GRACE_MS = 2 * 60 * 1000;
    const pendingOffers = offers.filter(o =>
      o && o.status === 'pending' && o.senderEmail &&
      (Date.now() - new Date(o.createdAt || 0).getTime()) > GRACE_MS
    );

    if (pendingOffers.length === 0) return c.json({ cancelled: 0 });

    // Проверяем наличие чатов
    const allChatMeta: any[] = await kv.getByPrefix(`ovora:chatmeta:`);
    const activeChatPairs = new Set<string>();
    for (const meta of allChatMeta) {
      if (!meta?.participants) continue;
      const parts: string[] = meta.participants;
      if (parts.length >= 2) activeChatPairs.add([...parts].sort().join('|'));
    }

    let cancelledCount = 0;
    for (const offer of pendingOffers) {
      const pairKey = [driverEmail, offer.senderEmail].sort().join('|');
      if (!activeChatPairs.has(pairKey)) {
        // Только из pending: водитель мог принять оффер, пока шла проверка.
        const t = await store.offers.change(supabase, offer.tripId, offer.offerId, 'cancelled', ['pending'], 'cancelledAt');
        if (t.result !== 'ok') continue;
        cancelledCount++;
        console.log(`[offers/cleanup] Auto-cancelled orphaned offer ${offer.offerId}`);
      }
    }

    console.log(`[POST /offers/cleanup] ${driverEmail}: cancelled ${cancelledCount} orphaned offers`);
    return c.json({ cancelled: cancelledCount });
  } catch (err) {
    console.log("Error POST /offers/cleanup:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

app.put("/make-server-4e36197a/offers/:tripId/:offerId", async (c) => {
  try {
    const tripId = c.req.param("tripId");
    const offerId = c.req.param("offerId");
    const body = await c.req.json();
    const existing: any = await store.offers.get(supabase, tripId, offerId);
    if (!existing) return c.json({ error: "Offer not found" }, 404);

    // Проверка участника: только senderEmail или driverEmail вправе менять оферту
    const callerEmail = getCallerEmail(c, body);
    if (!callerEmail) {
      return c.json({ error: "Authentication required: callerEmail missing" }, 401);
    }
    const isSender = existing.senderEmail && existing.senderEmail === callerEmail;
    const isDriver = existing.driverEmail && existing.driverEmail === callerEmail;
    if (!isSender && !isDriver) {
      console.warn(`[PUT /offers] Unauthorized update attempt by ${callerEmail} for offer ${offerId}`);
      return c.json({ error: "Forbidden: you are not a participant of this offer" }, 403);
    }

    // Меняется только статус и только по правилам роли (capacity.tsx): отправитель не может
    // сам принять свою заявку, а принятая бронь не меняет количество мест задним числом.
    const target = String(body.status || '');
    if (!target) return c.json({ error: "status required" }, 400);
    if (target === existing.status) return c.json({ success: true, offer: existing });
    const allowed = (isDriver && capacity.canChangeTripOffer('driver', existing.status, target))
      || (isSender && capacity.canChangeTripOffer('sender', existing.status, target));
    if (!allowed) {
      console.warn(`[PUT /offers] Forbidden transition ${existing.status} → ${target} by ${callerEmail} on ${offerId}`);
      return c.json({ error: `Forbidden: cannot change offer from ${existing.status} to ${target}` }, 403);
    }

    // Принятие списывает места, отказ и отмена возвращают — одной транзакцией в базе.
    if (target === 'accepted') {
      const result = await store.offers.accept(supabase, tripId, offerId);
      if (result !== 'ok') {
        const [status, error] = ACCEPT_ERRORS[result] || [409, result];
        return c.json({ error }, status);
      }
    } else {
      const stamp = target === 'cancelled' ? 'cancelledAt' : 'declinedAt';
      const change = await store.offers.change(supabase, tripId, offerId, target, [existing.status], stamp);
      if (change.result !== 'ok') {
        const [status, error] = ACCEPT_ERRORS[change.result] || [409, change.result];
        return c.json({ error }, status);
      }
    }
    const updated: any = await store.offers.get(supabase, tripId, offerId);

    // ✅ Sync chat proposal card when driver accepts/declines from the Trip page
    // (not from the chat itself) — otherwise the proposal bubble stays "На рассмотрении"
    // forever even though the offer was accepted/declined. Mirrors the reverse sync
    // already done in PUT /chat/:chatId/proposal/:proposalId.
    if (
      (updated.status === 'accepted' || updated.status === 'declined' || updated.status === 'rejected') &&
      existing.senderEmail && existing.driverEmail
    ) {
      try {
        const chatId = generatePairChatId(existing.driverEmail, existing.senderEmail);
        const chatMessages: any[] = await kv.getByPrefix(`ovora:chat:${chatId}:`);
        const proposalMsg = chatMessages.find(m =>
          m && m.type === 'proposal' &&
          m.proposal?.status === 'pending' &&
          String(m.proposal?.tripId) === String(tripId) &&
          m.proposal?.senderEmail === existing.senderEmail
        );
        if (proposalMsg) {
          const proposalStatus = updated.status === 'accepted' ? 'accepted' : 'rejected';
          await kv.set(`ovora:chat:${chatId}:${proposalMsg.msgId}`, {
            ...proposalMsg,
            proposal: { ...proposalMsg.proposal, status: proposalStatus },
          });
          const chatMetaKey = `ovora:chatmeta:${chatId}`;
          const chatMeta: any = await kv.get(chatMetaKey) || {};
          await kv.set(chatMetaKey, {
            ...chatMeta,
            proposalStatus,
            lastMessage: proposalStatus === 'accepted' ? 'Оферта принята' : 'Оферта отклонена',
            lastMessageAt: new Date().toISOString(),
          });
          console.log(`[PUT /offers] Synced chat proposal ${proposalMsg.proposal?.id} in chat ${chatId} -> ${proposalStatus}`);
        }
      } catch (syncErr) {
        console.log('[PUT /offers] Error syncing chat proposal status:', syncErr);
      }
    }

    // ✅ FIX #2: Уведомление отправителю при accept/reject
    try {
      const newStatus = updated.status;
      if ((newStatus === 'accepted' || newStatus === 'rejected' || newStatus === 'declined') && existing.senderEmail) {
        const trip: any = await store.trips.get(supabase, tripId);
        const tripRoute = trip ? `${trip.from} → ${trip.to}` : 'поездку';
        const driverName = existing.driverName || trip?.driverName || 'Водитель';
        const isAccepted = newStatus === 'accepted';
        const notifId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        await kv.set(`ovora:notification:${existing.senderEmail}:${notifId}`, {
          id: notifId,
          userEmail: existing.senderEmail,
          type: isAccepted ? 'offer_accepted' : 'offer_rejected',
          iconName: isAccepted ? 'CheckCircle2' : 'XCircle',
          iconBg: isAccepted ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500',
          title: isAccepted ? 'Оферта принята!' : 'Оферта отклонена',
          description: isAccepted
            ? `${driverName} принял вашу оферту на маршрут ${tripRoute}`
            : `${driverName} отклонил вашу оферту на маршрут ${tripRoute}`,
          isUnread: true,
          createdAt: new Date().toISOString(),
        });
        sendPushToUser(existing.senderEmail, {
          title: isAccepted ? 'Оферта принята!' : 'Оферта отклонена',
          body: isAccepted
            ? `${driverName} принял вашу оферту на маршрут ${tripRoute}`
            : `${driverName} отклонил вашу оферту на маршрут ${tripRoute}`,
          url: '/my-trips',
          tag: `offer-${newStatus}`,
        }).catch(() => {});
        console.log(`[PUT /offers] Notification sent to sender ${existing.senderEmail}: ${newStatus}`);

        // ── Email отправителю при принятии / отклонении ───────────────────────
        ;(async () => {
          const throttled = await throttleEmail(existing.senderEmail, `offer-${newStatus}-${offerId}`, 3_600_000);
          if (!throttled) {
            const senderUser: any = await profile.users.get(supabase, existing.senderEmail).catch(() => null);
            const senderFirstName = senderUser?.firstName || 'Клиент';
            const driverUser: any = existing.driverEmail
              ? await profile.users.get(supabase, existing.driverEmail).catch(() => null)
              : null;
            const driverPhone = driverUser?.phone;
            const tpl = isAccepted
              ? offerAcceptedTemplate({
                  senderName: senderFirstName,
                  driverName,
                  driverPhone,
                  tripRoute,
                  tripDate: trip?.date,
                  price: existing.price || existing.totalPrice,
                  currency: existing.currency || 'TJS',
                  email: existing.senderEmail,
                })
              : offerRejectedTemplate({
                  senderName: senderFirstName,
                  driverName,
                  tripRoute,
                  email: existing.senderEmail,
                });
            await sendEmail({ to: existing.senderEmail, subject: tpl.subject, html: tpl.html });
          }
        })().catch(e => console.warn('[Email] offer-status failed:', e));
      }
    } catch (notifErr) {
      console.log('[PUT /offers] Error creating notification for sender:', notifErr);
    }

    console.log(`[PUT /offers] ${offerId} updated by ${callerEmail || 'unknown'}, status=${updated.status}`);
    return c.json({ success: true, offer: updated });
  } catch (err) {
    console.log("Error PUT /offers:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// ══════════════════════��═══════════════════════════════════════════════════════
//  REVIEWS ROUTES
//  KV: ovora:review:{reviewId} → review object
// ══════════════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════════
//  CARGO-OFFERS ROUTES (Driver → Sender's Cargo)
//  Таблица cargo_offers (bookingStore.tsx)
// ══════════════════════════════════════════════════════════════════════════════

app.post("/make-server-4e36197a/cargo-offers", async (c) => {
  try {
    const body = await c.req.json();
    const { cargoId, driverEmail, driverName } = body;
    if (!cargoId) return c.json({ error: "cargoId required" }, 400);
    if (!driverEmail) return c.json({ error: "driverEmail required" }, 400);
    if (!driverName) return c.json({ error: "driverName required" }, 400);
    if (!isActingAs(c, driverEmail)) return c.json(FORBIDDEN_NOT_YOU, 403);

    const cargo: any = await store.cargos.get(supabase, String(cargoId));
    if (!cargo || cargo.deletedAt) return c.json({ error: "Cargo not found" }, 404);
    if (cargo.status !== 'active') return c.json({ error: "На этот груз уже нельзя откликнуться" }, 409);
    if (cargo.senderEmail && String(cargo.senderEmail).toLowerCase().trim() === String(driverEmail).toLowerCase().trim()) {
      return c.json({ error: "Нельзя откликнуться на свой груз" }, 400);
    }

    const offerId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    const { callerEmail: _drop, acceptedAt: _a, cancelledAt: _cn, rejectedAt: _r, ...offerFields } = body;
    const offer = {
      ...offerFields, offerId, cargoId,
      senderEmail: cargo.senderEmail || '', senderName: cargo.senderName || '',
      createdAt: now, updatedAt: now, status: 'pending',
    };
    // Второй ожидающий отклик того же водителя отсекает уникальный индекс в базе.
    const inserted = await store.cargoOffers.insert(supabase, offer);
    if (inserted.duplicate) return c.json({ error: "Вы уже отправили отклик на этот груз" }, 409);
    if (cargo.senderEmail) {
      try {
        const notifId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        await kv.set(`ovora:notification:${cargo.senderEmail}:${notifId}`, {
          id: notifId, userEmail: cargo.senderEmail, type: 'cargo_offer', iconName: 'Truck',
          iconBg: 'bg-blue-500/10 text-blue-500', title: 'Новый отклик на груз',
          description: `${driverName} откликнулся на ваш груз ${cargo.from} → ${cargo.to}`,
          isUnread: true, createdAt: now,
        });
        sendPushToUser(cargo.senderEmail, {
          title: 'Новый отклик на груз',
          body: `${driverName} откликнулся на ваш груз ${cargo.from} → ${cargo.to}`,
          url: '/trips', tag: 'cargo-offer-new',
        }).catch(() => {});
      } catch {}
    }
    console.log(`[POST /cargo-offers] ${offerId} by ${driverEmail} on ${cargoId}`);
    return c.json({ success: true, offer: inserted.offer });
  } catch (err) {
    console.log("Error POST /cargo-offers:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

app.get("/make-server-4e36197a/cargo-offers/cargo/:cargoId", async (c) => {
  try {
    const cargoId = c.req.param("cargoId");
    // Отклики содержат данные водителей: все — отправителю груза и админу, водителю — только свой.
    const cargo: any = await store.cargos.get(supabase, cargoId);
    const isAdmin = await isAdminCaller(c, isAdminJwtRevoked);
    const canSeeAll = isAdmin || (cargo?.senderEmail && isActingAs(c, cargo.senderEmail));
    const caller = String(getCallerEmail(c) || '').toLowerCase();
    if (!canSeeAll && !caller && userAuthEnabled()) return c.json({ offers: [] });
    const offers = (await store.cargoOffers.listByCargo(supabase, cargoId))
      .filter(o => canSeeAll || !userAuthEnabled() || String(o.driverEmail || '').toLowerCase() === caller);
    return c.json({ offers });
  } catch (err) {
    console.log("Error GET /cargo-offers/cargo/:cargoId:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

app.get("/make-server-4e36197a/cargo-offers/driver/:email", async (c) => {
  try {
    const email = decodeURIComponent(c.req.param("email"));
    if (!isActingAs(c, email)) return c.json(FORBIDDEN_NOT_YOU, 403);
    const offers: any[] = await store.cargoOffers.listByDriver(supabase, email);
    return c.json({ offers: offers.filter(o => !['cancelled','declined','deleted'].includes(o.status)).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) });
  } catch (err) {
    console.log("Error GET /cargo-offers/driver/:email:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

app.get("/make-server-4e36197a/cargo-offers/sender/:email", async (c) => {
  try {
    const email = decodeURIComponent(c.req.param("email"));
    if (!isActingAs(c, email)) return c.json(FORBIDDEN_NOT_YOU, 403);
    const offers: any[] = await store.cargoOffers.listBySender(supabase, email);
    return c.json({ offers: offers.filter(o => !['cancelled','deleted'].includes(o.status)).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) });
  } catch (err) {
    console.log("Error GET /cargo-offers/sender/:email:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

app.put("/make-server-4e36197a/cargo-offers/:cargoId/:offerId", async (c) => {
  try {
    const cargoId = c.req.param("cargoId");
    const offerId = c.req.param("offerId");
    const body = await c.req.json();
    const existing: any = await store.cargoOffers.get(supabase, cargoId, offerId);
    if (!existing) return c.json({ error: "Offer not found" }, 404);

    const callerEmail = getCallerEmail(c, body);
    const isDriver = !!callerEmail && existing.driverEmail === callerEmail;
    const isSender = !!callerEmail && existing.senderEmail === callerEmail;
    if (!callerEmail) return c.json({ error: "Authentication required: callerEmail missing" }, 401);
    if (!isDriver && !isSender) {
      console.warn(`[PUT /cargo-offers] IDOR attempt: ${callerEmail} tried to update cargo-offer ${cargoId}/${offerId}`);
      return c.json({ error: "Forbidden: you are not a participant of this offer" }, 403);
    }

    // Только статус и только по правилам роли: водитель не может сам принять свой отклик
    // и тем самым забрать чужой груз.
    const target = String(body.status || '');
    if (!target) return c.json({ error: "status required" }, 400);
    if (target === existing.status) return c.json({ success: true, offer: existing });
    const allowed = (isSender && capacity.canChangeCargoOffer('sender', existing.status, target))
      || (isDriver && capacity.canChangeCargoOffer('driver', existing.status, target));
    if (!allowed) {
      console.warn(`[PUT /cargo-offers] Forbidden transition ${existing.status} → ${target} by ${callerEmail} on ${offerId}`);
      return c.json({ error: `Forbidden: cannot change offer from ${existing.status} to ${target}` }, 403);
    }

    // Принятие забирает груз (active → matched), отмена принятого возвращает его в поиск — в базе.
    if (target === 'accepted') {
      const result = await store.cargoOffers.accept(supabase, cargoId, offerId);
      if (result !== 'ok') {
        const [status, error] = ACCEPT_ERRORS[result] || [409, result];
        return c.json({ error }, status);
      }
    } else {
      const stamp = target === 'cancelled' ? 'cancelledAt' : 'rejectedAt';
      const change = await store.cargoOffers.change(supabase, cargoId, offerId, target, [existing.status], stamp);
      if (change.result !== 'ok') {
        const [status, error] = ACCEPT_ERRORS[change.result] || [409, change.result];
        return c.json({ error }, status);
      }
    }
    const updated: any = await store.cargoOffers.get(supabase, cargoId, offerId);

    // Notify driver on accept/reject
    try {
      if ((updated.status === 'accepted' || updated.status === 'rejected') && existing.driverEmail) {
        const cargo: any = await store.cargos.get(supabase, cargoId);
        const cargoRoute = cargo ? `${cargo.from} → ${cargo.to}` : 'груз';
        const isAccepted = updated.status === 'accepted';
        const notifId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        await kv.set(`ovora:notification:${existing.driverEmail}:${notifId}`, {
          id: notifId, userEmail: existing.driverEmail,
          type: isAccepted ? 'cargo_offer_accepted' : 'cargo_offer_rejected',
          iconName: isAccepted ? 'CheckCircle2' : 'XCircle',
          iconBg: isAccepted ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500',
          title: isAccepted ? 'Отклик принят!' : 'Отклик отклонён',
          description: isAccepted
            ? `Отправитель принял ваш отклик на груз ${cargoRoute}`
            : `Отправитель отклонил ваш отклик на груз ${cargoRoute}`,
          isUnread: true, createdAt: new Date().toISOString(),
        });
        sendPushToUser(existing.driverEmail, {
          title: isAccepted ? 'Отклик принят!' : 'Отклик отклонён',
          body: cargoRoute, url: '/trips', tag: 'cargo-offer-update',
        }).catch(() => {});
      }
    } catch {}

    return c.json({ success: true, offer: updated });
  } catch (err) {
    console.log("Error PUT /cargo-offers/:cargoId/:offerId:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

app.post("/make-server-4e36197a/reviews",
  rateLimitMiddleware(RL.GENERAL_WRITE, (c) => `review-create:${c.req.header('x-forwarded-for') || 'unknown'}`),
  async (c) => {
  try {
    const body = await c.req.json();

    const callerEmail = String(getCallerEmail(c, body) || '').toLowerCase().trim();
    const authorEmail = String(body.authorEmail || '').toLowerCase().trim();
    const targetEmail = String(body.targetEmail || '').toLowerCase().trim();
    const tripId = body.tripId ? String(body.tripId) : '';

    if (!callerEmail) return c.json({ error: 'Authentication required: callerEmail missing' }, 401);
    if (!authorEmail || !targetEmail) return c.json({ error: 'authorEmail and targetEmail are required' }, 400);
    if (callerEmail !== authorEmail) {
      console.warn(`[POST /reviews] IDOR attempt: caller=${callerEmail} tried to post review as ${authorEmail}`);
      return c.json({ error: 'Forbidden: callerEmail must match authorEmail' }, 403);
    }
    if (!tripId) return c.json({ error: 'tripId is required' }, 400);

    // ✅ FIX: запрет отзыва самому себе (тестовые/демо-аккаунты иногда
    // являются одновременно водителем и отправителем на одной поездке)
    if (authorEmail === targetEmail) {
      return c.json({ error: 'Нельзя оставить отзыв самому себе' }, 400);
    }

    // ✅ Проверка, что автор и адресат отзыва реально были участниками
    // ОДНОЙ завершённой поездки — иначе можно было оставить отзыв о
    // несуществующей/чужой поездке (никакой валидации tripId/участников не было).
    const trip: any = await store.trips.get(supabase, String(tripId));
    if (!trip) return c.json({ error: 'Trip not found' }, 404);
    if (trip.status !== 'completed') {
      return c.json({ error: 'Можно оценивать только завершённые поездки' }, 400);
    }
    const tripDriver = String(trip.driverEmail || '').toLowerCase().trim();
    const offers: any[] = await store.offers.listByTrip(supabase, String(tripId));
    let validPair = false;
    if (tripDriver && (tripDriver === authorEmail || tripDriver === targetEmail)) {
      const otherEmail = tripDriver === authorEmail ? targetEmail : authorEmail;
      validPair = offers.some(o => o && o.status === 'accepted' && String(o.senderEmail || '').toLowerCase().trim() === otherEmail);
    } else if (!tripDriver) {
      // ✅ Явный guard для старых рейсов без driverEmail (поле появилось не
      // сразу) — driverEmail у самой оферты мог сохраниться независимо от
      // trip-записи (берётся из контакта чата на момент создания оферты),
      // поэтому сверяем пару прямо по оферте, а не только по trip.driverEmail.
      validPair = offers.some(o => {
        if (!o || o.status !== 'accepted') return false;
        const offerDriver = String(o.driverEmail || '').toLowerCase().trim();
        const offerSender = String(o.senderEmail || '').toLowerCase().trim();
        return (offerDriver === authorEmail && offerSender === targetEmail) ||
               (offerDriver === targetEmail && offerSender === authorEmail);
      });
    }
    if (!validPair) {
      console.warn(`[POST /reviews] Rejected: ${authorEmail} <-> ${targetEmail} have no completed trip ${tripId} together`);
      return c.json({ error: 'Вы можете оценивать только своих попутчиков по завершённым поездкам' }, 403);
    }

    // ✅ FIX #3: Защита от дублирования отзывов (authorEmail + targetEmail + tripId)
    const authorIndex: any[] = await kv.getByPrefix(`ovora:userreviews:author:${authorEmail}:`);
    if (authorIndex.length > 0) {
      const existingKeys = authorIndex.filter(e => e?.reviewId).map(e => `ovora:review:${e.reviewId}`);
      if (existingKeys.length > 0) {
        const existingReviews: any[] = await kv.mget(existingKeys);
        const duplicate = existingReviews.find(r =>
          r && String(r.targetEmail || '').toLowerCase().trim() === targetEmail && String(r.tripId || '') === tripId
        );
        if (duplicate) {
          console.log(`[POST /reviews] Duplicate blocked: author=${authorEmail}, target=${targetEmail}, trip=${tripId}`);
          return c.json({ error: 'Вы уже оставили отзыв на эту поездку', duplicate: true }, 409);
        }
      }
    }

    const { callerEmail: _ignored, ...cleanedBody } = body as any;
    const reviewId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    const review = { ...cleanedBody, authorEmail, targetEmail, tripId, reviewId, createdAt: now };
    await kv.set(`ovora:review:${reviewId}`, review);

    // ✅ Вторичные индексы — быстрый поиск без full-scan
    if (review.targetEmail) {
      await kv.set(`ovora:userreviews:target:${review.targetEmail}:${reviewId}`, { reviewId }).catch(() => {});
    }
    if (review.authorEmail) {
      await kv.set(`ovora:userreviews:author:${review.authorEmail}:${reviewId}`, { reviewId }).catch(() => {});
    }

    // Снепшот рейтинга на карточках поездок водителя — иначе он замораживается
    // на момент создания поездки.
    if (review.targetEmail) {
      await recalculateRating(kv, review.targetEmail, applyUserRating).catch((e: any) =>
        console.log("[POST /reviews] Failed to refresh driverRating snapshot:", e)
      );
    }

    await CargoAuditLog.record({ action: 'review.create', actorEmail: authorEmail, targetId: reviewId, targetType: 'review', details: { targetEmail, tripId } });

    return c.json({ success: true, review });
  } catch (err) {
    console.log("Error POST /reviews:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

app.get("/make-server-4e36197a/reviews/user/:email", async (c) => {
  try {
    const email = decodeURIComponent(c.req.param("email"));

    // ✅ Используем вторичный индекс — без full-scan
    const [targetEntries, authorEntries]: [any[], any[]] = await Promise.all([
      kv.getByPrefix(`ovora:userreviews:target:${email}:`),
      kv.getByPrefix(`ovora:userreviews:author:${email}:`),
    ]);

    const allEntries = [...targetEntries, ...authorEntries];

    if (allEntries.length > 0) {
      const reviewIds = [...new Set(allEntries.filter(e => e?.reviewId).map((e: any) => e.reviewId))];
      const keys = reviewIds.map(id => `ovora:review:${id}`);
      const fetched: any[] = await kv.mget(keys);
      const userReviews = fetched
        .filter(r => r != null)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      console.log(`[GET /reviews/user] ${email}: index hit, ${userReviews.length} reviews`);
      return c.json({ reviews: userReviews });
    }

    // Fallback: full-scan + восстановление индекса
    console.log(`[GET /reviews/user] ${email}: index empty, falling back to full scan`);
    const all: any[] = await kv.getByPrefix(`ovora:review:`);
    const userReviews = all
      .filter(r => r && (r.targetEmail === email || r.authorEmail === email))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    // Восстановление индекса
    for (const r of userReviews) {
      if (!r.reviewId) continue;
      if (r.targetEmail) await kv.set(`ovora:userreviews:target:${r.targetEmail}:${r.reviewId}`, { reviewId: r.reviewId }).catch(() => {});
      if (r.authorEmail) await kv.set(`ovora:userreviews:author:${r.authorEmail}:${r.reviewId}`, { reviewId: r.reviewId }).catch(() => {});
    }
    console.log(`[GET /reviews/user] ${email}: rebuilt index for ${userReviews.length} reviews`);
    return c.json({ reviews: userReviews });
  } catch (err) {
    console.log("Error GET /reviews/user:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

app.get("/make-server-4e36197a/reviews", async (c) => {
  try {
    const minRating = Number(c.req.query("minRating") ?? "");
    const limit = Math.min(Number(c.req.query("limit") ?? "") || Infinity, 200);

    const all: any[] = await kv.getByPrefix(`ovora:review:`);
    let filtered = all.filter(r => r);
    if (Number.isFinite(minRating)) {
      filtered = filtered.filter(r => (r.rating ?? 0) >= minRating);
    }
    const sorted = filtered
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, Number.isFinite(limit) ? limit : undefined);
    return c.json({ reviews: sorted });
  } catch (err) {
    console.log("Error GET /reviews:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

app.delete("/make-server-4e36197a/reviews/:reviewId", async (c) => {
  try {
    const reviewId = c.req.param("reviewId");
    const existing: any = await kv.get(`ovora:review:${reviewId}`);
    if (!existing) return c.json({ error: "Review not found" }, 404);

    // Только автор может удалять свой отзыв — callerEmail обязателен
    const { callerEmail } = await c.req.json().catch(() => ({})) as any;
    if (!callerEmail) {
      return c.json({ error: "callerEmail is required" }, 400);
    }
    if (existing.authorEmail && existing.authorEmail !== callerEmail) {
      console.warn(`[DELETE /reviews] Unauthorized: ${callerEmail} tried to delete review by ${existing.authorEmail}`);
      return c.json({ error: "Forbidden: you are not the author of this review" }, 403);
    }

    await kv.del(`ovora:review:${reviewId}`);
    // Чистим вторичные индексы
    if (existing.targetEmail) await kv.del(`ovora:userreviews:target:${existing.targetEmail}:${reviewId}`).catch(() => {});
    if (existing.authorEmail) await kv.del(`ovora:userreviews:author:${existing.authorEmail}:${reviewId}`).catch(() => {});

    // LOG-14: Recalculate rating after review deletion
    if (existing.targetEmail) {
      await recalculateRating(kv, existing.targetEmail, applyUserRating).catch((e: any) =>
        console.warn('[DELETE /reviews] Failed to recalculate rating:', e)
      );
    }

    console.log(`[DELETE /reviews] Deleted review ${reviewId} by ${callerEmail || 'unknown'}`);
    return c.json({ success: true });
  } catch (err) {
    console.log("Error DELETE /reviews/:reviewId:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// ════════════════════════════���═════════════════════════════════════════════════
//  CHAT ROUTES — полная поддержка text / proposal / system с��общений
//  KV: ovora:chat:{chatId}:{msgId}   → message
//  KV: ovora:chatmeta:{chatId}       → chat metadata (participants, contact info, unread)
// ══════════════════════════════════════════════════════════════════════════════

// Init / upsert chat room
app.post("/make-server-4e36197a/chat/init", async (c) => {
  try {
    const body = await c.req.json();
    const { chatId, participants, tripId, tripRoute, contactInfo, senderInfo, tripData } = body;
    const callerEmail = actingAs(c, body.callerEmail);
    if (!chatId) return c.json({ error: "chatId required" }, 400);
    if (!callerEmail) return c.json({ error: "callerEmail is required" }, 400);
    const metaKey = `ovora:chatmeta:${chatId}`;
    const existing: any = await kv.get(metaKey) || {};

    const existingParticipants: string[] = Array.isArray(existing.participants) ? existing.participants : [];

    let finalParticipants: string[];
    if (existingParticipants.length > 0) {
      // Чат уже существует — состав участников неизменен через этот эндпоинт,
      // звонящий обязан уже быть участником (иначе можно подменить участников
      // чужого чата и обойти IDOR-проверку на GET /chat/:chatId/messages).
      if (!existingParticipants.includes(callerEmail)) {
        console.warn(`[chat/init] Unauthorized: ${callerEmail} is not a participant of existing chat ${chatId}`);
        return c.json({ error: "Forbidden: you are not a participant of this chat" }, 403);
      }
      finalParticipants = existingParticipants;
    } else {
      // Новый чат — звонящий обязан быть среди заявленных участников, и каждый
      // участник обязан быть реальным зарегистрированным пользователем
      // (иначе можно подсунуть произвольный email несуществующего человека).
      const proposed: string[] = Array.isArray(participants) ? participants.filter(Boolean) : [];
      if (!proposed.includes(callerEmail)) {
        return c.json({ error: "callerEmail must be one of participants" }, 400);
      }
      for (const email of proposed) {
        const user = await profile.users.get(supabase, String(email).toLowerCase().trim()).catch(() => null);
        if (!user) {
          console.warn(`[chat/init] Rejected: participant ${email} is not a registered user`);
          return c.json({ error: `Participant ${email} is not a registered user` }, 400);
        }
      }
      finalParticipants = proposed;
    }

    // ✅ FIX: Keep ALL tripIds this pair has discussed (not just the latest one).
    // pair-based chat = one chat per driver↔sender pair, can discuss multiple trips.
    const existingTripIds: string[] = existing.tripIds || (existing.tripId ? [existing.tripId] : []);
    const newTripIds = tripId && !existingTripIds.includes(String(tripId))
      ? [...existingTripIds, String(tripId)]
      : existingTripIds;

    await kv.set(metaKey, {
      ...existing,
      chatId,
      participants: finalParticipants,
      tripId: tripId || existing.tripId,      // keep for backward compat
      tripIds: newTripIds,                    // ✅ array of ALL tripIds discussed
      tripRoute: tripRoute || existing.tripRoute,
      tripData: tripData || existing.tripData,
      contactInfo: { ...(existing.contactInfo || {}), ...(contactInfo || {}) },
      senderInfo: { ...(existing.senderInfo || {}), ...(senderInfo || {}) },
      lastMessage: existing.lastMessage || null,
      lastMessageAt: existing.lastMessageAt || null,
      unreadByEmail: existing.unreadByEmail || {},
      createdAt: existing.createdAt || new Date().toISOString(),
    });
    return c.json({ success: true });
  } catch (err) {
    console.log("Error POST /chat/init:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// Send a message (text | proposal | system)
app.post("/make-server-4e36197a/chat/message", async (c) => {
  try {
    const body = await c.req.json();
    const { chatId, senderId, senderName, senderAvatar, text, type, proposal, from, participants } = body;
    if (!chatId || !senderId) return c.json({ error: "chatId, senderId required" }, 400);

    // 🔒 Нельзя писать от чужого имени: при активной токен-авторизации senderId
    // должен совпадать с владельцем токена. В legacy-режиме — no-op.
    if (userAuthEnabled()) {
      const caller = getCallerEmail(c, body);
      if (!caller || caller.toLowerCase().trim() !== String(senderId).toLowerCase().trim()) {
        return c.json({ error: "Forbidden: senderId must match authenticated user" }, 403);
      }
    }

    // Проверка: senderId должен быть участником чата
    const metaCheck: any = await kv.get(`ovora:chatmeta:${chatId}`);
    if (metaCheck?.participants && Array.isArray(metaCheck.participants) && metaCheck.participants.length > 0) {
      if (!metaCheck.participants.includes(senderId)) {
        console.warn(`[chat/message] Unauthorized: ${senderId} is not a participant of chat ${chatId}`);
        return c.json({ error: "Forbidden: you are not a participant of this chat" }, 403);
      }
    }

    const msgId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    const message = {
      chatId, msgId, senderId, senderName, senderAvatar,
      text: text || null,
      type: type || 'text',
      proposal: proposal || null,
      from: from || 'sender',
      ts: Date.now(),
      createdAt: now,
      read: false,
    };
    await kv.set(`ovora:chat:${chatId}:${msgId}`, message);

    // Update chat metadata: lastMessage + increment unread for OTHER participants
    const metaKey = `ovora:chatmeta:${chatId}`;
    const meta: any = await kv.get(metaKey) || {};
    const allParticipants: string[] = meta.participants || participants || [];
    const unreadByEmail: Record<string, number> = meta.unreadByEmail || {};
    for (const email of allParticipants) {
      if (email !== senderId) {
        unreadByEmail[email] = (unreadByEmail[email] || 0) + 1;
      }
    }
    const preview = type === 'proposal' ? 'Новая оферта на перевозку' : (text || '');
    await kv.set(metaKey, {
      ...meta,
      chatId,
      lastMessage: preview,
      lastMessageAt: now,
      lastSenderId: senderId,
      participants: allParticipants,
      unreadByEmail,
      hasProposal: type === 'proposal' ? true : (meta.hasProposal || false),
      proposalStatus: type === 'proposal' ? 'pending' : (meta.proposalStatus || null),
    });

    // ✅ Создать уведомление о новом сообщении для получателей (только для обычных текстовых сообщений)
    if (type === 'text' && text) {
      try {
        for (const recipientEmail of allParticipants) {
          if (recipientEmail !== senderId) {
            const notificationId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            await kv.set(`ovora:notification:${recipientEmail}:${notificationId}`, {
              id: notificationId,
              userEmail: recipientEmail,
              type: 'message',
              iconName: 'Bell',
              iconBg: 'bg-purple-500/10 text-purple-500',
              title: `Новое сообщение от ${senderName || 'пользователя'}`,
              description: text.substring(0, 100),
              isUnread: true,
              createdAt: now,
            });
            console.log(`[chat] Notification created for recipient ${recipientEmail}`);
            sendPushToUser(recipientEmail, {
              title: `Новое сообщение ��т ${senderName || 'пользователя'}`,
              body: text.substring(0, 100),
              url: `/chat/${chatId}`,
              tag: `chat-${chatId}`,
            }).catch(() => {});

            // ── Email получателю (throttled: 1 раз в 30 мин на чат) ──────────
            ;(async () => {
              const throttled = await throttleEmail(recipientEmail, `msg-${chatId}`, 1_800_000);
              if (!throttled) {
                const recipientUser: any = await profile.users.get(supabase, recipientEmail).catch(() => null);
                const recipientFirstName = recipientUser?.firstName || 'Пользователь';
                const chatMeta: any = await kv.get(`ovora:chatmeta:${chatId}`).catch(() => null);
                const tripRoute = chatMeta?.tripRoute;
                const tpl = newMessageTemplate({
                  recipientName: recipientFirstName,
                  senderName: senderName || 'Пользователь',
                  messagePreview: text.substring(0, 120),
                  tripRoute,
                  email: recipientEmail,
                });
                await sendEmail({ to: recipientEmail, subject: tpl.subject, html: tpl.html });
              }
            })().catch(e => console.warn('[Email] new-message failed:', e));
          }
        }
      } catch (notifErr) {
        console.log('[chat] Error creating notification:', notifErr);
      }
    }

    return c.json({ success: true, message });
  } catch (err) {
    console.log("Error POST /chat/message:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// Get messages for a chat
app.get("/make-server-4e36197a/chat/:chatId/messages", async (c) => {
  try {
    const chatId = c.req.param("chatId");
    const callerEmail = actingAs(c, c.req.query("callerEmail"));
    if (!callerEmail) return c.json({ error: "callerEmail query param required" }, 400);

    // IDOR fix: verify caller is a participant before exposing messages
    const meta: any = await kv.get(`ovora:chatmeta:${chatId}`);
    if (meta?.participants?.length > 0 && !meta.participants.includes(callerEmail)) {
      console.warn(`[GET /chat/messages] IDOR attempt: ${callerEmail} tried to read chat ${chatId}`);
      return c.json({ error: "Forbidden: you are not a participant of this chat" }, 403);
    }

    const messages: any[] = await kv.getByPrefix(`ovora:chat:${chatId}:`);
    const sorted = messages
      .filter(m => m && m.msgId)
      .sort((a, b) => (a.ts || 0) - (b.ts || 0));
    return c.json({ messages: sorted });
  } catch (err) {
    console.log("Error GET /chat/:chatId/messages:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// Mark all messages in a chat as read for a user; reset unread count
app.put("/make-server-4e36197a/chat/:chatId/read", async (c) => {
  try {
    const chatId = c.req.param("chatId");
    const userEmail = actingAs(c, (await c.req.json()).userEmail);
    if (!userEmail) return c.json({ error: "userEmail required" }, 400);

    const metaKey = `ovora:chatmeta:${chatId}`;
    const meta: any = await kv.get(metaKey) || {};

    if (meta?.participants?.length > 0 && !meta.participants.includes(userEmail)) {
      return c.json({ error: "Forbidden: you are not a participant of this chat" }, 403);
    }

    const unreadByEmail = { ...(meta.unreadByEmail || {}), [userEmail]: 0 };
    await kv.set(metaKey, { ...meta, unreadByEmail });
    return c.json({ success: true });
  } catch (err) {
    console.log("Error PUT /chat/:chatId/read:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// Update proposal status in a specific message
const PROPOSAL_STATUSES = ['accepted', 'rejected', 'declined', 'countered'];
app.put("/make-server-4e36197a/chat/:chatId/proposal/:proposalId", async (c) => {
  try {
    const chatId = c.req.param("chatId");
    const proposalId = c.req.param("proposalId");
    const { status, senderId } = await c.req.json();
    if (!status) return c.json({ error: "status required" }, 400);
    if (!senderId) return c.json({ error: "senderId required" }, 400);
    if (!PROPOSAL_STATUSES.includes(status)) return c.json({ error: `Unknown proposal status: ${status}` }, 400);

    // senderId приходит из тела — при токен-авторизации он обязан совпадать с владельцем токена,
    // иначе любой, кто знает email участника, принимает оферты от его имени.
    const actor = getCallerEmail(c, { callerEmail: senderId });
    if (!actor || actor.toLowerCase().trim() !== String(senderId).toLowerCase().trim()) {
      return c.json({ error: "Forbidden: senderId must match authenticated user" }, 403);
    }

    console.log(`[proposal] Updating proposal status:`, {
      chatId,
      proposalId,
      status,
      senderId,
    });

    // Update chat metadata
    const metaKey = `ovora:chatmeta:${chatId}`;
    const meta: any = await kv.get(metaKey) || {};
    if (meta?.participants?.length > 0 && !meta.participants.includes(senderId)) {
      console.warn(`[proposal] IDOR attempt: ${senderId} tried to update proposal in chat ${chatId}`);
      return c.json({ error: "Forbidden: you are not a participant of this chat" }, 403);
    }

    // Find the message containing this proposal
    const messages: any[] = await kv.getByPrefix(`ovora:chat:${chatId}:`);
    const msg = messages.find(m => m && m.proposal?.id === proposalId);
    if (!msg) return c.json({ error: "Proposal message not found" }, 404);

    if (msg.proposal.status === status) return c.json({ success: true });
    if (msg.proposal.status && msg.proposal.status !== 'pending') {
      return c.json({ error: `PROPOSAL_CLOSED: proposal is already ${msg.proposal.status}` }, 409);
    }
    // Принять, отклонить и предложить встречные условия может только водитель поездки,
    // отменить — только автор заявки (ProposalCard.tsx показывает кнопки так же).
    const proposalTripId = msg.proposal?.tripId || meta.tripId;
    const proposalTrip: any = proposalTripId ? await store.trips.get(supabase, String(proposalTripId)) : null;
    const actorIsDriver = proposalTrip?.driverEmail ? proposalTrip.driverEmail === senderId : msg.senderId !== senderId;
    const isProposalAuthor = msg.senderId === senderId || msg.proposal?.senderEmail === senderId;
    if ((status === 'declined') === actorIsDriver || (status === 'declined' && !isProposalAuthor)) {
      console.warn(`[proposal] Role violation: ${senderId} tried ${status} on ${proposalId} (driver=${actorIsDriver})`);
      return c.json({ error: "Forbidden: this action belongs to the other side of the deal" }, 403);
    }

    const updatedMsg = { ...msg, proposal: { ...msg.proposal, status } };
    await kv.set(`ovora:chat:${chatId}:${msg.msgId}`, updatedMsg);
    const preview = status === 'accepted' 
      ? 'Оферта принята' 
      : status === 'declined'
      ? 'Оферта отменена'
      : 'Оферта отклонена';
    await kv.set(metaKey, {
      ...meta,
      proposalStatus: status,
      lastMessage: preview,
      lastMessageAt: new Date().toISOString(),
    });

    // ── When driver ACCEPTS: reduce trip capacity & update offer status in KV ──
    if (status === 'accepted') {
      try {
        // ── Step 1: resolve tripId ──────────────────────────────────────────
        // Priority: tripId embedded in the proposal message > chatmeta tripId
        const tripId: string | undefined = msg.proposal?.tripId || meta.tripId;

        // ── Step 2: resolve sender email ────────────────────────────────────
        // Priority: senderEmail in proposal message > senderId of message > participants
        const participants: string[] = meta.participants || [];
        const senderEmailFromMsg: string | null =
          msg.proposal?.senderEmail || msg.senderId || null;
        const senderEmailFromParticipants: string | null =
          participants.find((p: string) => p !== senderId) || null;
        const senderEmail = senderEmailFromMsg || senderEmailFromParticipants;

        console.log(`[accept] tripId=${tripId}, senderEmail=${senderEmail}, senderId=${senderId}`);

        if (!tripId) {
          console.log(`[accept] No tripId found in proposal or chatmeta — skipping capacity reduction`);
        } else {
          // ── Step 3: find the pending offer (только заявки этой поездки) ─────
          const tripOffers: any[] = await store.offers.listByTrip(supabase, String(tripId));
          const sender = String(senderEmail || '').toLowerCase().trim();

          // Pass 1: strict match — tripId + senderEmail
          let matchingOffer = tripOffers.find((o: any) => o.status === 'pending' && sender && o.senderEmail === sender);

          // Pass 2: fallback — only an offer of someone in this chat: otherwise the driver would accept a stranger's request.
          if (!matchingOffer) {
            const inChat = participants.map((p: string) => String(p).toLowerCase().trim());
            matchingOffer = tripOffers.find((o: any) => o.status === 'pending' && inChat.includes(o.senderEmail));
            if (matchingOffer) {
              console.log(`[accept] Found offer via fallback (tripId only), senderEmail=${matchingOffer.senderEmail}`);
            }
          }

          // Pass 3: no offer found — log warning instead of creating phantom offer from regex (LOG-7/ROOT-8)
          if (!matchingOffer) {
            console.warn(`[accept] No offer found for tripId=${tripId}, senderEmail=${senderEmail} — cannot accept without a real offer record`);
            await kv.set(`ovora:chat:${chatId}:${msg.msgId}`, msg);
            await kv.set(metaKey, meta);
            return c.json({ error: "OFFER_NOT_FOUND: no matching offer exists for this proposal. Sender should resubmit through the trip page." }, 404);
          }

          if (matchingOffer) {
            // Места и статус заявки — одной транзакцией в базе.
            const result = await store.offers.accept(supabase, String(tripId), matchingOffer.offerId);
            if (result !== 'ok') {
              console.warn(`[accept] ${result} on trip ${tripId} — reverting proposal to pending`);
              await kv.set(`ovora:chat:${chatId}:${msg.msgId}`, msg);
              await kv.set(metaKey, meta);
              const [status, error] = ACCEPT_ERRORS[result] || [409, result];
              return c.json({ error }, status);
            }

            // ✅ Создать уведомление отправителю о принятии оферты
            try {
              if (senderEmail) {
                const trip: any = proposalTrip;
                const tripRoute = trip ? `${trip.from} → ${trip.to}` : 'вашу поездку';
                const driverUser: any = await profile.users.get(supabase, senderId);
                const driverName = driverUser ? `${driverUser.firstName} ${driverUser.lastName}` : 'Водитель';
                const notificationId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                await kv.set(`ovora:notification:${senderEmail}:${notificationId}`, {
                  id: notificationId,
                  userEmail: senderEmail,
                  type: 'offer',
                  iconName: 'UserCheck',
                  iconBg: 'bg-emerald-500/10 text-emerald-500',
                  title: 'Оферта принята!',
                  description: `${driverName} принял вашу оферту на маршрут ${tripRoute}`,
                  isUnread: true,
                  createdAt: new Date().toISOString(),
                });
                console.log(`[accept] Notification created for sender ${senderEmail}`);
                sendPushToUser(senderEmail, {
                  title: 'Оферта принята',
                  body: `${driverName} принял вашу оферту на маршрут ${tripRoute}`,
                  url: '/trips',
                  tag: 'offer-accepted',
                }).catch(() => {});
              }
            } catch (notifErr) {
              console.log('[accept] Error creating notification:', notifErr);
            }

            console.log(`[accept] Offer ${matchingOffer.offerId} accepted, capacity reduced on trip ${tripId}`);
          }
        }
      } catch (err) {
        console.log("[accept] Error reducing trip capacity:", err);
        // Non-fatal — proposal status was already updated
      }
    }

    // ── When driver REJECTS/DECLINES: update offer status in KV ──
    if (status === 'rejected' || status === 'declined') {
      try {
        // ── Step 1: resolve tripId ──────────────────────────────────────────
        const tripId: string | undefined = msg.proposal?.tripId || meta.tripId;

        // ── Step 2: resolve sender email ────────────────────────────────────
        const participants: string[] = meta.participants || [];
        const senderEmailFromMsg: string | null =
          msg.proposal?.senderEmail || msg.senderId || null;
        const senderEmailFromParticipants: string | null =
          participants.find((p: string) => p !== senderId) || null;
        const senderEmail = senderEmailFromMsg || senderEmailFromParticipants;

        console.log(`[reject] tripId=${tripId}, senderEmail=${senderEmail}, senderId=${senderId}`);

        if (!tripId) {
          console.log(`[reject] No tripId found in proposal or chatmeta — skipping offer update`);
        } else {
          // ── Step 3: find the pending or accepted offer (только заявки этой поездки) ──
          const tripOffers: any[] = await store.offers.listByTrip(supabase, String(tripId));
          const sender = String(senderEmail || '').toLowerCase().trim();

          // Pass 1: strict match — tripId + senderEmail (pending or accepted)
          let matchingOffer = tripOffers.find((o: any) =>
            (o.status === 'pending' || o.status === 'accepted') && sender && o.senderEmail === sender);

          // Pass 2: fallback — pending only. An accepted offer is someone's confirmed booking:
          // never touch it without an exact sender match.
          if (!matchingOffer) {
            const inChat = participants.map((p: string) => String(p).toLowerCase().trim());
            matchingOffer = tripOffers.find((o: any) => o.status === 'pending' && inChat.includes(o.senderEmail));
            if (matchingOffer) {
              console.log(`[reject] Found offer via fallback (tripId only), senderEmail=${matchingOffer.senderEmail}`);
            }
          }

          if (matchingOffer) {
            // Mark offer as declined (using 'declined' to match TripDetail expectations)
            // Места принятой заявки возвращаются в той же транзакции.
            const declined = await store.offers.change(supabase, String(tripId), matchingOffer.offerId, 'declined',
              ['pending', 'accepted'], 'declinedAt');
            if (declined.result !== 'ok') throw new Error(`offer ${matchingOffer.offerId} changed concurrently: ${declined.result}`);
            console.log(`[reject] Offer ${matchingOffer.offerId} marked as declined`);

            // ✅ Создать уведомление отправителю об отклонении оферты
            try {
              if (senderEmail) {
                const trip: any = proposalTrip;
                const tripRoute = trip ? `${trip.from} → ${trip.to}` : 'вашу поездку';
                const driverUser: any = await profile.users.get(supabase, senderId);
                const driverName = driverUser ? `${driverUser.firstName || ''} ${driverUser.lastName || ''}`.trim() || 'Водитель' : 'Водитель';

                const notif = {
                  id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
                  userEmail: senderEmail,
                  type: 'offer',
                  iconName: 'XCircle',
                  iconBg: 'bg-rose-500/10 text-rose-500',
                  title: 'Оферта отклонена',
                  description: `${driverName} отклонил вашу оферту на поездку ${tripRoute}`,
                  isUnread: true,
                  createdAt: new Date().toISOString(),
                };
                await kv.set(`ovora:notification:${senderEmail}:${notif.id}`, notif);
                console.log(`[reject] Notification created for ${senderEmail}`);
                sendPushToUser(senderEmail, {
                  title: 'Оферта отклонена',
                  body: `${driverName} отклонил вашу оферту на маршрут ${tripRoute}`,
                  url: '/trips',
                  tag: 'offer-declined',
                }).catch(() => {});
              }
            } catch (notifErr) {
              console.log('[reject] Error creating notification:', notifErr);
            }
          } else {
            console.log(`[reject] No pending offer found for tripId=${tripId}, senderEmail=${senderEmail}`);
          }
        }
      } catch (err) {
        console.log("[reject] Error updating offer status:", err);
        // Non-fatal — proposal status was already updated
      }
    }

    // NOTE: duplicate decline block removed — the rejected/declined block above handles both driver-reject and sender-decline

    return c.json({ success: true, message: updatedMsg });
  } catch (err) {
    console.log("Error PUT /chat/proposal:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// Get all chats for a user (enriched list)
app.get("/make-server-4e36197a/chats/user/:email", async (c) => {
  try {
    const email = decodeURIComponent(c.req.param("email"));
    const allMeta: any[] = await kv.getByPrefix(`ovora:chatmeta:`);
    const userChats = allMeta
      .filter(m => m && Array.isArray(m.participants) && m.participants.includes(email))
      .filter(m => !m.chatId?.startsWith('demo_')) // никогда не возвращать демо-чаты
      .map(m => ({
        ...m,
        unread: m.unreadByEmail?.[email] || 0,
      }))
      .sort((a, b) => new Date(b.lastMessageAt || b.createdAt).getTime() - new Date(a.lastMessageAt || a.createdAt).getTime());
    return c.json({ chats: userChats });
  } catch (err) {
    console.log("Error GET /chats/user:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// Одноразовая очистка демо-чатов из KV
app.delete("/make-server-4e36197a/chats/cleanup-demo", requireAdminChecked, async (c) => {
  try {
    const allMeta: any[] = await kv.getByPrefix(`ovora:chatmeta:`);
    const demoMetas = allMeta.filter(m => m?.chatId?.startsWith('demo_'));
    for (const m of demoMetas) {
      // Удаляем метаданные чата
      await kv.del(`ovora:chatmeta:${m.chatId}`);
      // Удаляем все сообщения этого чата
      const msgs: any[] = await kv.getByPrefix(`ovora:chat:${m.chatId}:`);
      for (const msg of msgs) {
        if (msg?.msgId) await kv.del(`ovora:chat:${m.chatId}:${msg.msgId}`);
      }
    }
    console.log(`[cleanup-demo] Удалено демо-чатов: ${demoMetas.length}`);
    return c.json({ deleted: demoMetas.length });
  } catch (err) {
    console.log("Error DELETE /chats/cleanup-demo:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// ── Sync user name across all their chat metadata ────────────────────────────
// Called after profile update or passport OCR verification
app.put("/make-server-4e36197a/users/:email/sync-chats", async (c) => {
  try {
    const email = decodeURIComponent(c.req.param("email"));
    if (!isActingAs(c, email)) return c.json(FORBIDDEN_NOT_YOU, 403);
    const body = await c.req.json();
    const { firstName, lastName, middleName, fullName, avatarUrl } = body;

    if (!email) return c.json({ error: "email required" }, 400);

    const displayName = fullName || [firstName, lastName, middleName].filter(Boolean).join(' ') || '';
    if (!displayName) return c.json({ success: true, updated: 0, message: "No name to sync" });

    console.log(`[sync-chats] Syncing name "${displayName}" for user ${email}`);

    // Get all chats where this user is a participant
    const allMeta: any[] = await kv.getByPrefix(`ovora:chatmeta:`);
    const userChats = allMeta.filter(m => m && Array.isArray(m.participants) && m.participants.includes(email));

    let updatedCount = 0;
    for (const meta of userChats) {
      const chatId = meta.chatId;
      if (!chatId) continue;

      let changed = false;
      const updatedMeta = { ...meta };

      // Update senderInfo (when this user is the sender who initiated the chat)
      if (updatedMeta.senderInfo?.[email]) {
        updatedMeta.senderInfo = {
          ...updatedMeta.senderInfo,
          [email]: {
            ...updatedMeta.senderInfo[email],
            name: displayName,
            ...(avatarUrl ? { avatar: avatarUrl } : {}),
          },
        };
        changed = true;
      }

      // Update contactInfo (when this user appears as a contact for other participants)
      if (updatedMeta.contactInfo) {
        const newContactInfo: Record<string, any> = {};
        for (const [viewerEmail, contactData] of Object.entries(updatedMeta.contactInfo as Record<string, any>)) {
          // contactInfo[viewerEmail] = the contact shown to viewerEmail
          // If the stored contact's email matches our user, update their name
          if (contactData?.email === email) {
            newContactInfo[viewerEmail] = {
              ...contactData,
              name: displayName,
              ...(avatarUrl ? { avatar: avatarUrl } : {}),
            };
            changed = true;
          } else {
            newContactInfo[viewerEmail] = contactData;
          }
        }
        if (changed) updatedMeta.contactInfo = newContactInfo;
      }

      if (changed) {
        await kv.set(`ovora:chatmeta:${chatId}`, updatedMeta);
        updatedCount++;
        console.log(`[sync-chats] Updated chat ${chatId}`);
      }
    }

    console.log(`[sync-chats] Updated ${updatedCount} chats for user ${email}`);
    return c.json({ success: true, updated: updatedCount });
  } catch (err) {
    console.log("Error PUT /users/:email/sync-chats:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// ── Sync user name across all trips and proposals ────────────────────────────
// Called after profile update or passport OCR verification
app.put("/make-server-4e36197a/users/:email/sync-trips", async (c) => {
  try {
    const email = decodeURIComponent(c.req.param("email"));
    if (!isActingAs(c, email)) return c.json(FORBIDDEN_NOT_YOU, 403);
    const body = await c.req.json();
    const { firstName, lastName, middleName, fullName, avatarUrl } = body;

    if (!email) return c.json({ error: "email required" }, 400);

    const displayName = fullName || [firstName, lastName, middleName].filter(Boolean).join(' ') || '';
    if (!displayName) return c.json({ success: true, updated: 0, message: "No name to sync" });

    console.log(`[sync-trips] Syncing name "${displayName}" for user ${email}`);

    let updatedTrips = 0;
    let updatedOffers = 0;

    // 1. Update trips where this user is the driver (места не трогаются — patch их защищает)
    const userTrips = (await store.trips.listByDriver(supabase, email)).filter(t => !t.deletedAt);
    for (const trip of userTrips) {
      const saved = await store.trips.patch(supabase, trip.id, {
        driverName: displayName,
        ...(avatarUrl ? { driverAvatar: avatarUrl } : {}),
      });
      if (saved && saved !== 'moved') updatedTrips++;
    }

    // 2. Update offers where this user is the sender — только карточка, статус и места не меняются
    const userOffers = await store.offers.listBySender(supabase, email);
    for (const offer of userOffers) {
      const saved = await store.offers.patchCard(supabase, offer.tripId, offer.offerId, {
        senderName: displayName,
        ...(avatarUrl ? { senderAvatar: avatarUrl } : {}),
      });
      if (saved && saved !== 'moved') updatedOffers++;
    }

    console.log(`[sync-trips] Updated ${updatedTrips} trips and ${updatedOffers} offers for user ${email}`);
    return c.json({ success: true, updatedTrips, updatedOffers });
  } catch (err) {
    console.log("Error PUT /users/:email/sync-trips:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// Delete entire chat (hard delete from DB)
app.delete("/make-server-4e36197a/chat/:chatId", async (c) => {
  try {
    const chatId = c.req.param("chatId");
    if (!chatId) return c.json({ error: "chatId required" }, 400);

    const callerEmail = actingAs(c, c.req.query("callerEmail"));
    if (!callerEmail) return c.json({ error: "callerEmail query param required" }, 400);

    console.log(`[delete-chat] Deleting chat: ${chatId}`);

    // 0. Read chatmeta BEFORE deleting — need tripIds + participants to reset offers
    const metaKey = `ovora:chatmeta:${chatId}`;
    const meta: any = await kv.get(metaKey) || {};

    // IDOR fix: only participants may delete the chat
    const participants: string[] = meta.participants || [];
    if (participants.length > 0 && !participants.includes(callerEmail)) {
      console.warn(`[delete-chat] Unauthorized: ${callerEmail} tried to delete chat ${chatId}`);
      return c.json({ error: "Forbidden: you are not a participant of this chat" }, 403);
    }

    const tripId: string | undefined = meta.tripId;
    const tripIds: Set<string> = new Set([
      ...(meta.tripIds || []),
      ...(meta.tripId ? [String(meta.tripId)] : []),
    ]);

    // 0a. Cancel ALL pending offers between this pair of participants (chat_deleted = cancellation)
    // ✅ FIX: pair-based chat stores only the LAST tripId in chatmeta.
    // We must cancel offers for ALL trips between this driver↔sender pair, not just the last tripId.
    if (participants.length >= 2) {
      try {
        let cancelledCount = 0;
        for (const sender of participants) {
          // The driver = the other participant
          const driverEmail = participants.find((p: string) => p !== sender);
          if (!driverEmail) continue;
          const offers = await store.offers.listBySender(supabase, sender);
          for (const offer of offers) {
            if (offer.status !== 'pending') continue;
            // Водитель заявки берётся из поездки при создании; tripIds чата — запасной признак
            const driverOwnsTrip = offer.driverEmail === String(driverEmail).toLowerCase() || tripIds.has(String(offer.tripId));
            if (!driverOwnsTrip) continue;
            const t = await store.offers.change(supabase, offer.tripId, offer.offerId, 'cancelled', ['pending'], 'cancelledAt');
            if (t.result !== 'ok') continue;
            cancelledCount++;
            console.log(`[delete-chat] Cancelled offer ${offer.offerId} trip=${offer.tripId} sender=${offer.senderEmail} driver=${driverEmail}`);
          }
        }
        console.log(`[delete-chat] Cancelled ${cancelledCount} offers for chat ${chatId} (participants: ${participants.join(', ')})`);
      } catch (offerErr) {
        console.log('[delete-chat] Error cancelling offers:', offerErr);
      }
    }

    // 1. Delete all messages
    const msgs: any[] = await kv.getByPrefix(`ovora:chat:${chatId}:`);
    for (const msg of msgs) {
      if (msg?.msgId) {
        await kv.del(`ovora:chat:${chatId}:${msg.msgId}`);
      }
    }

    // 2. Delete chat metadata
    await kv.del(metaKey);

    console.log(`[delete-chat] Deleted chat ${chatId}: ${msgs.length} messages`);
    return c.json({ success: true, deletedMessages: msgs.length });
  } catch (err) {
    console.log("Error DELETE /chat/:chatId:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// Delete single message from chat
app.delete("/make-server-4e36197a/chat/:chatId/message/:msgId", async (c) => {
  try {
    const chatId = c.req.param("chatId");
    const msgId = c.req.param("msgId");
    if (!chatId || !msgId) return c.json({ error: "chatId and msgId required" }, 400);

    const callerEmail = actingAs(c, c.req.query("callerEmail"));
    if (!callerEmail) return c.json({ error: "callerEmail query param required" }, 400);

    // Only the message author may delete it
    const existing: any = await kv.get(`ovora:chat:${chatId}:${msgId}`);
    if (existing && existing.senderId && existing.senderId !== callerEmail) {
      console.warn(`[delete-message] Unauthorized: ${callerEmail} tried to delete message by ${existing.senderId}`);
      return c.json({ error: "Forbidden: you are not the author of this message" }, 403);
    }

    console.log(`[delete-message] Deleting message ${msgId} from chat ${chatId}`);

    // Delete the message
    await kv.del(`ovora:chat:${chatId}:${msgId}`);

    // Update chat metadata: find new lastMessage
    const remainingMsgs: any[] = await kv.getByPrefix(`ovora:chat:${chatId}:`);
    const sorted = remainingMsgs
      .filter(m => m && m.msgId)
      .sort((a, b) => (b.ts || 0) - (a.ts || 0)); // newest first

    const metaKey = `ovora:chatmeta:${chatId}`;
    const meta: any = await kv.get(metaKey) || {};

    if (sorted.length > 0) {
      const lastMsg = sorted[0];
      const preview = lastMsg.type === 'proposal' ? 'Новая оферта на перевозку' : (lastMsg.text || '');
      await kv.set(metaKey, {
        ...meta,
        lastMessage: preview,
        lastMessageAt: lastMsg.createdAt,
        lastSenderId: lastMsg.senderId,
      });
    } else {
      // No messages left → set empty state
      await kv.set(metaKey, {
        ...meta,
        lastMessage: 'Новый чат',
        lastMessageAt: null,
      });
    }

    console.log(`[delete-message] Deleted message ${msgId}, remaining: ${sorted.length}`);
    return c.json({ success: true, remainingMessages: sorted.length });
  } catch (err) {
    console.log("Error DELETE /chat/:chatId/message/:msgId:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  DOCUMENT VERIFICATION ROUTES (Supabase Storage + таблица documents)
//  Скан — в Storage, запись — profileStore.documents, номер документа — только шифром
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 📄 Анализ качества фото документа
 * ⚠️ ТОЛЬКО ДЛЯ СТАТИСТИКИ! НЕ влияет на результат верификации!
 * Симулирует проверку качества изображения
 */
function analyzePhotoQuality(fileSize: number): number {
  // Симуляция анализа качества на основе размера файла
  // Большие файлы обычно = лучше качество
  // ❌ ЭТО ЗНАЧЕНИЕ НЕ ИСПОЛЬЗУЕТСЯ ДЛЯ ОТКАЗА В ВЕРИФИКАЦИИ!
  if (fileSize > 2000000) return 85 + Math.floor(Math.random() * 10); // 85-95
  if (fileSize > 1000000) return 75 + Math.floor(Math.random() * 15); // 75-90
  if (fileSize > 500000) return 65 + Math.floor(Math.random() * 15);  // 65-80
  return 45 + Math.floor(Math.random() * 20); // 45-65
}

/**
 * 🔍 OCR.space API - извлечение текста из изображения
 * Использует OCR.space для чтения кириллицы, таджикского и латинского алфавита
 */
async function extractTextFromImage(imageBase64: string): Promise<string> {
  const apiKey = Deno.env.get('OCR_SPACE_API_KEY');
  
  if (!apiKey) {
    console.error('[OCR] OCR_SPACE_API_KEY not configured - using simulation mode');
    return simulateOCR();
  }

  ocrDebug('[OCR] API Key found:', apiKey.substring(0, 4) + '...' + apiKey.substring(apiKey.length - 4));
  console.log('[OCR] Starting dual OCR request (rus + eng)...');

  try {
    // Определяем тип изображения по base64
    let imageType = 'jpeg';
    if (imageBase64.startsWith('/9j/')) imageType = 'jpeg';
    else if (imageBase64.startsWith('iVBOR')) imageType = 'png';
    else if (imageBase64.startsWith('R0lGOD')) imageType = 'gif';

    console.log('[OCR] Detected image type:', imageType);
    console.log('[OCR] Base64 length:', imageBase64.length);

    const imageDataUrl = `data:image/${imageType};base64,${imageBase64}`;
    const savedKey = apiKey; // capture for inner function

    // ── Вспомогательная функция для одного OCR-запроса ───────────────────────
    // Таймаут 25 сек — OCR.space иногда долго отвечает
    async function ocrRequest(language: string, engine: string): Promise<string> {
      const fd = new FormData();
      fd.append('base64Image', imageDataUrl);
      fd.append('language', language);
      fd.append('isOverlayRequired', 'false');
      fd.append('detectOrientation', 'false'); // Отключаем, чтобы сэкономить ресурсы
      fd.append('scale', 'false');             // Отключаем, чтобы избежать System Resource Exhaustion (E500)
      fd.append('isTable', 'false');
      fd.append('OCREngine', engine);
      fd.append('apikey', savedKey);
      try {
        console.log(`[OCR] Sending lang=${language} engine=${engine}, imageDataUrl length=${imageDataUrl.length}...`);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 25000);
        const res = await fetch('https://api.ocr.space/parse/image', {
          method: 'POST',
          body: fd,
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        console.log(`[OCR] Status [${language}]:`, res.status);
        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          console.error(`[OCR] HTTP ${res.status} [${language}]: ${errText.substring(0, 200)}`);
          return '';
        }
        const json = await res.json();
        if (json.IsErroredOnProcessing) {
          console.error(`[OCR] Processing error [${language}]:`, json.ErrorMessage, json.ErrorDetails);
          return '';
        }
        if (json.ParsedResults && json.ParsedResults.length > 0) {
          const txt: string = json.ParsedResults[0].ParsedText || '';
          ocrDebug(`[OCR] [${language}] ${txt.length} chars. Preview:`, txt.substring(0, 400));
          return txt;
        }
        console.warn(`[OCR] [${language}] No ParsedResults in response`, JSON.stringify(json).substring(0, 300));
      } catch (e: any) {
        if (e?.name === 'AbortError') {
          console.error(`[OCR] Timeout (25s) exceeded [${language}]`);
        } else {
          console.error(`[OCR] Exception [${language}]:`, e);
        }
      }
      return '';
    }

    // ── Два параллельных запроса: русский (кириллица) + английский (MRZ) ─────
    console.log('[OCR] Running dual OCR (rus Engine1 + eng Engine2) in parallel...');
    const [rusText, engText] = await Promise.all([
      ocrRequest('rus', '1'),   // Engine 1 (Tesseract) — лучше для русского печатного
      ocrRequest('eng', '2'),   // Engine 2 — лучше для MRZ-латиницы
    ]);

    // Объединяем результаты
    const combined = [rusText, engText].filter(t => t && t.trim()).join('\n---ENG---\n');

    if (!combined.trim()) {
      console.error('[OCR] Both passes returned empty — falling back to simulation');
      return simulateOCR();
    }

    console.log('[OCR] Combined text length:', combined.length);
    return combined;

  } catch (error) {
    console.error('[OCR] Exception during OCR API call:', error);
    console.error('[OCR] Error name:', (error as any)?.name);
    console.error('[OCR] Error message:', (error as any)?.message);
    console.error('[OCR] Falling back to simulation mode');
    return simulateOCR();
  }
}

/**
 * 🎭 Симуляция OCR для тестирования (когда API недоступен)
 * ⚠️ ВАЖНО: Возвращаем ПУСТУЮ строку чтобы не создавать ложные данные!
 * Раньше здесь был фиктивный текст паспорта - это приводило к тому что
 * ЛЮБОЙ документ загруженный в раздел "Паспорт" одобрялся автоматически
 * (OCR симулировал паспорт → тип совпадал → документ проходил)
 */
function simulateOCR(): string {
  console.log('[OCR] Simulation mode: returning empty string to avoid false document type approvals');
  // Пустая строка = OCR не смог прочитать → detectedType = unknown → тип не проверяется
  // Документ будет одобрен, но профиль НЕ обновится без реальных данных
  return '';
}

/**
 * 🔍 Определение типа документа по содержимому OCR текста
 * Возвращает: 'passport' | 'driver_license' | 'vehicle_registration' | 'unknown'
 */
function detectDocumentType(text: string): string {
  if (!text) return 'unknown';
  
  const lowerText = text.toLowerCase();
  
  console.log('[DocumentTypeDetector] Analyzing text for document type detection...');
  
  // ═══════════════════════════════════════════════════════════════════
  // 🚗 ТЕХПАСПОРТ (Vehicle Registration / Technical Passport)
  // ═══════════════════════════════════════════════════════════════════
  const vehicleKeywords = [
    'техпаспорт',
    'технический паспорт',
    'свидетельство о регистрации',
    'vehicle registration',
    'registration certificate',
    'гувоҳнома',
    'шиноснома',
    'марка',
    'модель',
    'двигатель',
    'engine',
    'vin',
    'кузов',
    'chassis',
    'год выпуска',
    'цвет',
    'color',
    'мощность',
    'объем двигателя',
    'тип тс',
    'категория тс',
  ];
  
  const vehicleMatchCount = vehicleKeywords.filter(keyword => lowerText.includes(keyword)).length;
  
  // ═══════════════════════════════════════════════════════════════════
  // 🪪 ВОДИТЕЛЬСКОЕ УДОСТОВЕРЕНИЕ (Driver's License)
  // ═══════════════════════════════════════════════════════════════════
  const driverLicenseKeywords = [
    'водительское удостоверение',
    'driving license',
    'driver license',
    "driver's license",
    'гувоҳномаи ронандагӣ',
    'категория',
    'category',
    'class',
    'a b c d',
    'разрешенные категории',
    'действительно до',
    'valid until',
    'место выдачи',
    'issued by',
  ];
  
  const driverLicenseMatchCount = driverLicenseKeywords.filter(keyword => lowerText.includes(keyword)).length;
  
  // ═══════════════════════════════════════════════════════════════════
  // 📘 ПАСПОРТ (Passport / ID Card)
  // ═══════════════════════════════════════════════════════════════════
  const passportKeywords = [
    'паспорт',
    'passport',
    'гражданство',
    'citizenship',
    'nationality',
    'шаҳрванд',
    'таджикистан',
    'tajikistan',
    'российская федерация',
    'russian federation',
    'пол',
    'sex',
    'ҷинс',
    'место рождения',
    'place of birth',
    'мвд',
    'mvd',
    'код подразделения',
    'кем выдан',
  ];
  
  const passportMatchCount = passportKeywords.filter(keyword => lowerText.includes(keyword)).length;

  // ═══════════════════════════════════════════════════════════════════
  // 🛡️ СТРАХОВКА (ОСАГО / страховой полис)
  // ═══════════════════════════════════════════════════════════════════
  const insuranceKeywords = [
    'осаго',
    'каско',
    'страхов',          // страховой, страховка, страхование, страховщик, страхователь
    'полис',
    'insurance',
    'policy',
    'суғурта',
    'страховая сумма',
    'страховая премия',
    'срок страхования',
  ];

  const insuranceMatchCount = insuranceKeywords.filter(keyword => lowerText.includes(keyword)).length;

  console.log('[DocumentTypeDetector] Match counts:', {
    passport: passportMatchCount,
    driverLicense: driverLicenseMatchCount,
    vehicle: vehicleMatchCount,
    insurance: insuranceMatchCount,
  });

  // Страховку проверяем первой: в полисе ОСАГО тоже есть VIN, марка и модель,
  // поэтому по общим словам он определился бы как техпаспорт. Слова «осаго»,
  // «полис», «страхов…» специфичны, поэтому порога в 2 совпадения достаточно.
  if (insuranceMatchCount >= 2) {
    console.log('[DocumentTypeDetector] Detected: INSURANCE (страховой полис)');
    return 'insurance';
  }

  // Определяем тип по максимальному количеству совпадений
  if (vehicleMatchCount >= 3) {
    console.log('[DocumentTypeDetector] Detected: VEHICLE_REGISTRATION (техпаспорт)');
    return 'vehicle_registration';
  }
  
  if (driverLicenseMatchCount >= 3) {
    console.log('[DocumentTypeDetector] Detected: DRIVER_LICENSE (водительское)');
    return 'driver_license';
  }
  
  if (passportMatchCount >= 3) {
    console.log('[DocumentTypeDetector] Detected: PASSPORT (паспорт)');
    return 'passport';
  }
  
  console.log('[DocumentTypeDetector] Could not reliably detect document type');
  return 'unknown';
}

/**
 * 📝 Парсинг данных из OCR текста
 * Извлекает ФИО, даты, номер документа из распознанного текста
 * ✅ Поддерживает: MRZ зону, таджикский/русский паспорт, двуязычные метки
 */
function parseDocumentText(text: string, documentType: string): {
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  birthDate: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  documentNumber: string | null;
} {
  if (!text) {
    return {
      fullName: null,
      firstName: null,
      lastName: null,
      birthDate: null,
      issueDate: null,
      expiryDate: null,
      documentNumber: null,
    };
  }

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  ocrDebug('[Parser] Processing', lines.length, 'lines for', documentType);
  ocrDebug('[Parser] Full text preview (first 800):', text.substring(0, 800));

  let firstName: string | null = null;
  let lastName: string | null = null;
  let patronymic: string | null = null;
  let birthDate: string | null = null;
  let issueDate: string | null = null;
  let expiryDate: string | null = null;
  let documentNumber: string | null = null;

  // Паттерны для поиска дат (DD.MM.YYYY, DD/MM/YYYY, DD-MM-YYYY)
  const datePattern = /(\d{2})[.\/-](\d{2})[.\/-](\d{4})/g;
  
  // Паттерны для номеров документов
  // Российский паспорт: серия 4 цифры + номер 6 цифр (с пробелом или без)
  // Таджикский паспорт: буквы + цифры
  const docNumberPattern = /([A-ZА-Я]{1,3}[\s-]?\d{6,9})|(\d{2}\s?\d{2}\s?\d{6})/gi;

  // Регекс для кириллического/латинского имени
  const nameCharRx = /[а-яёА-ЯЁәӣқҳҷӯa-zA-Z-]/;
  function isNameWord(w: string): boolean {
    return w.length >= 2 && nameCharRx.test(w) && !/\d/.test(w);
  }

  // ══════════════════════════════════════════════════════════════
  // 🔍 MRZ ПАРСИНГ (ICAO 9303, TD3 — загранпаспорт ЛЮБОЙ страны)
  // Две строки. Строка 1: P<CCC<ФАМИЛИЯ<<ИМЕНА (CCC — код страны, 1-3 симв).
  // Строка 2 (44 симв): номер(9)+чек+гражданство(3)+ДР(6)+чек+пол+срок(6)+...
  // Позиции фиксированы стандартом → работают одинаково для всех стран.
  // Пробелы/искажения OCR нормализуем, берём позиционно.
  // ══════════════════════════════════════════════════════════════
  function mrzYYMMDDtoDMY(s: string, isExpiry: boolean): string | null {
    if (!/^\d{6}$/.test(s)) return null;
    const yy = parseInt(s.substring(0, 2), 10);
    const mm = s.substring(2, 4);
    const dd = s.substring(4, 6);
    const mi = parseInt(mm, 10), di = parseInt(dd, 10);
    if (mi < 1 || mi > 12 || di < 1 || di > 31) return null;
    // Срок действия всегда 20YY. Дата рождения: >30 → 19YY, иначе 20YY.
    const year = isExpiry ? 2000 + yy : (yy > 30 ? 1900 + yy : 2000 + yy);
    return `${dd}.${mm}.${year}`;
  }

  const mrzCandidates = lines
    .map(l => l.replace(/\s/g, '').toUpperCase())
    .filter(clean => {
      const mrzChars = (clean.match(/[A-Z0-9<]/g) || []).length;
      return clean.length >= 20 && mrzChars / clean.length >= 0.70;
    });
  ocrDebug('[Parser] MRZ candidate lines:', mrzCandidates);

  const MRZ_LINE1_RX = /^P[A-Z<][A-Z<]{3}/;
  const mrzLine1 = mrzCandidates.find(l => MRZ_LINE1_RX.test(l));
  // Строка 2 — MRZ-строка, отличная от первой, с датой (номер может начинаться с буквы!)
  const mrzLine2 = mrzCandidates.find(l => l !== mrzLine1 && /\d{6}/.test(l) && !MRZ_LINE1_RX.test(l));

  // ── Строка 1: страна выдачи + ФИО ──────────────────────────────
  // ФИО из MRZ всегда латиницей (требование ICAO), поэтому НЕ пишем их сразу в
  // firstName/lastName — иначе в профиль попадёт «SABUROV» вместо «Сабуров».
  // Держим отдельно и подставим ниже только если со страницы паспорта кириллицу
  // прочитать не удалось (напр. иностранный паспорт без кириллицы).
  let mrzFirstName: string | null = null;
  let mrzLastName: string | null = null;
  let mrzPatronymic: string | null = null;
  if (mrzLine1) {
    const issuingCountry = mrzLine1.substring(2, 5).replace(/</g, '');
    if (issuingCountry) ocrDebug('[Parser] MRZ issuing country:', issuingCountry);
    const nameSection = mrzLine1.substring(5);
    const dcIdx = nameSection.indexOf('<<');
    if (dcIdx > 0) {
      const rawLast = nameSection.substring(0, dcIdx).replace(/</g, ' ').trim();
      const nameParts = nameSection.substring(dcIdx + 2).split('<').filter(p => p.length > 1);
      if (rawLast.length > 1) { mrzLastName = rawLast; ocrDebug('[Parser] MRZ lastName (latin, fallback):', mrzLastName); }
      if (nameParts.length > 0) { mrzFirstName = nameParts[0]; ocrDebug('[Parser] MRZ firstName (latin, fallback):', mrzFirstName); }
      if (nameParts.length > 1) { mrzPatronymic = nameParts[1]; ocrDebug('[Parser] MRZ patronymic (latin, fallback):', mrzPatronymic); }
    }
  }

  // ── Строка 2: номер паспорта, гражданство, дата рождения, срок ──
  if (mrzLine2 && mrzLine2.length >= 28) {
    if (!documentNumber) {
      const rawNum = mrzLine2.substring(0, 9).split('<')[0].replace(/[^A-Z0-9]/g, '');
      if (rawNum.length >= 5) { documentNumber = rawNum; ocrDebug('[Parser] MRZ passport №:', documentNumber); }
    }
    const nat = mrzLine2.substring(10, 13).replace(/</g, '');
    if (nat) ocrDebug('[Parser] MRZ nationality:', nat);
    if (!birthDate) {
      const dob = mrzYYMMDDtoDMY(mrzLine2.substring(13, 19), false);
      if (dob) { birthDate = dob; ocrDebug('[Parser] MRZ birthDate:', birthDate); }
    }
    if (!expiryDate) {
      const exp = mrzYYMMDDtoDMY(mrzLine2.substring(21, 27), true);
      if (exp) { expiryDate = exp; ocrDebug('[Parser] MRZ expiryDate:', expiryDate); }
    }
  }

  // ══════════════════════════════════════════════════════════════
  // 🔍 Основной парсинг по строкам
  // Обрабатываем два варианта:
  //   A) Метка на строке N, значение на строке N+1 (классика)
  //   B) Метка и значение на одной строке: "Фамилия САБУРОВ"
  // ══════════════════════════════════════════════════════════════
  // Индексы строк, относящихся к "Место рождения" — исключаем из имён
  const birthplaceLineIndices = new Set<number>();
  let inBirthplaceCtx = false;
  for (let bi = 0; bi < lines.length; bi++) {
    const bll = lines[bi].toLowerCase();
    // Начало контекста места рождения
    if (bll.includes('место рождения') || bll.includes('place of birth') ||
        bll.includes('мавзаи таваллуд') || bll.includes('таваллудгох') ||
        (bll === 'место' && bi + 1 < lines.length && lines[bi + 1].toLowerCase().includes('рождения'))) {
      inBirthplaceCtx = true;
      birthplaceLineIndices.add(bi);
    }
    // Конец контекста — следующая именная метка или дата
    if (inBirthplaceCtx) {
      birthplaceLineIndices.add(bi);
      if (bi > 0 && (
        bll.includes('выдан') || bll.includes('серия') || bll.includes('номер') ||
        bll.includes('пол') || bll.includes('дата выдачи') || bll.includes('срок') ||
        bll.includes('код подразд') || /^\d{2}[./-]\d{2}[./-]\d{4}$/.test(lines[bi].trim())
      )) {
        inBirthplaceCtx = false;
      }
    }
  }
  ocrDebug('[Parser] Birthplace line indices:', [...birthplaceLineIndices]);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lowerLine = line.toLowerCase();
    const nextLine = i + 1 < lines.length ? lines[i + 1] : '';
    const nextNextLine = i + 2 < lines.length ? lines[i + 2] : '';

    // ── ФАМИЛИЯ ─────────────────────────────────────────────────
    if (!lastName) {
      const isSurnameLabel = (
        lowerLine.includes('фамил') ||
        lowerLine === 'surname' ||
        lowerLine.includes('насаб') ||
        lowerLine.includes('nasab') ||
        lowerLine.includes('last name') ||
        lowerLine.includes('/surname') ||
        lowerLine.includes('насаб/фамили')
      );
      if (isSurnameLabel) {
        // Вариант B: метка + значение на одной строке
        // "Фамилия САБУРОВ" → берём слово после метки
        const sameLineMatch = line.match(/(?:фамили[яь]|surname|насаб)[:\s]+([А-ЯЁа-яёA-Za-z][А-ЯЁа-яёA-Za-z-]+)/i);
        if (sameLineMatch && sameLineMatch[1].length > 1) {
          lastName = sameLineMatch[1].trim();
          ocrDebug('[Parser] Found lastName (same line):', lastName);
        } else {
          // Вариант A: значение на следующей строке
          const cleanSurname = nextLine.replace(/[^а-яёА-ЯЁәӣқҳҷӯa-zA-Z\s-]/g, '').trim();
          if (cleanSurname && cleanSurname.length > 1) {
            lastName = cleanSurname.split(/\s+/)[0]; // первое слово
            ocrDebug('[Parser] Found lastName (next line):', lastName);
          }
        }
      }
    }

    // ── ИМЯ (+ Отчество на той же строке) ────────────────────────
    if (!firstName) {
      // ⚠️ ВАЖНО:
      // - Таджикский «Падарнома» содержит «ном» → нужно исключить из isNameLabel
      // - Российский «Имя Отчество» содержит «отчеств» — НО это метка ИМЯ, не отчества!
      //   Поэтому исключаем «отчеств» ТОЛЬКО если на строке НЕТ «имя»
      const isPatronymicContext = (
        // «Отчество» без «Имя» на той же строке — чисто метка отчества
        (lowerLine.includes('отчеств') && !lowerLine.includes('имя')) ||
        lowerLine.includes('падарнома') ||
        lowerLine.includes('падарном') ||
        lowerLine.includes('patronymic') ||
        lowerLine.includes('middle name')
      );
      const isNameLabel = !isPatronymicContext && (
        (lowerLine.includes('имя') && !lowerLine.includes('фамил')) ||
        lowerLine === 'name' ||
        // «ном» = тадж. «имя», НО не «падарнома»/«нома» (отчество) и не «номер»
        (lowerLine.includes('ном') && !lowerLine.includes('насаб') && !lowerLine.includes('номер') && !lowerLine.includes('нома')) ||
        lowerLine.includes('nom/') ||
        lowerLine.includes('/name') ||
        lowerLine === 'ном/имя' ||
        lowerLine.includes('first name')
      );
      if (isNameLabel) {
        // Вариант B: "Имя МУХАММАДЖОН" на одной строке
        const sameLineMatch = line.match(/(?:имя|first\s*name|ном)[:\s]+([А-ЯЁа-яёA-Za-z][А-ЯЁа-яёA-Za-z-]+)/i);
        if (sameLineMatch && sameLineMatch[1].length > 1) {
          firstName = sameLineMatch[1].trim();
          ocrDebug('[Parser] Found firstName (same line):', firstName);
        } else {
          // Вариант A: значение на следующей строке
          // Российский паспорт: строка «Имя Отчество» содержит оба слова разделённы�� пробелом
          const cleanName = nextLine.replace(/[^а-яёА-ЯЁәӣқҳҷӯa-zA-Z\s-]/g, '').trim();
          const nameParts = cleanName.split(/\s+/).filter(w => w.length > 1);
          if (nameParts.length >= 1) {
            firstName = nameParts[0];
            ocrDebug('[Parser] Found firstName (next line):', firstName);
            // Если на следующей строке 2 слова — второе это отчество (российский паспорт)
            if (!patronymic && nameParts.length >= 2) {
              patronymic = nameParts[1];
              ocrDebug('[Parser] Found patronymic (inline with firstName):', patronymic);
            }
          }
        }
      }
    }

    // ── ОТЧЕСТВО ─────────────────────────────────────────────────
    if (!patronymic) {
      const isPatronymicLabel = (
        lowerLine.includes('отчеств') ||
        lowerLine.includes('patronymic') ||
        lowerLine.includes('middle name') ||
        // Таджикский: «Падарнома» / «Падарном» = «отчество» (документ отца)
        lowerLine.includes('падарнома') ||
        lowerLine.includes('падарном')
      );
      if (isPatronymicLabel) {
        const sameLineMatch = line.match(/(?:отчество|patronymic|middle\s*name|падарнома?)[:\s]+([А-ЯЁа-яёA-Za-z][А-ЯЁа-яёA-Za-z-]+)/i);
        if (sameLineMatch && sameLineMatch[1].length > 1) {
          patronymic = sameLineMatch[1].trim();
          ocrDebug('[Parser] Found patronymic (same line):', patronymic);
        } else {
          const cleanPat = nextLine.replace(/[^а-яёА-ЯЁa-zA-Z\s-]/g, '').trim();
          if (cleanPat && cleanPat.length > 1) {
            patronymic = cleanPat.split(/\s+/)[0];
            ocrDebug('[Parser] Found patronymic (next line):', patronymic);
          }
        }
      }
    }

    // ── ДАТЫ ────────────────────────────────────────────────────
    const dates = [...line.matchAll(datePattern)];
    
    if (dates.length > 0) {
      // Дата рождения (на той же строке, что и метка)
      if (!birthDate && (
        lowerLine.includes('рож') ||
        lowerLine.includes('birth') ||
        lowerLine.includes('таваллуд') ||
        lowerLine.includes('сана') ||
        lowerLine.includes('санаи')
      )) {
        birthDate = dates[0][0];
        ocrDebug('[Parser] Found birthDate (inline):', birthDate);
      }
      // Срок действия
      if (!expiryDate && (
        lowerLine.includes('срок') ||
        lowerLine.includes('действ') ||
        lowerLine.includes('expir') ||
        lowerLine.includes('муҳлат') ||
        lowerLine.includes('valid') ||
        lowerLine.includes('амал')
      )) {
        expiryDate = dates[0][0];
        ocrDebug('[Parser] Found expiryDate:', expiryDate);
      }
      // Дата выдачи
      if (!issueDate && (
        lowerLine.includes('выдан') ||
        lowerLine.includes('issue') ||
        lowerLine.includes('дода') ||
        lowerLine.includes('берилган')
      )) {
        issueDate = dates[0][0];
        ocrDebug('[Parser] Found issueDate:', issueDate);
      }
    }
    
    // Дата рождения может быть на следующих строках после метки
    if (!birthDate && (
      lowerLine.includes('рождения') || lowerLine === 'date of birth' || lowerLine.includes('таваллуд')
    )) {
      for (const checkLine of [nextLine, nextNextLine]) {
        const nd = [...checkLine.matchAll(datePattern)];
        if (nd.length > 0) {
          birthDate = nd[0][0];
          ocrDebug('[Parser] Found birthDate (next lines):', birthDate);
          break;
        }
      }
    }

    // ── НОМЕР ДОКУМЕНТА ─────────────────────────────────────────
    if (!documentNumber) {
      const numMatches = [...line.matchAll(docNumberPattern)];
      if (numMatches.length > 0 && (
        lowerLine.includes('№') ||
        lowerLine.includes('серия') ||
        lowerLine.includes('series') ||
        lowerLine.includes('паспорт') ||
        lowerLine.includes('passport') ||
        lowerLine.includes('шиноснома')
      )) {
        documentNumber = numMatches[0][0].replace(/\s+/g, ' ').trim();
        ocrDebug('[Parser] Found documentNumber:', documentNumber);
      }
    }
  }

  // ══════════════════════════════════════════════════════════════
  // 🔍 ФОЛБЭК: если имя/фамилия не найдены через метки —
  //    ищем паттерн "ФАМИЛИЯ ИМЯ ОТЧЕСТВО" (заглавные кириллические слова)
  //    ⚠️ Исключаем госорганы, географические и служебные термины
  // ══════════════════════════════════════════════════════════════
  const NAME_STOPWORDS = new Set<string>([
    // Госорганы
    'МВД','УМВД','ГУВД','ФМС','МВС','МФЦ','УФМС','РОВД','ОТДЕЛ','УПРАВЛЕНИЕ',
    'ГЛАВНОЕ','МИНИСТЕРСТВО','ДЕПАРТАМЕНТ','СЛУЖБА','ОТДЕЛЕНИЕ','ПОДРАЗДЕЛЕНИЕ',
    // Страны
    'РОССИЯ','РОССИЙСКОЙ','РОССИЙСКАЯ','РОССИЙСКОЕ','ФЕДЕРАЦИИ','ФЕДЕРАЦИЯ',
    'ТАДЖИКИСТАН','УЗБЕКИСТАН','КАЗАХСТАН','КЫРГЫЗСТАН','БЕЛАРУСЬ',
    'ТАДЖИКСКОЙ','ТАДЖИКСКАЯ','СОВЕТСКОЙ','СОВЕТСКАЯ','СОЦИАЛИСТИЧЕСКОЙ',
    // Регионы и административные РФ
    'ОБЛАСТЬ','ОБЛАСТНОЙ','КРАЯ','КРАЙ','РЕСПУБЛИКИ','РЕСПУБЛИКА',
    'РАЙОНА','РАЙОН','ГОРОДА','ГОРОД','ОКРУГА','ОКРУГ','РАЙОНЕ','ПОСЕЛОК',
    'ЧЕЛЯБИНСКОЙ','МОСКОВСКОЙ','СВЕРДЛОВСКОЙ','НОВОСИБИРСКОЙ',
    'ЛЕНИНГРАДСКОЙ','КРАСНОЯРСКОГО','ПЕРМСКОГО','КРАСНОДАРСКОГО',
    'САРАТОВСКОЙ','САМАРСКОЙ','РОСТОВСКОЙ','ОМСКОЙ','ТЮМЕНСКОЙ',
    'ИРКУТСКОЙ','ВОЛГОГРАДСКОЙ','ВОРОНЕЖСКОЙ','НИЖЕГОРОДСКОЙ',
    'КЕМЕРОВСКОЙ','БАШКОРТОСТАН','ТАТАРСТАН','МОРДОВИИ','УДМУРТИИ',
    // Алтайский край и падежные формы региональных слов (паспорт Бусоргина)
    'АЛТАЙ','АЛТАЙСКОМУ','АЛТАЙСКОГО','АЛТАЙСКОЙ','АЛТАЙСКОМ','АЛТАЙСКИЙ',
    'БАРНАУЛ','БАРНАУЛА','БАРНАУЛЕ','БАРНАУЛЬСКОГО','БАРНАУЛЬСКОМ',
    'ЛЕНИНСКОМ','ЛЕНИНСКОГО','ЛЕНИНСКОМУ','ЛЕНИНСКИЙ',
    'КРАЮ','КРАЕМ','РАЙОНЕ','РАЙОНОМ','РЕСПУБЛИКЕ','ГОРОДЕ','ГОРОДОМ',
    'ОКРУГЕ','ОКРУГОМ','ОБЛАСТЬЮ','ПОСЕЛКЕ',
    // Города и районы Таджикистана (чтобы не путать с именами людей!)
    'ДУШАНБЕ','ХУДЖАНД','КУЛЯБ','ХОРОГ','БОХТАР','ПЕНДЖИКЕНТ',
    'ИСТАРАВШАН','ГАРМ','ГАРМСКИЙ','��АРМСКАЯ','ГАРМСКОМ','ГАРМСКОГО',
    'ЛЕНИНАБАД','ВАНЧ','РАШТ','РАШТА','ХИСОР','ТУРСУНЗОДА','ВАХДАТ',
    'ЯВАН','ЁВОН','ШАХРИНАВ','ТАВИЛДАРА','ДЖИРГАТАЛЬ','ФАЙЗАБАД',
    'НУРОБОД','МУМИНОБОД','САРБАНД','ВОСЕ','ШААРТУЗ','ДУСТИ',
    'КОФАРНИХОН','РУДАКИ','ВАРЗОБ','НАВДИ','ГИССАР','МАТЧА',
    'АЙНИ','ЗАФАРАБАД','ГОНЧИ','СПИТАМЕН','БУСТОН','КАНИБАДАМ',
    'ИСФАРА','КОНИБОДОМ','МАСТЧОХ','ШАХРИСТОН','УРОТЕППА',
    // Документные поля
    'ПАСПОРТ','СЕРИЯ','НОМЕР','ВЫДАН','ГРАЖДАНИН','ГРАЖДАНСТВА',
    'ГРАЖДАНСТВО','МЕСТО','РОЖДЕНИЯ','ДАТА','ПОЛ','МУЖ','ЖЕН',
    'ЛИЧНОСТИ','УДОСТОВЕРЕНИЕ','СВИДЕТЕЛЬСТВО','РЕГИСТРАЦИЯ',
    'ВЫДАНО','КОДПОДРАЗДЕЛЕНИЯ','ССР','АССР',
  ]);

  if (!lastName || !firstName) {
    ocrDebug('[Parser] Fallback: searching for ALL-CAPS Cyrillic name (with stopword filter)...');

    // Собираем ВСЕ подходящие заглавные кириллические слова из всех строк
    const allCapsNameWords: string[] = [];
    for (let fi = 0; fi < lines.length; fi++) {
      const line = lines[fi];
      if (/[<>]/.test(line) || /^P[<A-Z]/.test(line)) continue; // Пропускаем MRZ
      if (birthplaceLineIndices.has(fi)) continue; // Пропускаем место рождения
      const lowerL = line.toLowerCase();
      if (
        lowerL.includes('выдан') || lowerL.includes('место рождения') ||
        lowerL.includes('мвд') || lowerL.includes('умвд') ||
        lowerL.includes('гувд') || lowerL.includes('фмс') ||
        lowerL.includes('россия') || lowerL.includes('российск') ||
        lowerL.includes('паспорт') || lowerL.includes('гражданин') ||
        lowerL.includes('федерац') || lowerL.includes('кем выдан') ||
        lowerL.includes('серия') || lowerL.includes('номер') ||
        lowerL.includes('код подраздел')
      ) continue;

      const wordsInLine = line.split(/\s+/);
      const capsWordsInLine = wordsInLine.filter(w =>
        /^[А-ЯЁ]{3,}$/.test(w) && !NAME_STOPWORDS.has(w)
      );

      // Вариант 1: на одной строке 2+ имённых слова → берём сразу
      if (capsWordsInLine.length >= 2) {
        if (!lastName) { lastName = capsWordsInLine[0]; ocrDebug('[Parser] Fallback lastName (same-line):', lastName); }
        if (!firstName) { firstName = capsWordsInLine[1]; ocrDebug('[Parser] Fallback firstName (same-line):', firstName); }
        if (!patronymic && capsWordsInLine.length >= 3) { patronymic = capsWordsInLine[2]; ocrDebug('[Parser] Fallback patronymic (same-line):', patronymic); }
        break;
      }

      // Вариант 2: одно заглавное слово на строке → накапливаем (рос. паспорт)
      if (capsWordsInLine.length === 1) {
        allCapsNameWords.push(capsWordsInLine[0]);
      }
    }

    // Если отдельные строки дали 2+ слова — собираем ФИО
    if ((!lastName || !firstName) && allCapsNameWords.length >= 2) {
      if (!lastName) { lastName = allCapsNameWords[0]; ocrDebug('[Parser] Fallback lastName (multi-line):', lastName); }
      if (!firstName) { firstName = allCapsNameWords[1]; ocrDebug('[Parser] Fallback firstName (multi-line):', firstName); }
      if (!patronymic && allCapsNameWords.length >= 3) { patronymic = allCapsNameWords[2]; ocrDebug('[Parser] Fallback patronymic (multi-line):', patronymic); }
    }
  }

  // ── Фолбэк для дат: если birthDate не нашли через метки — берём первую подходящую дату ──
  if (!birthDate) {
    const allDates: string[] = [];
    for (const line of lines) {
      if (/[<>]/.test(line)) continue; // пропускаем MRZ
      const found = [...line.matchAll(/(\d{2})[.\/-](\d{2})[.\/-](\d{4})/g)];
      for (const m of found) {
        const yyyy = parseInt(m[3]);
        const mm = parseInt(m[2]);
        if (yyyy >= 1930 && yyyy <= new Date().getFullYear() - 10 && mm >= 1 && mm <= 12) {
          allDates.push(m[0]);
        }
      }
    }
    if (allDates.length > 0) {
      // Берём самую раннюю дату как дату рождения
      allDates.sort((a, b) => {
        const [da, ma, ya] = a.split(/[.\/-]/);
        const [db, mb, yb] = b.split(/[.\/-]/);
        return parseInt(ya) - parseInt(yb) || parseInt(ma) - parseInt(mb);
      });
      birthDate = allDates[0];
      ocrDebug('[Parser] Fallback birthDate (earliest valid date):', birthDate);
    }
  }

  // ══════════════════════════════════════════════════════════════
  // 🔄 Лингвистическая проверка Имя ↔ Отчество
  // Отчества в русском/таджикском языке ВСЕГДА заканчиваются на:
  //   -ович, -евич (мужской род)  |  -овна, -евна (женский род)
  // Если firstName выглядит как отчество — значит OCR перепутал порядок.
  // ══════════════════════════════════════════════════════════════
  {
    // Паттерн окончаний отчества (кириллица + латиница, регистронезависимо)
    // Кирилл.: -ович/-евич (муж.) | -овна/-евна (жен.)
    // Латин.:  -OVICH/-EVICH (муж.) | -OVNA/-EVNA (жен.)
    const patronymicSuffixRx = /[оОеЕ][вВ][иИ][чЧ]$|[оОеЕ][вВ][нН][аА]$|OVICH$|EVICH$|OVNA$|EVNA$/i;
    const firstIsPatronymic  = firstName  ? patronymicSuffixRx.test(firstName)  : false;
    const patronIsPatronymic = patronymic ? patronymicSuffixRx.test(patronymic) : false;

    if (firstName && patronymic && firstIsPatronymic && !patronIsPatronymic) {
      // Имя и отчество явно перепутаны — меняем местами
      const tmp = firstName;
      firstName  = patronymic;
      patronymic = tmp;
      ocrDebug('[Parser] Swap firstName<->patronymic (patronymic suffix on firstName detected):', firstName, '->', patronymic);
    } else if (firstName && !patronymic && firstIsPatronymic) {
      // firstName содержит отчество, реальное имя не найдено — перемещаем
      patronymic = firstName;
      firstName  = null;
      ocrDebug('[Parser] firstName moved to patronymic (patronymic suffix, no firstName found):', patronymic);
    }
  }

  // ══════════════════════════════════════════════════════════════
  // 🔍 Поиск «потерянного» имени
  // Запускается ТОЛЬКО если firstName = null или является топонимом из стоп-слов
  // (например НАВДИ — деревня в Таджикистане, попала в firstName после swap).
  // Настоящее имя (МУХАМАДДЖОН) лежит в документе без привязки к метке.
  // ⚠️ НЕ запускается если firstName уже валидное имя (АЛЕКСЕЙ, АЛЕКСЕQ и т.д.)
  // ══════════════════════════════════════════════════════════════
  {
    // Условие запуска: firstName отсутствует или является стоп-словом (топоним)
    const firstNameNeedsReplacement = !firstName || NAME_STOPWORDS.has(firstName);
    if (firstNameNeedsReplacement) {
      ocrDebug(`[Parser] Lost-name search triggered (firstName="${firstName}" needs replacement=${firstNameNeedsReplacement})`);

      const patronymicSuffixRx2 = /[оОеЕ][вВ][иИ][чЧ]$|[оОеЕ][вВ][нН][аА]$|OVICH$|EVICH$|OVNA$|EVNA$/i;
      // Прилагательные-окончания мест (АЛТАЙСКОМУ, ЛЕНИНСКОГО, МОСКОВСКОМ и т.д.) — не имена!
      const adjPlaceSuffixRx = /СКОМ[УЕ]?$|СКОГО$|СКОЙ$|СКОМ$|НОМУ$|НСКОМУ$|НСКОГО$|НСКОЙ$/i;

      const assignedSet = new Set<string>(
        [lastName, firstName, patronymic].filter(Boolean) as string[]
      );

      // Собираем все заглавные кириллические слова из документа
      // Исключаем: MRZ, место рождения, строки органа выдачи
      const allDocCapsWords: string[] = [];
      for (let di = 0; di < lines.length; di++) {
        const dl = lines[di];
        if (/[<>]/.test(dl) || /^P[<A-Z]/.test(dl)) continue;
        if (birthplaceLineIndices.has(di)) continue;
        const dLower = dl.toLowerCase();
        if (
          dLower.includes('выдан') || dLower.includes('федерац') ||
          dLower.includes('уфмс') || dLower.includes('мвд') ||
          dLower.includes('гувд') || dLower.includes('фмс') ||
          dLower.includes('отдел') || dLower.includes('управлен') ||
          dLower.includes('краю') || dLower.includes('районе') ||
          dLower.includes('республике') || dLower.includes('областью') ||
          dLower.includes('паспорт') || dLower.includes('серия') ||
          dLower.includes('номер') || dLower.includes('код подраздел') ||
          dLower.includes('алтайскому') || dLower.includes('барнаул') ||
          dLower.includes('ленинском')
        ) continue;
        for (const w of dl.split(/\s+/)) {
          if (
            /^[А-ЯЁ]{4,}$/.test(w) &&
            !NAME_STOPWORDS.has(w) &&
            !adjPlaceSuffixRx.test(w) &&
            !assignedSet.has(w)
          ) {
            allDocCapsWords.push(w);
          }
        }
      }

      // Кандидаты: не патроним, не прилагательное-место
      const candidates = allDocCapsWords.filter(w =>
        !patronymicSuffixRx2.test(w) &&
        !adjPlaceSuffixRx.test(w)
      );

      if (candidates.length > 0) {
        // Берём самое длинное (наиболее вероятное настоящее имя)
        const best = candidates.reduce((a, b) => a.length >= b.length ? a : b);
        ocrDebug(`[Parser] Lost-name promoted: "${best}" (replaced "${firstName}")`);
        firstName = best;
      } else {
        ocrDebug('[Parser] Lost-name search found no candidates.');
      }
    } else {
      ocrDebug(`[Parser] Lost-name search SKIPPED — firstName="${firstName}" is valid (not a stopword).`);
    }
  }

  // ══════════════════════════════════════════════════════════════
  // 🔤 Запасной вариант ФИО — латиница из MRZ
  // Приоритет у написания со страницы паспорта (кириллица для РФ/ТЖ): профиль
  // должен совпадать с паспортом. Латиницу из MRZ берём, только если страницу
  // распознать не вышло — напр. у иностранного паспорта без кириллицы.
  // ══════════════════════════════════════════════════════════════
  if (!lastName && mrzLastName)     { lastName = mrzLastName;     ocrDebug('[Parser] lastName ← MRZ (кириллица не найдена)'); }
  if (!firstName && mrzFirstName)   { firstName = mrzFirstName;   ocrDebug('[Parser] firstName ← MRZ (кириллица не найдена)'); }
  if (!patronymic && mrzPatronymic) { patronymic = mrzPatronymic; ocrDebug('[Parser] patronymic ← MRZ (кириллица не найдена)'); }

  // ══════════════════════════════════════════════════════════════
  // 📋 Формируем полное имя (Фамилия Имя Отчество)
  // ══════════════════════════════════════════════════════════════
  const fullName = [lastName, firstName, patronymic].filter(Boolean).join(' ') || null;

  const result = {
    fullName,
    firstName,
    lastName,
    birthDate,
    issueDate,
    expiryDate,
    documentNumber,
  };

  ocrDebug('[Parser] Final extraction result:', JSON.stringify(result));
  return result;
}

/**
 * 📝 Извлечение данных из документа с помощью Google Vision OCR
 */
async function extractDocumentData(
  imageBase64: string,
  documentType: string
): Promise<{
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  birthDate: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  documentNumber: string | null;
  detectedType: string | null;
}> {
  console.log(`[OCR] Starting text extraction for ${documentType}...`);
  
  // 1. Извлекаем текст через Google Vision API
  const extractedText = await extractTextFromImage(imageBase64);
  
  if (!extractedText) {
    console.log('[OCR] No text extracted - returning empty data');
    return {
      fullName: null,
      firstName: null,
      lastName: null,
      birthDate: null,
      issueDate: null,
      expiryDate: null,
      documentNumber: null,
      detectedType: null,
    };
  }
  
  // 2. Определяем тип документа по содержимому
  const detectedType = detectDocumentType(extractedText);
  
  // 3. Парсим извлеченный текст
  const parsedData = parseDocumentText(extractedText, documentType);
  
  return {
    ...parsedData,
    detectedType,
  };
}

/**
 * 🤖 Автоматическая верификация документа
 * Проверяет ТОЛЬКО срок действия и соответствие ФИО
 * ❌ Качество фото НЕ проверяется - если данные читаются, документ проходит!
 */
async function autoVerifyDocument(
  photoQualityScore: number,
  expiryDate: string | null,
  documentType: string,
  userEmail: string,
  extractedFullName: string | null
): Promise<{ 
  status: 'verified' | 'rejected' | 'pending'; 
  rejectionReason?: string;
  needsProfileUpdate?: boolean;
}> {
  // Тип не распознан или имя не извлечено → на ручную проверку админу
  if (documentType === 'unknown' || !extractedFullName) {
    console.log(`[autoVerify] Document sent to manual review: type=${documentType}, name=${extractedFullName ? "found" : "none"}`);
    return { status: 'pending' };
  }

  const today = new Date();
  
  // ✅ 1. ОСНОВНАЯ ПРОВЕРКА: Срок действия документа (просрочен или нет)
  if (expiryDate) {
    const expiry = new Date(expiryDate);
    const daysLeft = Math.floor((expiry.getTime() - today.getTime()) / 86400000);
    
    if (daysLeft < 0) {
      return {
        status: 'rejected',
        rejectionReason: `Документ просрочен. Срок действия истек ${Math.abs(daysLeft)} дней назад. Обновите документ.`
      };
    }
    
    // Если срок истекает через 30 дней или меньше - одобряем, но отправим уведомление
    if (daysLeft <= 30) {
      console.log(`[autoVerify] Document ${documentType} expires in ${daysLeft} days - will send notification`);
    }
  }
  
  // ✅ 2. Проверка соответствия ФИО с другими документами
  // 🔑 ВАЖНО: Паспорт = эталонный документ, он ВСЕГДА обновляет профиль без проверки
  // Для других документов проверяем соответствие с паспортом
  if (extractedFullName && documentType !== 'passport') {
    // Получаем все документы пользователя
    const allDocs: any[] = await profile.documents.listByUser(supabase, userEmail);
    const verifiedDocs = allDocs.filter(d => d && d.status === 'verified' && d.extractedFullName);
    
    // Ищем паспорт среди одобренных документов
    const passportDoc = verifiedDocs.find(d => d.type === 'passport');
    
    if (passportDoc) {
      // Если паспорт уже есть - проверяем соответствие ФИО с паспортом
      const passportName = passportDoc.extractedFullName?.trim().toLowerCase();
      const newName = extractedFullName.trim().toLowerCase();
      
      if (passportName && newName && passportName !== newName) {
        return {
          status: 'rejected',
          rejectionReason: `ФИО в документе "${extractedFullName}" не совпадает с паспортом "${passportDoc.extractedFullName}". Все документы должны быть на одно лицо.`
        };
      }
    }
  }
  
  // ❌ 3. КАЧЕСТВО ФОТО НЕ ПРОВЕРЯЕТСЯ!
  // Если данные могут быть прочитаны - документ проходит без проблем
  console.log(`[autoVerify] Quality check SKIPPED (${photoQualityScore}%) - focusing on data, not photo quality`);
  
  // ✅ 4. Если это паспорт - ВСЕГДА обновляем профиль (паспорт = эталон)
  const needsProfileUpdate = documentType === 'passport' && extractedFullName !== null;
  
  console.log(`[autoVerify] Document verified!`);
  console.log(`[autoVerify] - Document type: ${documentType}`);
  ocrDebug(`[autoVerify] - Extracted name: ${extractedFullName}`);
  console.log(`[autoVerify] - Needs profile update: ${needsProfileUpdate}`);
  
  // ✅ 5. Все проверки пройдены - автоматическое одобрение!
  return { 
    status: 'verified',
    needsProfileUpdate
  };
}

/**
 * 📤 Upload document with auto-analysis
 */
app.post("/make-server-4e36197a/documents/upload", async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get('file') as File;
    const userEmail = formData.get('userEmail') as string;
    const documentId = formData.get('documentId') as string;
    const documentType = formData.get('documentType') as string;
    const title = formData.get('title') as string;
    const subtitle = formData.get('subtitle') as string;
    const expiryDate = formData.get('expiryDate') as string | null;
    const extractedFullName = formData.get('extractedFullName') as string | null; // ✅ ФИО из формы
    const callerEmail = actingAs(c, formData.get('callerEmail'));

    if (!file || !userEmail || !documentId) {
      return c.json({ error: "file, userEmail and documentId required" }, 400);
    }
    // Тип попадает в путь файла и в базу — только из списка.
    if (!(DOCUMENT_TYPES as readonly string[]).includes(documentType)) {
      return c.json({ error: `documentType must be one of: ${DOCUMENT_TYPES.join(', ')}` }, 400);
    }

    // 🔒 IDOR: загружать документ можно только за себя (callerEmail === userEmail).
    if (!callerEmail || callerEmail.toLowerCase().trim() !== userEmail.toLowerCase().trim()) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    if (!(await profile.users.get(supabase, userEmail))) {
      return c.json({ error: 'User not found' }, 404);
    }

    // 🔒 Лимит размера файла — защита от заливки гигантских файлов (стоимость storage/OCR).
    if (file.size > 10 * 1024 * 1024) {
      return c.json({ error: 'Файл слишком большой (макс. 10 МБ)' }, 400);
    }

    console.log(`[documents/upload] Starting upload for user ${userEmail}, doc ${documentId}`);

    // 1. Upload to Supabase Storage
    const ext = file.name.split('.').pop();
    const path = `documents/${userEmail.replace('@', '_')}/${documentType}_${documentId}_${Date.now()}.${ext}`;

    const arrayBuffer = await file.arrayBuffer();
    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, arrayBuffer, {
      contentType: file.type,
      upsert: true,
    });

    if (uploadError) {
      console.log(`[documents/upload] Upload error:`, uploadError);
      throw uploadError;
    }

    console.log(`[documents/upload] File uploaded to: ${path}`);

    // 2. Analyze photo quality (только для статистики, НЕ влияет на верификацию!)
    const photoQualityScore = analyzePhotoQuality(file.size);
    console.log(`[documents/upload] Photo quality score: ${photoQualityScore} (for stats only, not used for verification)`);

    // 3. 🔍 Извлечение данных из документа через Google Vision OCR
    // Конвертируем изображение в base64
    const base64Image = btoa(
      new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
    );
    
    // ✅ Логируем размер base64 для отладки
    const base64SizeKB = (base64Image.length * 0.75) / 1024; // Примерный размер в KB (base64 добавляет ~33% overhead)
    console.log(`[documents/upload] Base64 size: ${base64SizeKB.toFixed(0)} KB (original file: ${(file.size / 1024).toFixed(0)} KB)`);
    
    if (base64SizeKB > 1024) {
      console.warn(`[documents/upload] WARNING: Base64 size exceeds 1024 KB! OCR may fail.`);
    }
    
    const extractedData = await extractDocumentData(base64Image, documentType);
    console.log(`[documents/upload] OCR: name ${extractedData.fullName ? 'found' : 'NOT FOUND'}, birthDate ${extractedData.birthDate ? 'found' : 'NOT FOUND'}`);
    
    // ПРОВЕРКА СООТВЕТСТВИЯ ТИПА ДОКУМЕНТА
    console.log(`[documents/upload] Checking document type match...`);
    console.log(`[documents/upload] Expected type: ${documentType}`);
    console.log(`[documents/upload] Detected type: ${extractedData.detectedType || 'unknown'}`);
    
    // Маппинг типов документов для проверки
    const documentTypeMap: Record<string, string[]> = {
      'passport': ['passport'],
      'driver_license': ['driver_license'],
      'vehicle_registration': ['vehicle_registration'],
      'insurance': ['insurance'],
    };
    
    const allowedTypes = documentTypeMap[documentType] || [];
    const detectedType = extractedData.detectedType || 'unknown';
    
    // ✅ ВАЖНО: Для паспорта используем ТОЛЬКО OCR данные (реальные из фото)
    // Для других документов используем ручной ввод (для проверки соответствия с паспортом)
    let finalFullName: string | null = null;
    
    if (documentType === 'passport') {
      // Для паспорта: приоритет OCR данным из фото
      finalFullName = extractedData.fullName || extractedFullName;
      console.log(`[documents/upload] 🪪 PASSPORT: Using OCR extracted name: ${finalFullName ? "found" : "none"}`);
      
      if (extractedData.fullName) {
        console.log(`[documents/upload] Name extracted from passport photo via OCR`);
      } else if (extractedFullName) {
        console.log(`[documents/upload] OCR failed - using manually entered name as fallback`);
      }
    } else {
      // Для других документов: используем ручной ввод для проверки
      finalFullName = extractedFullName || extractedData.fullName;
      console.log(`[documents/upload] OTHER DOC: Using manually entered name: ${finalFullName ? "found" : "none"}`);
    }

    // Если тип обнаружен и не совпадает с ожидаемым
    if (detectedType !== 'unknown' && !allowedTypes.includes(detectedType)) {
      const typeNames: Record<string, string> = {
        'passport': 'Паспорт',
        'driver_license': 'Водительское удостоверение',
        'vehicle_registration': 'Техпаспорт (свидетельство о регистрации ТС)',
        'insurance': 'Страховой полис (ОСАГО)',
      };
      
      const expectedName = typeNames[documentType] || documentType;
      const detectedName = typeNames[detectedType] || detectedType;
      
      console.log(`[documents/upload] Document type mismatch! Expected: ${expectedName}, but detected: ${detectedName}`);
      
      // В записи — только путь к скану; ссылка живёт час и выдаётся при просмотре.
      const { data: signedUrlData } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
      const photoUrl = signedUrlData?.signedUrl || null;
      
      // Сохраняем документ со статусом "rejected"
      await profile.documents.save(supabase, {
        id: documentId,
        userEmail,
        type: documentType,
        title,
        subtitle,
        photoPath: path,
        uploadDate: new Date().toISOString(),
        expiryDate,
        photoQualityScore,
        extractedFullName: finalFullName,
        extractedData,
        status: 'rejected',
        rejectionReason: `Неверный тип документа. Ожидается: "${expectedName}", но загружен: "${detectedName}". Пожалуйста, загрузите правильный документ в соответствующий раздел.`,
      });
      
      return c.json({
        success: false,
        error: 'document_type_mismatch',
        message: `Вы пытаетесь загрузить "${detectedName}" в раздел "${expectedName}". Пожалуйста, загрузите правильный документ.`,
        expectedType: expectedName,
        detectedType: detectedName,
        photoUrl,
        status: 'rejected',
      });
    }
    
    console.log(`[documents/upload] Document type matches expected type`);
    
    // 4. 🤖 АВТОМАТИЧЕСКАЯ ВЕРИФИКАЦИЯ
    // ✅ Проверяется: срок действия + соответствие ФИО
    // ❌ НЕ проверяется: качество фото (если данные читаются - проходит!)
    const verification = await autoVerifyDocument(
      photoQualityScore, 
      expiryDate, 
      documentType,
      userEmail,
      finalFullName
    );
    console.log(`[documents/upload] Auto-verification result:`, verification);

    // 5. Save document metadata (номер документа profileStore шифрует сам)
    const now = new Date().toISOString();
    
    const document = {
      id: documentId,
      userEmail,
      type: documentType,
      title,
      subtitle,
      status: verification.status, // ✅ Автоматический статус: verified или rejected
      photoPath: path,
      uploadDate: now,
      expiryDate: expiryDate || null,
      photoQualityScore,
      rejectionReason: verification.rejectionReason || null,
      extractedFullName: finalFullName, // ✅ Сохраняем ФИО для проверки
      extractedData, // ✅ Все извлеченные данные
      createdAt: now,
      updatedAt: now,
    };

    await profile.documents.save(supabase, document);
    console.log(`[documents/upload] Document ${documentType} saved with status: ${verification.status}`);

    // 6. Если паспорт одобрен - обновить профиль пользователя
    let updatedUser = null;
    console.log(`[documents/upload] Checking profile update: status=${verification.status}, needsProfileUpdate=${verification.needsProfileUpdate}, name=${finalFullName ? "found" : "none"}`);
    
    if (verification.status === 'verified' && verification.needsProfileUpdate && finalFullName) {
      try {
        const existingUser: any = await profile.users.get(supabase, userEmail) || {};
        
        
        // Парсим ФИО (формат: "Фамилия Имя Отчество")
        const nameParts = finalFullName.trim().split(/\s+/);
        const lastName = nameParts[0] || '';
        const firstName = nameParts[1] || '';
        const middleName = nameParts[2] || '';
        
        // Добавляем дату рождения если она была извлечена из паспорта
        // Конвертируем DD.MM.YYYY → ISO формат YYYY-MM-DD для совместимости с new Date()
        let rawBirthDate = extractedData.birthDate || existingUser.birthDate;
        let birthDate = rawBirthDate;
        if (rawBirthDate && /^\d{2}\.\d{2}\.\d{4}$/.test(rawBirthDate)) {
          const [dd, mm, yyyy] = rawBirthDate.split('.');
          birthDate = `${yyyy}-${mm}-${dd}`;
          ocrDebug(`[documents/upload] Converted birthDate: ${rawBirthDate} → ${birthDate}`);
        }
        
        updatedUser = {
          ...existingUser,
          firstName: firstName || existingUser.firstName,
          lastName: lastName || existingUser.lastName,
          middleName: middleName || existingUser.middleName,
          fullName: finalFullName,
          birthDate: birthDate,
          updatedAt: now,
        };
        
        updatedUser = await profile.users.patch(supabase, userEmail, updatedUser);
        console.log(`[documents/upload] Profile updated from passport data`);
      } catch (profileErr) {
        console.log('[documents/upload] Error updating profile from passport:', profileErr);
      }
    } else {
      console.log(`[documents/upload] Profile update skipped`);
    }

    // 7. Create signed URL for immediate display
    const { data: signedUrlData } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);

    // 8. Создать уведомление о результате верификации
    try {
      const notificationId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      
      if (verification.status === 'verified') {
        // ✅ Документ одобрен автоматически
        await kv.set(`ovora:notification:${userEmail}:${notificationId}`, {
          id: notificationId,
          userEmail: userEmail,
          type: 'document',
          iconName: 'CheckCircle',
          iconBg: 'bg-emerald-500/10 text-emerald-500',
          title: 'Документ одобрен',
          description: verification.needsProfileUpdate 
            ? `${title} одобрен и профиль обновлен автоматически`
            : `${title} успешно прошел проверку и одобрен автоматически`,
          isUnread: true,
          createdAt: now,
        });
        console.log(`[documents/upload] Verification success notification created for user ${userEmail}`);
        
        // Если срок истекает в течение 30 дней - отправить предупреждение
        if (expiryDate) {
          const expiry = new Date(expiryDate);
          const daysLeft = Math.floor((expiry.getTime() - new Date().getTime()) / 86400000);
          
          if (daysLeft > 0 && daysLeft <= 30) {
            const warningId = `${Date.now() + 1}_${Math.random().toString(36).slice(2, 8)}`;
            await kv.set(`ovora:notification:${userEmail}:${warningId}`, {
              id: warningId,
              userEmail: userEmail,
              type: 'document',
              iconName: 'AlertTriangle',
              iconBg: 'bg-amber-400/10 text-amber-400',
              title: 'Документ скоро истечет',
              description: `${title} истекает через ${daysLeft} дней. Рекомендуем обновить заранее.`,
              isUnread: true,
              createdAt: now,
            });
            console.log(`[documents/upload] Expiry warning notification created for user ${userEmail} (${daysLeft} days left)`);
          }
        }
      } else {
        // ❌ Документ отклонен автоматически
        await kv.set(`ovora:notification:${userEmail}:${notificationId}`, {
          id: notificationId,
          userEmail: userEmail,
          type: 'document',
          iconName: 'XCircle',
          iconBg: 'bg-red-500/10 text-red-500',
          title: 'Документ отклонен',
          description: verification.rejectionReason || `${title} не прошел проверку. Загрузите новый документ.`,
          isUnread: true,
          createdAt: now,
        });
        console.log(`[documents/upload] Rejection notification created for user ${userEmail}`);
      }
    } catch (notifErr) {
      console.log('[documents/upload] Error creating notification:', notifErr);
    }

    console.log(`[documents/upload] Preparing response:`);
    console.log(`[documents/upload] - profileUpdated:`, updatedUser !== null);

    return c.json({ 
      success: true, 
      document: {
        ...document,
        photoUrl: signedUrlData?.signedUrl
      },
      updatedUser: updatedUser, // ✅ Возвращаем обновлённого пользователя если профиль был обновлён
      profileUpdated: updatedUser !== null, // ✅ Флаг что профиль был обновлён
    });
  } catch (err) {
    console.log("Error POST /documents/upload:", err);
    return c.json({ error: `Upload failed: ${err}` }, 500);
  }
});

/**
 * 📋 Get all documents for a user
 */
app.get("/make-server-4e36197a/documents/user/:email", async (c) => {
  try {
    const email = decodeURIComponent(c.req.param("email"));
    const callerEmail = actingAs(c, c.req.query("callerEmail")).toLowerCase().trim();
    if (!callerEmail || callerEmail !== email.toLowerCase().trim()) {
      return c.json({ error: 'Forbidden' }, 403);
    }
    console.log(`[documents/user] Fetching documents for: ${email}`);
    
    const docs: any[] = await profile.documents.listByUser(supabase, email);
    console.log(`[documents/user] Found ${docs.length} documents`);
    
    // Create signed URLs for all documents with photos
    const withUrls = await Promise.all(docs.filter(d => d).map(async (doc) => {
      if (!doc.photoPath) {
        return doc;
      }
      
      try {
        const { data } = await supabase.storage.from(BUCKET).createSignedUrl(doc.photoPath, 3600);
        return { ...doc, photoUrl: data?.signedUrl };
      } catch (err) {
        console.log(`[documents/user] Error creating signed URL for ${doc.id}:`, err);
        return doc;
      }
    }));
    
    return c.json({ documents: withUrls });
  } catch (err) {
    console.log("Error GET /documents/user:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// PUT /documents/:id удалён: он сливал в документ любое тело запроса, и владелец мог сам поставить
// status: 'verified'. Сайт его не вызывал. Статус меняет только админ (PUT /admin/documents/:id/status).

/**
 * 🗑️ Delete document
 */
app.delete("/make-server-4e36197a/documents/:documentId", async (c) => {
  try {
    const documentId = c.req.param("documentId");
    const { userEmail, callerEmail: _claimedCaller } = await c.req.json();
    const callerEmail = actingAs(c, _claimedCaller);

    if (!userEmail) {
      return c.json({ error: "userEmail required" }, 400);
    }
    if (!callerEmail || callerEmail.toLowerCase().trim() !== userEmail.toLowerCase().trim()) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const existing: any = await profile.documents.get(supabase, userEmail, documentId);
    
    if (!existing) {
      return c.json({ error: "Document not found" }, 404);
    }

    // Delete file from Storage
    if (existing.photoPath) {
      await supabase.storage.from(BUCKET).remove([existing.photoPath]);
      console.log(`[documents/delete] File deleted: ${existing.photoPath}`);
    }

    await profile.documents.remove(supabase, userEmail, documentId);
    console.log(`[documents/delete] Document ${documentId} deleted`);

    return c.json({ success: true });
  } catch (err) {
    console.log("Error DELETE /documents:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// POST /documents/analyze удалён: «переанализ» был случайным числом, сайт его не вызывал.

/**
 * 🧪 Test OCR endpoint - для тестирования распозна��ания документов
 */
app.post("/make-server-4e36197a/test-ocr", requireAdminChecked, async (c) => {
  try {
    const { imageBase64, documentType } = await c.req.json();

    if (!imageBase64) {
      console.error('[test-ocr] No imageBase64 provided');
      return c.json({ error: "imageBase64 required" }, 400);
    }

    console.log(`[test-ocr] Starting OCR test...`);
    console.log(`[test-ocr] Document type: ${documentType || 'unknown'}`);
    console.log(`[test-ocr] Image base64 length: ${imageBase64.length}`);

    // 1. Извлекаем текст через OCR.space
    console.log('[test-ocr] Calling extractTextFromImage...');
    const extractedText = await extractTextFromImage(imageBase64);
    console.log(`[test-ocr] OCR completed. Extracted text length: ${extractedText.length}`);
    console.log(`[test-ocr] First 200 chars: ${extractedText.substring(0, 200)}`);

    // 2. Определяем тип документа
    console.log('[test-ocr] Detecting document type...');
    const detectedType = detectDocumentType(extractedText);
    console.log(`[test-ocr] Detected type: ${detectedType}`);

    // 3. Парсим данные из текста
    console.log('[test-ocr] Parsing document data...');
    const parsedData = parseDocumentText(extractedText, documentType || 'passport');
    console.log(`[test-ocr] Parsing complete. Parsed data:`, JSON.stringify(parsedData, null, 2));

    return c.json({
      success: true,
      extractedText,
      detectedType,
      parsedData,
    });
  } catch (err) {
    console.error("[test-ocr] Exception:", err);
    console.error("[test-ocr] Error name:", err?.name);
    console.error("[test-ocr] Error message:", err?.message);
    console.error("[test-ocr] Error stack:", err?.stack);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  NOTIFICATIONS (OLD - will be replaced by new routes below)
// ══════════════════════════════════════════════════════════════════════════════
// Removed old duplicate routes - using new notification system below

// ══════════════════════════════════════════════════════════════════════════════
//  PUBLIC STATS
// ══════════════════════════════════════════════════════════════════════════════

app.get("/make-server-4e36197a/stats", async (c) => {
  try {
    const [users, trips, reviews]: any[] = await Promise.all([
      profile.users.listAll(supabase),
      store.trips.listAll(supabase),
      kv.getByPrefix("ovora:review:"),
    ]);
    const drivers = (users as any[]).filter((u: any) => u && u.role === 'driver').length;
    const citySet = new Set<string>();
    (trips as any[]).filter((t: any) => t && !t.deletedAt).forEach((t: any) => {
      if (t.from) citySet.add(String(t.from).trim().split(',')[0]);
      if (t.to)   citySet.add(String(t.to).trim().split(',')[0]);
    });
    const total = (reviews as any[]).filter((r: any) => r).length;
    const satisfied = total > 0
      ? Math.round(((reviews as any[]).filter((r: any) => r && (r.rating ?? 0) >= 4).length / total) * 100)
      : 98;
    return c.json({ drivers, cities: citySet.size, satisfied });
  } catch (err) {
    console.log("Error GET /stats:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  ADMIN — get all trips/offers/users/reviews
// ══════════════════════════════════════════════════════════════════════════════

app.get("/make-server-4e36197a/admin/stats", async (c) => {
  try {
    const [trips, offers, users, reviews]: any[] = await Promise.all([
      store.trips.listAll(supabase),
      store.offers.listAll(supabase),
      profile.users.listAll(supabase),
      kv.getByPrefix("ovora:review:"),
    ]);
    // Для центра уведомлений в шапке админки: новые pending-заявки и отзывы за последние 24ч.
    const DAY_MS = 24 * 60 * 60 * 1000;
    const sinceTs = Date.now() - DAY_MS;
    const validOffers = offers.filter((o: any) => o);
    const validReviews = reviews.filter((r: any) => r);
    return c.json({
      trips: trips.filter((t: any) => t && !t.deletedAt).length,
      offers: validOffers.length,
      users: users.filter((u: any) => u).length,
      reviews: validReviews.length,
      pendingOffers: validOffers.filter((o: any) => o.status === 'pending').length,
      recentReviews: validReviews.filter((r: any) => new Date(r.createdAt).getTime() >= sinceTs).length,
    });
  } catch (err) {
    console.log("Error GET /admin/stats:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// Постраничная выдача для admin-списков — getByPrefix всегда тянет весь префикс
// из БД (автогенерированный kv_store.tsx не поддерживает LIMIT/OFFSET на уровне
// запроса), поэтому пагинация применяется к уже загруженному массиву — это не
// снижает нагрузку на БД, но устраняет передачу/рендер тысяч записей за раз.
function paginate<T>(c: any, items: T[]): { items: T[]; total: number; limit: number; offset: number } {
  const rawLimit = c.req.query("limit");
  const limit = rawLimit ? Math.min(Number(rawLimit) || items.length, 500) : items.length;
  const offset = Math.max(Number(c.req.query("offset")) || 0, 0);
  return { items: items.slice(offset, offset + limit), total: items.length, limit, offset };
}

app.get("/make-server-4e36197a/admin/users", async (c) => {
  try {
    const users: any[] = await profile.users.listAll(supabase);
    const { items, total, limit, offset } = paginate(c, users.filter(u => u));
    return c.json({ users: items, total, limit, offset });
  } catch (err) {
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

app.get("/make-server-4e36197a/admin/trips", async (c) => {
  try {
    const trips: any[] = await store.trips.listAll(supabase);
    const { items, total, limit, offset } = paginate(c, trips.filter(t => t && !t.deletedAt));
    return c.json({ trips: items, total, limit, offset });
  } catch (err) {
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

app.get("/make-server-4e36197a/admin/offers", async (c) => {
  try {
    const offers: any[] = await store.offers.listAll(supabase);
    const { items, total, limit, offset } = paginate(c, offers.filter(o => o));
    return c.json({ offers: items, total, limit, offset });
  } catch (err) {
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

app.get("/make-server-4e36197a/admin/reviews", async (c) => {
  try {
    const reviews: any[] = await kv.getByPrefix("ovora:review:");
    const { items, total, limit, offset } = paginate(c, reviews.filter(r => r));
    return c.json({ reviews: items, total, limit, offset });
  } catch (err) {
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// ✅ Admin: все поставки (shipment-tracking) — статус, история, POD-фото
app.get("/make-server-4e36197a/admin/shipments", async (c) => {
  try {
    const shipments: any[] = await kv.getByPrefix("ovora:shipment:");
    const { items, total, limit, offset } = paginate(c, shipments.filter(s => s));
    return c.json({ shipments: items, total, limit, offset });
  } catch (err) {
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// ✅ Admin: список чатов (модерация, read-only) — без проверки participants,
// т.к. эндпоинт уже защищён глобальным requireAdminChecked + requireRole(['cargo-admin'])
app.get("/make-server-4e36197a/admin/chats", async (c) => {
  try {
    const chats: any[] = await kv.getByPrefix("ovora:chatmeta:");
    const { items, total, limit, offset } = paginate(c, chats.filter(ch => ch && ch.chatId));
    return c.json({ chats: items, total, limit, offset });
  } catch (err) {
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// ✅ Admin: сообщения конкретного чата (модерация, read-only)
app.get("/make-server-4e36197a/admin/chat/:chatId/messages", async (c) => {
  try {
    const chatId = c.req.param("chatId");
    const messages: any[] = await kv.getByPrefix(`ovora:chat:${chatId}:`);
    const sorted = messages.filter(m => m && m.msgId).sort((a, b) => (a.ts || 0) - (b.ts || 0));
    return c.json({ messages: sorted });
  } catch (err) {
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// ✅ Admin: список грузов отправителей (для управления/модерации)
app.get("/make-server-4e36197a/admin/cargos", async (c) => {
  try {
    const cargos: any[] = await store.cargos.listAll(supabase);
    const { items, total, limit, offset } = paginate(c, cargos.filter(cg => cg && !cg.deletedAt));
    return c.json({ cargos: items, total, limit, offset });
  } catch (err) {
    console.log("Error GET /admin/cargos:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// ✅ Admin: глобальный поиск по сущностям для шапки админки — находит конкретного
// пользователя/поездку/оферту/груз/отзыв по email/телефону/имени/ID, а не просто
// маршрутизирует по ключевым словам раздела (см. AdminLayout.tsx).
app.get("/make-server-4e36197a/admin/search", async (c) => {
  try {
    const q = (c.req.query("q") || "").trim().toLowerCase();
    if (q.length < 2) {
      return c.json({ users: [], trips: [], offers: [], cargos: [], reviews: [] });
    }

    const [users, trips, offers, cargos, reviews]: any[] = await Promise.all([
      profile.users.listAll(supabase),
      store.trips.listAll(supabase),
      store.offers.listAll(supabase),
      store.cargos.listAll(supabase),
      kv.getByPrefix("ovora:review:"),
    ]);

    const LIMIT = 5;
    const has = (...vals: any[]) => vals.some(v => v != null && String(v).toLowerCase().includes(q));

    const matchedUsers = users
      .filter((u: any) => u && has(u.email, u.phone, u.firstName, u.lastName, `${u.firstName || ''} ${u.lastName || ''}`))
      .slice(0, LIMIT)
      .map((u: any) => ({ email: u.email, name: `${u.firstName || ''} ${u.lastName || ''}`.trim(), phone: u.phone || '', role: u.role || '' }));

    const matchedTrips = trips
      .filter((t: any) => t && !t.deletedAt && has(t.id, t.from, t.to, t.driverEmail, t.driverName))
      .slice(0, LIMIT)
      .map((t: any) => ({ id: t.id, from: t.from, to: t.to, driverName: t.driverName || t.driverEmail || '' }));

    const matchedOffers = offers
      .filter((o: any) => o && has(o.offerId, o.tripId, o.senderEmail, o.senderName, o.driverEmail, o.driverName))
      .slice(0, LIMIT)
      .map((o: any) => ({ offerId: o.offerId, tripId: o.tripId, senderName: o.senderName || o.senderEmail || '', driverName: o.driverName || o.driverEmail || '' }));

    const matchedCargos = cargos
      .filter((cg: any) => cg && !cg.deletedAt && has(cg.id, cg.from, cg.to, cg.senderEmail, cg.senderName, cg.senderPhone))
      .slice(0, LIMIT)
      .map((cg: any) => ({ id: cg.id, from: cg.from, to: cg.to, senderName: cg.senderName || cg.senderEmail || '' }));

    const matchedReviews = reviews
      .filter((r: any) => r && has(r.reviewId, r.authorEmail, r.authorName, r.targetEmail, r.targetName))
      .slice(0, LIMIT)
      .map((r: any) => ({ reviewId: r.reviewId, authorName: r.authorName || r.authorEmail || '', targetName: r.targetName || r.targetEmail || '' }));

    return c.json({ users: matchedUsers, trips: matchedTrips, offers: matchedOffers, cargos: matchedCargos, reviews: matchedReviews });
  } catch (err) {
    console.log("Error GET /admin/search:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// ✅ Admin: force soft-delete груза (модерация, без проверки владельца — уже под requireAdmin)
app.delete("/make-server-4e36197a/admin/cargos/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const existing: any = await store.cargos.get(supabase, id);
    if (!existing) return c.json({ error: "Cargo not found" }, 404);
    // Груз и его отклики — одной транзакцией; водитель принятого отклика получает уведомление.
    await cancelCargoWithOffers(id, existing);
    if (existing.senderEmail) {
      const sender: any = await profile.users.get(supabase, existing.senderEmail.toLowerCase().trim());
      if (sender && !(await throttleEmail(existing.senderEmail, `cargo-removed-${id}`, 3_600_000))) {
        const tpl = adminActionTemplate({
          firstName: sender.firstName || 'Пользователь',
          title: 'ваш груз снят с публикации',
          message: `Объявление о грузе «${existing.from || ''} → ${existing.to || ''}» снято с публикации администратором.`,
          email: existing.senderEmail,
        });
        sendEmail({ to: existing.senderEmail, subject: tpl.subject, html: tpl.html }).catch(() => {});
      }
    }
    await CargoAuditLog.record({ action: 'cargo.admin_delete', actorEmail: adminActor(c), targetId: id, targetType: 'cargo', details: { senderEmail: existing.senderEmail } });
    console.log(`[DELETE /admin/cargos] Admin removed cargo ${id}`);
    return c.json({ success: true });
  } catch (err) {
    console.log("Error DELETE /admin/cargos/:id:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// ✅ Admin: редактирование груза (модерация/разрешение спора, без проверки владельца)
// Без status: админка его не присылает (CargosManagement.tsx), а ручная смена статуса обходит
// замок отклика. Снять груз — DELETE /admin/cargos/:id, он же отменяет отклики.
const CARGO_ADMIN_EDITABLE = ['from', 'to', 'cargoWeight', 'budget', 'currency', 'notes'] as const;
app.put("/make-server-4e36197a/admin/cargos/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const existing: any = await store.cargos.get(supabase, id);
    if (!existing) return c.json({ error: "Cargo not found" }, 404);

    const body = await c.req.json();
    const updates: Record<string, unknown> = {};
    for (const field of CARGO_ADMIN_EDITABLE) {
      if (field in body) updates[field] = body[field];
    }
    if (updates.from) updates.from = cleanAddress(String(updates.from));
    if (updates.to) updates.to = cleanAddress(String(updates.to));

    const saved = await store.cargos.patch(supabase, id, updates);
    if (!saved || saved === 'moved') return c.json({ error: "Cargo not found" }, 404);

    await CargoAuditLog.record({ action: 'cargo.admin_edit', actorEmail: adminActor(c), targetId: id, targetType: 'cargo', details: { fields: Object.keys(updates) } });
    return c.json({ success: true, cargo: saved });
  } catch (err) {
    console.log("Error PUT /admin/cargos/:id:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// ✅ Admin: разрешение спора между водителем и отправителем — смена статуса оферты.
// Если отменяется ранее принятая оферта — возвращаем списанную вместимость поездке.
const ADMIN_OFFER_STATUSES = ['cancelled', 'declined', 'rejected'];
app.put("/make-server-4e36197a/admin/offers/:tripId/:offerId/status", async (c) => {
  try {
    const tripId = c.req.param("tripId");
    const offerId = c.req.param("offerId");
    const { status } = await c.req.json();
    if (!status) return c.json({ error: "status required" }, 400);

    // Админ разрешает споры отменой. «Принять» за водителя нельзя: места при этом не
    // списывались бы. OffersManagement.tsx присылает только cancelled.
    if (!ADMIN_OFFER_STATUSES.includes(status)) {
      return c.json({ error: `status must be one of: ${ADMIN_OFFER_STATUSES.join(', ')}` }, 400);
    }
    const existing: any = await store.offers.get(supabase, tripId, offerId);
    if (!existing) return c.json({ error: "Offer not found" }, 404);
    // Места принятой заявки возвращаются в той же транзакции.
    const transition = await store.offers.change(supabase, tripId, offerId, status, LIVE_OFFER_STATUSES, 'cancelledAt');
    if (transition.result === 'not_found') return c.json({ error: "Offer not found" }, 404);
    if (transition.result !== 'ok') {
      return c.json({ error: `OFFER_CHANGED: offer is already ${transition.previous || 'changed'}` }, 409);
    }
    existing.status = transition.previous || existing.status;
    await store.offers.patchCard(supabase, tripId, offerId, { cancelReason: 'admin' });
    const updated: any = await store.offers.get(supabase, tripId, offerId);

    for (const email of [existing.senderEmail, existing.driverEmail].filter(Boolean)) {
      const user: any = await profile.users.get(supabase, email.toLowerCase().trim());
      if (user && !(await throttleEmail(email, `offer-admin-${status}-${tripId}-${offerId}`, 3_600_000))) {
        const tpl = adminActionTemplate({
          firstName: user.firstName || 'Пользователь',
          title: 'оферта изменена администратором',
          message: `Статус оферты по поездке изменён администратором на «${status}» в рамках разрешения спора.`,
          email,
        });
        sendEmail({ to: email, subject: tpl.subject, html: tpl.html }).catch(() => {});
      }
    }

    await CargoAuditLog.record({ action: 'offer.admin_status_change', actorEmail: adminActor(c), targetId: `${tripId}:${offerId}`, targetType: 'offer', details: { status, previousStatus: existing.status } });
    console.log(`[PUT /admin/offers] Admin set offer ${tripId}:${offerId} status to ${status}`);
    return c.json({ success: true, offer: updated });
  } catch (err) {
    console.log("Error PUT /admin/offers/:tripId/:offerId/status:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// ✅ Admin: удаление отзыва (модерация/спор) + чистка вторичных индексов
app.delete("/make-server-4e36197a/admin/reviews/:reviewId", async (c) => {
  try {
    const reviewId = c.req.param("reviewId");
    const key = `ovora:review:${reviewId}`;
    const existing: any = await kv.get(key);
    if (!existing) return c.json({ error: "Review not found" }, 404);

    await kv.del(key);
    if (existing.targetEmail) await kv.del(`ovora:userreviews:target:${existing.targetEmail}:${reviewId}`).catch(() => {});
    if (existing.authorEmail) await kv.del(`ovora:userreviews:author:${existing.authorEmail}:${reviewId}`).catch(() => {});

    // LOG-14: Recalculate rating after admin review deletion
    if (existing.targetEmail) {
      await recalculateRating(kv, existing.targetEmail, applyUserRating).catch((e: any) =>
        console.warn('[DELETE /admin/reviews] Failed to recalculate rating:', e)
      );
    }

    if (existing.authorEmail) {
      const author: any = await profile.users.get(supabase, existing.authorEmail.toLowerCase().trim());
      if (author && !(await throttleEmail(existing.authorEmail, `review-removed-${reviewId}`, 3_600_000))) {
        const tpl = adminActionTemplate({
          firstName: author.firstName || 'Пользователь',
          title: 'ваш отзыв удалён',
          message: 'Ваш отзыв удалён администратором платформы в рамках модерации.',
          email: existing.authorEmail,
        });
        sendEmail({ to: existing.authorEmail, subject: tpl.subject, html: tpl.html }).catch(() => {});
      }
    }

    await CargoAuditLog.record({ action: 'review.admin_delete', actorEmail: adminActor(c), targetId: reviewId, targetType: 'review', details: { targetEmail: existing.targetEmail, authorEmail: existing.authorEmail } });
    console.log(`[DELETE /admin/reviews] Admin removed review ${reviewId}`);
    return c.json({ success: true });
  } catch (err) {
    console.log("Error DELETE /admin/reviews/:reviewId:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// ✅ Admin: get ALL documents across all users with signed URLs
app.get("/make-server-4e36197a/admin/documents", async (c) => {
  try {
    const usersByEmail = new Map<string, any>();
    for (const u of await profile.users.listAll(supabase)) usersByEmail.set(u.email, u);

    // Номер документа админ видит расшифрованным (listAllForAdmin), ссылка на скан — на час.
    const allDocs = await Promise.all(
      (await profile.documents.listAllForAdmin(supabase)).map(async (doc: any) => {
        const email = doc.userEmail;
        const user = usersByEmail.get(email);
        let photoUrl = null;
        if (doc.photoPath) {
          try {
            const { data } = await supabase.storage.from(BUCKET).createSignedUrl(doc.photoPath, 3600);
            photoUrl = data?.signedUrl || null;
          } catch {}
        }
        return {
          ...doc,
          photoUrl,
          driverName: `${user?.firstName || ""} ${user?.lastName || ""}`.trim() || email,
          driverPhone: user?.phone || "",
          driverEmail: email,
        };
      })
    );
    const sorted = allDocs.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
    console.log(`[admin/documents] Returning ${sorted.length} documents`);
    return c.json({ documents: sorted });
  } catch (err) {
    console.log("Error GET /admin/documents:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// ✅ Admin: approve/reject document and update user verified status
app.put("/make-server-4e36197a/admin/documents/:documentId/status", async (c) => {
  try {
    const documentId = c.req.param("documentId");
    const { status, userEmail, notes } = await c.req.json();
    if (!status || !userEmail) return c.json({ error: "status and userEmail required" }, 400);
    if (!(DOCUMENT_STATUSES as readonly string[]).includes(status)) {
      return c.json({ error: `status must be one of: ${DOCUMENT_STATUSES.join(', ')}` }, 400);
    }
    const existing: any = await profile.documents.setStatus(supabase, userEmail, documentId, status,
      { ...(notes ? { adminNotes: notes } : {}), reviewedAt: new Date().toISOString() });
    if (!existing) return c.json({ error: "Document not found" }, 404);
    const updated = existing;
    const user: any = status === "verified" || status === "approved"
      ? await profile.users.patch(supabase, userEmail, { isVerified: true, documentsVerified: true })
      : await profile.users.get(supabase, userEmail);
    if ((status === "verified" || status === "approved" || status === "rejected") && user) {
      if (!(await throttleEmail(userEmail, `document-${status}-${documentId}`, 3_600_000))) {
        const tpl = documentStatusTemplate({
          firstName: user.firstName || 'Пользователь',
          documentType: existing.type || 'Документ',
          approved: status === "verified" || status === "approved",
          reason: notes,
          email: userEmail,
        });
        sendEmail({ to: userEmail, subject: tpl.subject, html: tpl.html }).catch(() => {});
      }
    }
    await CargoAuditLog.record({ action: 'document.admin_status_change', actorEmail: adminActor(c), targetId: documentId, targetType: 'document', details: { userEmail, status, notes } });
    console.log(`[admin/documents] ${documentId} for ${userEmail} → ${status}`);
    return c.json({ success: true, document: updated });
  } catch (err) {
    console.log("Error PUT /admin/documents/:id/status:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// Сброс документа админом: удаляем файл и запись, после чего пользователь может
// загрузить документ заново. Обычный DELETE /documents/:id требует, чтобы
// callerEmail совпадал с владельцем, поэтому админу он не подходит.
app.delete("/make-server-4e36197a/admin/documents/:documentId", async (c) => {
  try {
    const documentId = c.req.param("documentId");
    const { userEmail } = await c.req.json();
    if (!userEmail) return c.json({ error: "userEmail required" }, 400);

    const existing: any = await profile.documents.get(supabase, userEmail, documentId);
    if (!existing) return c.json({ error: "Document not found" }, 404);

    // Скан содержит персональные данные — удаляем вместе с записью.
    if (existing.photoPath) {
      try {
        await supabase.storage.from(BUCKET).remove([existing.photoPath]);
      } catch (rmErr) {
        console.warn('[admin/documents] Не удалось удалить файл скана:', rmErr);
      }
    }
    await profile.documents.remove(supabase, userEmail, documentId);

    await CargoAuditLog.record({ action: 'document.admin_reset', actorEmail: adminActor(c), targetId: documentId, targetType: 'document', details: { userEmail } });
    console.log(`[admin/documents] Сброшен документ ${documentId} у ${userEmail}`);
    return c.json({ success: true });
  } catch (err) {
    console.log("Error DELETE /admin/documents/:id:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// ✅ Admin: load settings from KV
app.get("/make-server-4e36197a/admin/settings", async (c) => {
  try {
    const settings = await kv.get("ovora:admin:settings");
    return c.json({ settings: settings || {} });
  } catch (err) {
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// ✅ Admin: save settings to KV
app.put("/make-server-4e36197a/admin/settings", async (c) => {
  try {
    const body = await c.req.json();
    await kv.set("ovora:admin:settings", { ...body, updatedAt: new Date().toISOString() });
    await CargoAuditLog.record({ action: 'settings.admin_update', actorEmail: adminActor(c), targetType: 'settings', details: { fields: Object.keys(body) } });
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// ✅ Admin: block/unblock user
// ── Разовая досылка данных в Supabase Auth ───────────────────────────────────
// Имя и телефон уходят в Auth при регистрации и правке профиля. У тех, кто
// зарегистрировался раньше, карточка в дашборде так и осталась пустой —
// эта кнопка догоняет их одним проходом. Только главный админ.
app.post("/make-server-4e36197a/admin/auth/sync-identities", requireRole(['super-admin']), async (c) => {
  try {
    const users: any[] = await profile.users.listAll(supabase);
    let synced = 0, skipped = 0;

    for (const u of users) {
      if (!u?.email) { skipped++; continue; }
      const displayName = buildDisplayName(u);
      if (!displayName && !u.phone) { skipped++; continue; }
      await syncAuthIdentity(u.email, {
        displayName,
        phone   : u.phone,
        role    : u.role,
        platform: 'cargo',
      });
      synced++;
    }

    console.log(`[AuthIdentity] досылка завершена: ${synced} обновлено, ${skipped} без данных`);
    return c.json({ success: true, synced, skipped, total: users.length });
  } catch (err) {
    console.log("Error POST /admin/auth/sync-identities:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// ── Устройства входа пользователя CARGO ──────────────────────────────────────
// Показывает, с какого телефона и браузера человек заходит: помогает разбирать
// жалобы «не открывается сайт» и видно, если в аккаунт заходят с разных мест.
// Персональные данные — только под админом (маршрут внутри /admin/*).
app.get("/make-server-4e36197a/admin/users/:email/devices", async (c) => {
  try {
    const email = decodeURIComponent(c.req.param("email")).toLowerCase().trim();
    const log = await getLoginDevices('cargo', email);
    return c.json({ success: true, ...log });
  } catch (err) {
    console.log("Error GET /admin/users/:email/devices:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

app.put("/make-server-4e36197a/admin/users/:email/status", async (c) => {
  try {
    const email = decodeURIComponent(c.req.param("email"));
    const { status } = await c.req.json();
    if (status !== 'active' && status !== 'blocked') return c.json({ error: "status must be active or blocked" }, 400);
    const existing: any = await profile.users.get(supabase, email);
    if (!existing) return c.json({ error: "User not found" }, 404);
    const updated = await profile.users.patch(supabase, email, { status });
    if (!updated) return c.json({ error: "User not found" }, 404);
    // ROOT-6: revoke user JWT tokens when blocking — forces existing tokens to be rejected
    if (status === "blocked" && status !== existing.status) {
      await revokeUserTokens(email);
      console.log(`[Auth] Tokens revoked for ${email} (admin block)`);
    }
    if ((status === "blocked" || status === "active") && status !== existing.status) {
      if (!(await throttleEmail(email, `user-status-${status}`, 3_600_000))) {
        const tpl = userStatusTemplate({
          firstName: existing.firstName || 'Пользователь',
          blocked: status === "blocked",
          email,
        });
        sendEmail({ to: email, subject: tpl.subject, html: tpl.html }).catch(() => {});
      }
    }
    await CargoAuditLog.record({ action: 'user.admin_status_change', actorEmail: adminActor(c), targetId: email, targetType: 'user', details: { status, previousStatus: existing.status } });
    return c.json({ success: true, user: updated });
  } catch (err) {
    console.log("Error PUT /admin/users/:email/status:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// ✅ Admin: delete user (hard delete) + блокировка телефона от повторной регистрации
app.delete("/make-server-4e36197a/admin/users/:email", async (c) => {
  try {
    const email = decodeURIComponent(c.req.param("email"));
    const existing: any = await profile.users.get(supabase, email);
    if (!existing) return c.json({ error: "User not found" }, 404);

    const cleanPhone = String(existing.phone || "").replace(/\D/g, "");
    const normalizedEmail = email.toLowerCase().trim();

    // Порядок важен: отзыв токенов → каскад → удаление записи. Если каскад упадёт,
    // запись ещё существует и админ может повторить — каскад идемпотентен.
    await revokeUserTokens(normalizedEmail);
    const cascade = await cascadeDeletedUser(normalizedEmail);
    console.log(`[DELETE /admin/users] cascade for ${normalizedEmail}: ${JSON.stringify(cascade)}`);

    await profile.users.remove(supabase, normalizedEmail);
    if (cleanPhone.length >= 7) {
      await Blacklist.add(cleanPhone, {
        reason: "Удалён администратором",
        blockedBy: "admin",
        source: "cargo",
        originalEmail: existing.email,
        originalRole: existing.role,
        originalName: `${existing.firstName || ""} ${existing.lastName || ""}`.trim(),
      });
    }

    await CargoAuditLog.record({ action: 'user.admin_delete', actorEmail: adminActor(c), targetId: email, targetType: 'user', details: { role: existing.role, blacklisted: cleanPhone.length >= 7 } });
    return c.json({ success: true, blacklisted: cleanPhone.length >= 7 });
  } catch (err) {
    console.log("Error DELETE /admin/users/:email:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// ✅ Admin: чёрный список телефонов (общий для CARGO и AVIA)
app.get("/make-server-4e36197a/admin/blacklist", async (c) => {
  try {
    const entries = await Blacklist.listAll();
    return c.json({ entries });
  } catch (err) {
    console.log("Error GET /admin/blacklist:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

app.delete("/make-server-4e36197a/admin/blacklist/:phone", async (c) => {
  try {
    const phone = decodeURIComponent(c.req.param("phone"));
    await Blacklist.remove(phone);
    await CargoAuditLog.record({ action: 'blacklist.admin_remove', actorEmail: adminActor(c), targetId: phone, targetType: 'blacklist' });
    return c.json({ success: true });
  } catch (err) {
    console.log("Error DELETE /admin/blacklist/:phone:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// ✅ Admin: enhanced stats with full breakdown
app.get("/make-server-4e36197a/admin/stats/full", async (c) => {
  try {
    const [trips, offers, users, reviews]: any[] = await Promise.all([
      store.trips.listAll(supabase),
      store.offers.listAll(supabase),
      profile.users.listAll(supabase),
      kv.getByPrefix("ovora:review:"),
    ]);
    const validTrips = trips.filter((t: any) => t && !t.deletedAt);
    const activeTrips = validTrips.filter((t: any) => t.status === 'active');
    const validUsers = users.filter((u: any) => u);
    const drivers = validUsers.filter((u: any) => u.role === 'driver');
    const senders = validUsers.filter((u: any) => u.role === 'sender');
    const validOffers = offers.filter((o: any) => o);
    const pendingOffers = validOffers.filter((o: any) => o.status === 'pending');
    const acceptedOffers = validOffers.filter((o: any) => o.status === 'accepted');
    const blockedUsers = validUsers.filter((u: any) => u.status === 'blocked');
    const revenue = acceptedOffers.reduce((sum: number, o: any) => {
      const price = parseFloat(String(o.price || o.totalPrice || 0).replace(/[^0-9.]/g, ''));
      return sum + (isNaN(price) ? 0 : price);
    }, 0);
    return c.json({
      total: {
        trips: validTrips.length,
        offers: validOffers.length,
        users: validUsers.length,
        reviews: reviews.filter((r: any) => r).length,
        drivers: drivers.length,
        senders: senders.length,
        activeTrips: activeTrips.length,
        pendingOffers: pendingOffers.length,
        acceptedOffers: acceptedOffers.length,
        blockedUsers: blockedUsers.length,
        revenue: Math.round(revenue),
      }
    });
  } catch (err) {
    console.log("Error GET /admin/stats/full:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// ✅ Delete all trips (for testing/cleanup)
app.delete("/make-server-4e36197a/admin/trips/deleteAll", async (c) => {
  try {
    const trips: any[] = await store.trips.listAll(supabase);
    let deleted = 0;
    for (const trip of trips) {
      // Вместе с заявками: связь в базе не даст удалить поездку с заявками.
      await store.trips.hardDelete(supabase, trip.id);
      deleted++;
    }
    await CargoAuditLog.record({ action: 'trip.admin_delete_all', actorEmail: adminActor(c), targetType: 'trip', details: { deleted } });
    console.log(`[admin] Deleted ${deleted} trips`);
    return c.json({ success: true, deleted });
  } catch (err) {
    console.log("Error DELETE /admin/trips/deleteAll:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// ✅ Admin: журнал аудита CARGO (зеркало /avia/admin/audit)
app.get("/make-server-4e36197a/admin/audit", async (c) => {
  try {
    const actorEmail = c.req.query("actorEmail") || undefined;
    const targetId = c.req.query("targetId") || undefined;
    const action = c.req.query("action") || undefined;
    const limit = Number(c.req.query("limit")) || 100;
    const offset = Number(c.req.query("offset")) || 0;
    const result = await CargoAuditLog.list({ actorEmail, targetId, action, limit, offset });
    return c.json(result);
  } catch (err) {
    console.log("Error GET /admin/audit:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// Duplicate /stats route removed — first registration above (line ~3279) takes effect in Hono

// ══════════════════════════════════════════════════════════════════════════════
//  TRACKING ROUTES — Active shipment management (no admin required)
//  KV: ovora:shipment:{tripId} → ActiveShipment object
// ══════════════════════════════════════════════════════════════════════════════

// NOTE: /tracking/user/:email must be registered BEFORE /tracking/:tripId
// to prevent Hono from matching "user" as a tripId.

// GET all shipments for a user (filtered by role query param)
app.get("/make-server-4e36197a/tracking/user/:email", async (c) => {
  try {
    const email = decodeURIComponent(c.req.param("email"));
    if (!isActingAs(c, email)) return c.json(FORBIDDEN_NOT_YOU, 403);
    const role = c.req.query("role") as 'driver' | 'sender' | undefined;
    const values: any[] = await kv.getByPrefix("ovora:shipment:");
    const filtered = values
      .filter(s => {
        if (!s) return false;
        if (role === 'driver') return s.driverEmail === email;
        if (role === 'sender') return s.senderEmail === email;
        return s.driverEmail === email || s.senderEmail === email;
      })
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return c.json({ values: filtered });
  } catch (err) {
    console.log("Error GET /tracking/user/:email:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// GET shipment by tripId — только водитель или отправитель этой поставки
app.get("/make-server-4e36197a/tracking/:tripId", async (c) => {
  try {
    const tripId = c.req.param("tripId");
    const callerEmail = actingAs(c, c.req.query("callerEmail")).toLowerCase().trim();
    if (!callerEmail) return c.json({ error: "callerEmail is required" }, 400);

    const value: any = await kv.get(`ovora:shipment:${tripId}`);
    if (!value) return c.json({ value: null });

    const driverEmail = (value.driverEmail || "").toLowerCase().trim();
    const senderEmail = (value.senderEmail || "").toLowerCase().trim();
    if ((driverEmail && driverEmail !== callerEmail) && (senderEmail && senderEmail !== callerEmail)) {
      console.warn(`[GET /tracking] IDOR attempt: ${callerEmail} tried to read shipment ${tripId}`);
      return c.json({ error: "Forbidden" }, 403);
    }

    return c.json({ value });
  } catch (err) {
    console.log("Error GET /tracking/:tripId:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// PUT (save/update) shipment — merges with existing data; только участники поставки
app.put("/make-server-4e36197a/tracking/:tripId", async (c) => {
  try {
    const tripId = c.req.param("tripId");
    const body = await c.req.json();
    const callerEmail = String(getCallerEmail(c, body) || "").toLowerCase().trim();
    if (!callerEmail) return c.json({ error: "Authentication required: callerEmail missing" }, 401);

    const now = new Date().toISOString();
    const key = `ovora:shipment:${tripId}`;
    const existing: any = await kv.get(key) || {};

    // Если поставка уже существует — звонящий должен быть её водителем или отправителем.
    // Если поставка создаётся впервые — звонящий должен быть тем, кем себя называет в теле запроса.
    const existingDriver = (existing.driverEmail || "").toLowerCase().trim();
    const existingSender = (existing.senderEmail || "").toLowerCase().trim();
    if (existingDriver || existingSender) {
      if (existingDriver !== callerEmail && existingSender !== callerEmail) {
        console.warn(`[PUT /tracking] IDOR attempt: ${callerEmail} tried to update shipment ${tripId}`);
        return c.json({ error: "Forbidden" }, 403);
      }
    } else {
      const bodyDriver = String((body as any).driverEmail || "").toLowerCase().trim();
      const bodySender = String((body as any).senderEmail || "").toLowerCase().trim();
      if (bodyDriver !== callerEmail && bodySender !== callerEmail) {
        console.warn(`[PUT /tracking] IDOR attempt: ${callerEmail} tried to create shipment ${tripId} for another user`);
        return c.json({ error: "Forbidden" }, 403);
      }
    }

    const { callerEmail: _ignored, ...cleanedBody } = body as any;
    const value = {
      ...existing,
      ...cleanedBody,
      tripId,
      updatedAt: now,
      createdAt: existing.createdAt || cleanedBody.createdAt || now,
    };
    await kv.set(key, value);
    return c.json({ success: true, value });
  } catch (err) {
    console.log("Error PUT /tracking/:tripId:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// DELETE shipment (hard delete from KV) — не используется клиентом, только админ
app.delete("/make-server-4e36197a/tracking/:tripId", requireAdminChecked, async (c) => {
  try {
    const tripId = c.req.param("tripId");
    await kv.del(`ovora:shipment:${tripId}`);
    return c.json({ success: true });
  } catch (err) {
    console.log("Error DELETE /tracking/:tripId:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  TRACKING: STATUS UPDATE — смена статуса груза + push к отправителю
//  KV: ovora:shipment:{tripId} → обновляем status + statusHistory
// ══════════════════════════════════════════════════════════════════════════════

const CARGO_STATUS_LABELS: Record<string, string> = {
  pending:   'Ожидает погрузки',
  loaded:    'Груз загружен',
  inProgress:'В пути',
  customs:   'На таможне',
  arrived:   'Прибыл в пункт назначения',
  delivered: 'Доставлен',
  completed: 'Доставлен',
  cancelled: 'Отменено',
};

app.post("/make-server-4e36197a/tracking/:tripId/status", async (c) => {
  try {
    const tripId = c.req.param("tripId");
    const { status, driverEmail: _claimedDriver } = await c.req.json();
    const driverEmail = actingAs(c, _claimedDriver);
    if (!status) return c.json({ error: 'status required' }, 400);
    if (!driverEmail) return c.json({ error: 'driverEmail is required' }, 400);

    const key = `ovora:shipment:${tripId}`;
    const existing: any = await kv.get(key);
    if (!existing) return c.json({ error: 'Shipment not found' }, 404);

    // IDOR guard — менять статус может только назначенный водитель этой поставки
    if (existing.driverEmail && String(existing.driverEmail).toLowerCase().trim() !== String(driverEmail).toLowerCase().trim()) {
      console.warn(`[POST /tracking/status] IDOR attempt: ${driverEmail} tried to update shipment ${tripId} owned by ${existing.driverEmail}`);
      return c.json({ error: 'Forbidden: you are not the driver of this shipment' }, 403);
    }

    // ✅ FIX: «Завершить поездку» закрывала рейс без таможни и фото — кнопка
    // на фронте была активна с самого начала поездки. Дублируем проверку на
    // бэкенде (defense in depth), чтобы прямой вызов API тоже не мог обойти
    // обязательные этапы.
    if (status === 'delivered') {
      const podPhotos = existing.podPhotos || [];
      const hasLoading = podPhotos.some((p: any) => p.type === 'loading');
      const hasUnloading = podPhotos.some((p: any) => p.type === 'unloading');
      const passedCustoms = existing.status === 'customs' || existing.status === 'arrived' || existing.status === 'delivered'
        || (existing.statusHistory || []).some((h: any) => h.status === 'customs');
      if (!hasLoading || !hasUnloading || !passedCustoms) {
        return c.json({ error: 'INCOMPLETE_SHIPMENT', message: 'Нельзя завершить поездку: требуется таможенный контроль и фото загрузки/выгрузки' }, 400);
      }
    }

    const now = new Date().toISOString();
    const historyEntry = { status, timestamp: now, driverEmail: driverEmail || existing.driverEmail };
    const statusHistory = [...(existing.statusHistory || []), historyEntry];

    const updated = { ...existing, status, statusHistory, updatedAt: now };
    await kv.set(key, updated);

    // Push-уведомление отправителю
    const label = CARGO_STATUS_LABELS[status] || status;
    if (existing.senderEmail) {
      sendPushToUser(existing.senderEmail, {
        title: `📦 ${label}`,
        body: `${existing.from} → ${existing.to}`,
        url: '/tracking',
        tag: `cargo-status-${tripId}`,
      }).catch(e => console.warn('[Status] push failed:', e));
    }

    console.log(`[tracking/status] Trip ${tripId}: ${existing.status} → ${status}`);

    await CargoAuditLog.record({ action: 'tracking.status_change', actorEmail: driverEmail, targetId: tripId, targetType: 'tracking', details: { status, previousStatus: existing.status } });

    return c.json({ success: true, value: updated });
  } catch (err) {
    console.log("Error POST /tracking/:tripId/status:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  TRACKING: POD UPLOAD — фото загрузки/выгрузки (Proof of Delivery)
//  Storage: make-4e36197a-pod/{tripId}/{type}-{ts}.jpg
// ══════════════════════════════════════════════════════════════════════════════

app.post("/make-server-4e36197a/tracking/:tripId/pod",
  rateLimitMiddleware(RL.GENERAL_WRITE, (c) => `pod-upload:${c.req.header('x-forwarded-for') || 'unknown'}`),
  async (c) => {
  try {
    const tripId = c.req.param("tripId");
    const { base64, type, driverEmail: _claimedDriver } = await c.req.json();
    const driverEmail = actingAs(c, _claimedDriver);
    if (!base64 || !type) return c.json({ error: 'base64 and type required' }, 400);
    if (!['loading', 'unloading'].includes(type)) return c.json({ error: 'type must be loading or unloading' }, 400);
    if (!driverEmail) return c.json({ error: 'driverEmail is required' }, 400);

    const key = `ovora:shipment:${tripId}`;
    const existing: any = await kv.get(key);
    if (!existing) return c.json({ error: 'Shipment not found' }, 404);

    // IDOR guard — загружать POD-фото может только назначенный водитель этой поставки
    if (existing.driverEmail && String(existing.driverEmail).toLowerCase().trim() !== String(driverEmail).toLowerCase().trim()) {
      console.warn(`[POST /tracking/pod] IDOR attempt: ${driverEmail} tried to upload POD for shipment ${tripId} owned by ${existing.driverEmail}`);
      return c.json({ error: 'Forbidden: you are not the driver of this shipment' }, 403);
    }

    // base64 → binary
    const base64Data = base64.replace(/^data:image\/[a-z]+;base64,/, '');
    const binaryStr = atob(base64Data);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

    const now = new Date().toISOString();
    const fileName = `${tripId}/${type}-${Date.now()}.jpg`;

    const { error: uploadError } = await supabase.storage
      .from(POD_BUCKET)
      .upload(fileName, bytes, { contentType: 'image/jpeg', upsert: true });

    if (uploadError) {
      console.log('[POD] Upload error:', uploadError);
      throw uploadError;
    }

    // Подписанный URL на 7 дней
    const { data: signedData } = await supabase.storage
      .from(POD_BUCKET)
      .createSignedUrl(fileName, 7 * 24 * 3600);

    const podEntry = {
      type,
      url: signedData?.signedUrl || '',
      path: fileName,
      timestamp: now,
      driverEmail: driverEmail || existing.driverEmail,
    };
    const podPhotos = [...(existing.podPhotos || []), podEntry];
    const updated = { ...existing, podPhotos, updatedAt: now };
    await kv.set(key, updated);

    // Уведомить отправителя
    if (existing.senderEmail) {
      const label = type === 'loading' ? 'Фото загрузки добавлено' : 'Фото выгрузки добавлено';
      sendPushToUser(existing.senderEmail, {
        title: `📷 ${label}`,
        body: `${existing.from} → ${existing.to}`,
        url: '/tracking',
        tag: `pod-${type}-${tripId}`,
      }).catch(e => console.warn('[POD] push failed:', e));
    }

    console.log(`[tracking/pod] ${type} photo uploaded for trip ${tripId}`);

    await CargoAuditLog.record({ action: 'tracking.pod_upload', actorEmail: driverEmail, targetId: tripId, targetType: 'tracking', details: { type } });

    return c.json({ success: true, photo: podEntry });
  } catch (err) {
    console.log("Error POST /tracking/:tripId/pod:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// GET POD photos — обновляем signed URLs
app.get("/make-server-4e36197a/tracking/:tripId/pod", async (c) => {
  try {
    const tripId = c.req.param("tripId");
    const shipment: any = await kv.get(`ovora:shipment:${tripId}`);
    if (!shipment) return c.json({ photos: [] });

    const photos = shipment.podPhotos || [];
    const refreshed = await Promise.all(photos.map(async (p: any) => {
      if (!p.path) return p;
      const { data } = await supabase.storage.from(POD_BUCKET).createSignedUrl(p.path, 7 * 24 * 3600);
      return { ...p, url: data?.signedUrl || p.url };
    }));

    return c.json({ photos: refreshed });
  } catch (err) {
    console.log("Error GET /tracking/:tripId/pod:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  PUBLIC TRACKING — без авторизации (только безопасные поля)
//  Используется на /track/:tripId (публичная ссылка)
// ══════════════════════════════════════════════════════════════════════════════

app.get(
  "/make-server-4e36197a/public/tracking/:tripId",
  rateLimitMiddleware(RL.GENERAL_READ, (c) => `pub-track:${c.req.header('x-forwarded-for') || 'unknown'}`),
  async (c) => {
    try {
    const tripId = c.req.param("tripId");
    const shipment: any = await kv.get(`ovora:shipment:${tripId}`);
    if (!shipment) return c.json({ found: false }, 404);

    // Только публично-безопасные поля — без email и телефона
    const publicData = {
      tripId:              shipment.tripId,
      from:                shipment.from,
      to:                  shipment.to,
      status:              shipment.status,
      statusHistory:       shipment.statusHistory || [],
      driverLat:           shipment.driverLat ?? null,
      driverLng:           shipment.driverLng ?? null,
      fromLat:             shipment.fromLat ?? null,
      fromLng:             shipment.fromLng ?? null,
      toLat:               shipment.toLat ?? null,
      toLng:               shipment.toLng ?? null,
      lastLocationUpdate:  shipment.lastLocationUpdate ?? null,
      startedAt:           shipment.startedAt ?? null,
      updatedAt:           shipment.updatedAt,
      driverName:          shipment.contactName || 'Водитель',
      vehicleType:         shipment.vehicleType || '',
      cargoType:           shipment.cargoType || '',
      podPhotos:           (shipment.podPhotos || []).map((p: any) => ({
        type: p.type, url: p.url, timestamp: p.timestamp,
      })),
    };

    return c.json({ found: true, shipment: publicData });
  } catch (err) {
    console.log("Error GET /public/tracking/:tripId:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  GENERIC KV ROUTES - Для работы с любыми ключами
// ══════════════════════════════════════════════════════════════════���════════════

app.post("/make-server-4e36197a/kv/set", async (c) => {
  try {
    const { key, value } = await c.req.json();
    if (!key) return c.json({ error: "key required" }, 400);
    await kv.set(key, value);
    return c.json({ success: true, value });
  } catch (err) {
    console.log("Error POST /kv/set:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

app.post("/make-server-4e36197a/kv/get", async (c) => {
  try {
    const { key } = await c.req.json();
    if (!key) return c.json({ error: "key required" }, 400);
    const value = await kv.get(key);
    return c.json({ value });
  } catch (err) {
    console.log("Error POST /kv/get:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

app.post("/make-server-4e36197a/kv/getByPrefix", async (c) => {
  try {
    const { prefix } = await c.req.json();
    if (!prefix) return c.json({ error: "prefix required" }, 400);
    const values = await kv.getByPrefix(prefix);
    return c.json({ values });
  } catch (err) {
    console.log("Error POST /kv/getByPrefix:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

app.post("/make-server-4e36197a/kv/del", async (c) => {
  try {
    const { key } = await c.req.json();
    if (!key) return c.json({ error: "key required" }, 400);
    await kv.del(key);
    return c.json({ success: true });
  } catch (err) {
    console.log("Error POST /kv/del:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  NOTIFICATIONS ROUTES
//  KV: ovora:notification:{userEmail}:{id} → notification object
// ══════════════════════════════════════════════════════════════════════════════

const NOTIFICATION_TYPES = new Set(['trip', 'system', 'payment', 'info', 'auth', 'offer', 'message', 'document']);

app.post(
  "/make-server-4e36197a/notifications",
  rateLimitMiddleware(RL.GENERAL_WRITE, (c) => `notif-create:${c.req.header('x-forwarded-for') || 'unknown'}`),
  async (c) => {
  try {
    const body = await c.req.json();
    const { userEmail, type, iconName, iconBg, title, description } = body;
    if (!userEmail || !type || !title) {
      return c.json({ error: "userEmail, type, and title are required" }, 400);
    }
    // Клиент создаёт уведомления только себе (EmailAuth.tsx). Иначе любой отправил бы
    // другому человеку поддельное «оплатите на карту» от имени платформы.
    if (!isActingAs(c, userEmail)) return c.json(FORBIDDEN_NOT_YOU, 403);
    if (!NOTIFICATION_TYPES.has(type)) {
      return c.json({ error: "Invalid notification type" }, 400);
    }
    const recipient = await profile.users.get(supabase, String(userEmail).toLowerCase().trim());
    if (!recipient) {
      return c.json({ error: "User not found" }, 404);
    }

    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    const notification = {
      id,
      userEmail,
      type,
      iconName: iconName || 'Bell',
      iconBg: iconBg || 'bg-blue-500/10 text-blue-500',
      title,
      description: description || '',
      isUnread: true,
      createdAt: now,
    };

    await kv.set(`ovora:notification:${userEmail}:${id}`, notification);
    console.log(`[notifications] Created notification for ${userEmail}:`, title);
    return c.json({ success: true, notification });
  } catch (err) {
    console.log("Error POST /notifications:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});


app.get("/make-server-4e36197a/notifications/:email", async (c) => {
  try {
    const email = decodeURIComponent(c.req.param("email"));
    if (!isActingAs(c, email)) return c.json(FORBIDDEN_NOT_YOU, 403);
    const notifications: any[] = await kv.getByPrefix(`ovora:notification:${email}:`);
    const sorted = notifications
      .filter(n => n)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return c.json({ notifications: sorted });
  } catch (err) {
    console.log("Error GET /notifications/:email:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

app.put("/make-server-4e36197a/notifications/:email/:id/read", async (c) => {
  try {
    const email = decodeURIComponent(c.req.param("email"));
    if (!isActingAs(c, email)) return c.json(FORBIDDEN_NOT_YOU, 403);
    const id = c.req.param("id");
    const key = `ovora:notification:${email}:${id}`;
    const existing: any = await kv.get(key);
    if (!existing) return c.json({ error: "Notification not found" }, 404);
    const updated = { ...existing, isUnread: false };
    await kv.set(key, updated);
    return c.json({ success: true, notification: updated });
  } catch (err) {
    console.log("Error PUT /notifications/:email/:id/read:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

app.put("/make-server-4e36197a/notifications/:email/read-all", async (c) => {
  try {
    const email = decodeURIComponent(c.req.param("email"));
    if (!isActingAs(c, email)) return c.json(FORBIDDEN_NOT_YOU, 403);
    const notifications: any[] = await kv.getByPrefix(`ovora:notification:${email}:`);
    for (const n of notifications) {
      if (n && n.isUnread) {
        await kv.set(`ovora:notification:${email}:${n.id}`, { ...n, isUnread: false });
      }
    }
    return c.json({ success: true });
  } catch (err) {
    console.log("Error PUT /notifications/:email/read-all:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

app.delete("/make-server-4e36197a/notifications/:email/:id", async (c) => {
  try {
    const email = decodeURIComponent(c.req.param("email"));
    if (!isActingAs(c, email)) return c.json(FORBIDDEN_NOT_YOU, 403);
    const id = c.req.param("id");
    await kv.del(`ovora:notification:${email}:${id}`);
    return c.json({ success: true });
  } catch (err) {
    console.log("Error DELETE /notifications/:email/:id:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

app.delete("/make-server-4e36197a/notifications/:email", async (c) => {
  try {
    const email = decodeURIComponent(c.req.param("email"));
    if (!isActingAs(c, email)) return c.json(FORBIDDEN_NOT_YOU, 403);
    const notifications: any[] = await kv.getByPrefix(`ovora:notification:${email}:`);
    for (const n of notifications) {
      if (n && n.id) {
        await kv.del(`ovora:notification:${email}:${n.id}`);
      }
    }
    return c.json({ success: true, deleted: notifications.length });
  } catch (err) {
    console.log("Error DELETE /notifications/:email:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  USER API - Управление профилем пользователя
// ═══════════════════════��══════════════════════════════════════════════════════

/**
 * 👤 Получить пользователя по email
 */
app.get("/make-server-4e36197a/users/:email", async (c) => {
  try {
    const email = decodeURIComponent(c.req.param("email"));
    const user = await profile.users.get(supabase, email);
    
    if (!user) {
      return c.json({ error: "User not found" }, 404);
    }

    const { codeHash: _ch, passportNumber: _pn, passportData: _pd, ...safeUser } = user as any;
    // Сайт запрашивает только свой профиль (UserContext). Чужой — без телефона и даты рождения,
    // как в GET /auth/user/:email: раньше их отдавали любому, кто знает почту.
    if (!isActingAs(c, email)) {
      const { phone: _ph, birthDate: _bd, ...publicUser } = safeUser;
      return c.json({ success: true, user: publicUser });
    }
    return c.json({ success: true, user: safeUser });
  } catch (err) {
    console.log("Error GET /users/:email:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

/**
 * ✏️ Обновить пользователя
 */
app.put("/make-server-4e36197a/users/:email", async (c) => {
  try {
    const email = decodeURIComponent(c.req.param("email"));
    const body = await c.req.json();
    const { callerEmail: _claimedCaller, ...rawUpdates } = body as any;
    const callerEmail = actingAs(c, _claimedCaller);
    if (!callerEmail) return c.json({ error: "callerEmail is required" }, 400);
    if (callerEmail.toLowerCase().trim() !== email.toLowerCase().trim()) {
      console.warn(`[users/update] IDOR attempt: ${callerEmail} tried to update ${email}`);
      return c.json({ error: "Forbidden: you can only update your own profile" }, 403);
    }

    const existingUser: any = await profile.users.get(supabase, email);

    if (!existingUser) {
      console.log(`[users/update] User not found: ${email}`);
      return c.json({ error: "User not found" }, 404);
    }

    // Strip protected fields — prevents privilege escalation
    const updates: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rawUpdates)) {
      if (!USER_PROTECTED_FIELDS.has(k)) updates[k] = v;
    }

    const updatedUser: any = await profile.users.patch(supabase, email, updates);
    if (!updatedUser) return c.json({ error: "User not found" }, 404);

    const { codeHash: _ch, passportNumber: _pn, passportData: _pd, ...safeUser } = updatedUser;
    return c.json({ success: true, user: safeUser });
  } catch (err) {
    console.log("Error PUT /users/:email:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  AVATAR UPLOAD
//  POST /users/:email/avatar  — multipart/form-data { avatar: File }
// ══════════════════════════════════════════════════════════════════════════════

app.post("/make-server-4e36197a/users/:email/avatar", async (c) => {
  try {
    const email = decodeURIComponent(c.req.param("email")).toLowerCase().trim();
    console.log(`[avatar/upload] Uploading avatar for user: ${email}`);

    const form = await c.req.formData();
    const file = form.get("avatar") as File | null;
    const callerEmail = actingAs(c, form.get("callerEmail")).toLowerCase().trim();

    if (!callerEmail) return c.json({ error: "callerEmail is required" }, 400);
    if (callerEmail !== email) {
      console.warn(`[avatar/upload] IDOR attempt: ${callerEmail} tried to upload avatar for ${email}`);
      return c.json({ error: "Forbidden: you can only update your own avatar" }, 403);
    }

    if (!file || !file.size) {
      return c.json({ error: "No avatar file provided" }, 400);
    }

    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const safeName = email.replace(/[@.]/g, "_");
    const path = `${safeName}/${Date.now()}.${ext}`;

    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    const { error: uploadError } = await supabase.storage
      .from(AVATAR_BUCKET)
      .upload(path, bytes, { contentType: file.type || "image/jpeg", upsert: true });

    if (uploadError) {
      console.log(`[avatar/upload] Storage upload error:`, uploadError.message);
      return c.json({ error: `Storage error: ${uploadError.message}` }, 500);
    }

    const { data: urlData } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
    const avatarUrl = urlData.publicUrl;

    console.log(`[avatar/upload] Uploaded avatar: ${avatarUrl}`);

    // Update user record with new avatarUrl
    if (await profile.users.patch(supabase, email, { avatarUrl })) {
      console.log(`[avatar/upload] User record updated with avatarUrl`);
    }

    return c.json({ success: true, avatarUrl });
  } catch (err) {
    console.log("Error POST /users/:email/avatar:", err);
    return c.json({ error: `Avatar upload failed: ${err}` }, 500);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  OTP AUTHENTICATION — KV store + Gmail SMTP (email) / dev mode (phone)
// ══════════════════════════════════════════════════════════════════════════════

usePermCodeUserLookup((email) => profile.users.get(supabase, email));
app.post("/make-server-4e36197a/auth/send-otp", handleSendOtp);
app.post("/make-server-4e36197a/auth/verify-otp", handleVerifyOtp);

// ── Permanent Crypto Code ──────────────────────────────────────────────────────
app.post("/make-server-4e36197a/auth/email-check", handleEmailCheck);
// Подтверждение почты кодом из письма — обязательный шаг перед установкой PIN
// для нового пользователя (см. permCode.tsx).
app.post("/make-server-4e36197a/auth/send-email-code", handleSendEmailCode);
app.post("/make-server-4e36197a/auth/verify-email-code", handleVerifyEmailCode);
app.post("/make-server-4e36197a/auth/set-code", handleSetCode);
app.post("/make-server-4e36197a/auth/verify-perm-code", handleVerifyPermCode);
// 🔒 reset-code удаляет хеш кода пользователя → требует прав админа.
// Без серверной проверки любой по чужому email мог сбросить код и через set-code
// поставить свой (захват аккаунта). UI-гейт isAdmin был только клиентским.
app.post("/make-server-4e36197a/auth/reset-code", requireAdminChecked, handleResetCode);
app.get("/make-server-4e36197a/admin/codes", handleAdminListCodes);

// ══════════════════════════════════════════════════════════════════════════════
//  ADS (BANNERS) ROUTES
//  KV: ovora:ad:{id} → ad object
// ═══════════���══════════════════════════════════════════════════════════════════

// Admin: upload ad media (image or video) to Supabase Storage
app.post("/make-server-4e36197a/admin/ads/upload", requireAdminChecked, async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get("file") as File | null;
    const type = (formData.get("type") as string) || "image"; // "image" | "video"
    if (!file) return c.json({ error: "No file provided" }, 400);

    const ext = file.name.split(".").pop()?.toLowerCase() || "bin";
    const filename = `${type}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const arrayBuffer = await file.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);

    const { error: uploadError } = await supabase.storage
      .from(ADS_BUCKET)
      .upload(filename, uint8, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });

    if (uploadError) {
      console.log("[admin/ads/upload] Upload error:", uploadError);
      return c.json({ error: `Upload failed: ${uploadError.message}` }, 500);
    }

    const { data: urlData } = supabase.storage
      .from(ADS_BUCKET)
      .getPublicUrl(filename);

    const publicUrl = urlData?.publicUrl || "";
    console.log(`[admin/ads/upload] Uploaded ${type}: ${publicUrl}`);
    return c.json({ success: true, url: publicUrl, filename });
  } catch (err) {
    console.log("Error POST /admin/ads/upload:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// Public: get active ads — supports ?placement=welcome|cargo|avia
app.get("/make-server-4e36197a/ads", async (c) => {
  try {
    const placement = c.req.query('placement') || '';
    const ads: any[] = await kv.getByPrefix("ovora:ad:");
    let active = ads.filter(a => a && a.isActive !== false);
    if (placement) {
      active = active.filter((a: any) => {
        if (!a.placement || a.placement === 'all') return true;
        return a.placement === placement;
      });
    }
    active.sort((a: any, b: any) => (a.order ?? 999) - (b.order ?? 999));
    return c.json({ ads: active });
  } catch (err) {
    console.log("Error GET /ads:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// Admin: get all ads (including inactive)
app.get("/make-server-4e36197a/admin/ads", requireAdminChecked, async (c) => {
  try {
    const ads: any[] = await kv.getByPrefix("ovora:ad:");
    const sorted = ads.filter(a => a).sort((a: any, b: any) => (a.order ?? 999) - (b.order ?? 999));
    return c.json({ ads: sorted });
  } catch (err) {
    console.log("Error GET /admin/ads:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// Admin: create new ad
app.post("/make-server-4e36197a/admin/ads", requireAdminChecked, async (c) => {
  try {
    const body = await c.req.json();
    const id = `ad_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const ad = {
      id,
      emoji: body.emoji || "🚚",
      badge: body.badge || "",
      title: body.title || "",
      description: body.description || "",
      image: body.image || "",
      videoUrl: body.videoUrl || "",
      url: body.url || "#",
      isActive: body.isActive !== false,
      order: body.order ?? 0,
      placement: body.placement || "all",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await kv.set(`ovora:ad:${id}`, ad);
    await CargoAuditLog.record({ action: 'ad.admin_create', actorEmail: adminActor(c), targetId: id, targetType: 'ad', details: { placement: ad.placement } });
    console.log(`[admin/ads] Created ad ${id}, placement=${ad.placement}`);
    return c.json({ success: true, ad });
  } catch (err) {
    console.log("Error POST /admin/ads:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// Admin: update ad
app.put("/make-server-4e36197a/admin/ads/:id", requireAdminChecked, async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json();
    const existing: any = await kv.get(`ovora:ad:${id}`);
    if (!existing) return c.json({ error: "Ad not found" }, 404);
    const updated = { ...existing, ...body, id, updatedAt: new Date().toISOString() };
    await kv.set(`ovora:ad:${id}`, updated);
    await CargoAuditLog.record({ action: 'ad.admin_update', actorEmail: adminActor(c), targetId: id, targetType: 'ad', details: { fields: Object.keys(body) } });
    console.log(`[admin/ads] Updated ad ${id}`);
    return c.json({ success: true, ad: updated });
  } catch (err) {
    console.log("Error PUT /admin/ads/:id:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// Admin: delete ad
app.delete("/make-server-4e36197a/admin/ads/:id", requireAdminChecked, async (c) => {
  try {
    const id = c.req.param("id");
    await kv.del(`ovora:ad:${id}`);
    await CargoAuditLog.record({ action: 'ad.admin_delete', actorEmail: adminActor(c), targetId: id, targetType: 'ad' });
    console.log(`[admin/ads] Deleted ad ${id}`);
    return c.json({ success: true });
  } catch (err) {
    console.log("Error DELETE /admin/ads/:id:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  PAYMENTS — вычисляются на сервере из реальных trips + offers
//  GET /payments/:email?role=driver|sender
// ══════════════════════════════════════════════════════════════════════════════

app.get("/make-server-4e36197a/payments/:email", async (c) => {
  try {
    const email = decodeURIComponent(c.req.param("email")).toLowerCase().trim();
    const callerEmail = actingAs(c, c.req.query("callerEmail")).toLowerCase().trim();
    if (!callerEmail || callerEmail !== email) {
      return c.json({ error: 'Forbidden' }, 403);
    }
    const role = c.req.query("role") || "sender";
    console.log(`[payments] Computing payments for ${email}, role=${role}`);

    // Водителю — заявки на его поездки, отправителю — его заявки и поездки, на которые они поданы.
    const allOffers: any[] = role === "driver"
      ? await store.offers.listByDriver(supabase, email)
      : await store.offers.listBySender(supabase, email);
    const allTrips: any[] = role === "driver"
      ? await store.trips.listByDriver(supabase, email)
      : await store.trips.getMany(supabase, [...new Set(allOffers.map(o => String(o.tripId)))]);

    const result: any[] = [];

    if (role === "driver") {
      const driverTrips = allTrips.filter(t => t && !t.deletedAt && t.driverEmail === email);
      const driverTripIds = new Set(driverTrips.map(t => String(t.id)));

      for (const offer of allOffers) {
        if (!offer || !driverTripIds.has(String(offer.tripId))) continue;
        const trip = driverTrips.find(t => String(t.id) === String(offer.tripId));
        if (!trip) continue;
        const amount = Number(offer.price || offer.totalPrice || 0);
        const status = offer.status || "pending";
        if ((status === "accepted" || status === "completed") && amount > 0) {
          result.push({
            id: `income-${offer.offerId || offer.id}`,
            type: "income",
            title: (offer.requestedSeats || 0) > 0 ? "Оплата за место" : "Оплата за груз",
            description: `${trip.from} → ${trip.to}`,
            amount,
            date: offer.createdAt || trip.date || "",
            status: status === "completed" ? "completed" : "pending",
            person: offer.senderName || "Отправитель",
            personLabel: "Отправитель",
            seats: offer.requestedSeats || 0,
            cargoKg: offer.requestedCargo || 0,
          });
        } else if ((status === "cancelled" || status === "rejected" || status === "declined") && amount > 0) {
          result.push({
            id: `refund-${offer.offerId || offer.id}`,
            type: "expense",
            title: "Возврат по отмене",
            description: `${trip.from} → ${trip.to}`,
            amount: -amount,
            date: offer.createdAt || trip.date || "",
            status: "completed",
            person: offer.senderName || "Отправитель",
            personLabel: "Отправитель",
          });
        }
      }
    } else {
      const senderOffers = allOffers.filter(o => o && o.senderEmail === email);
      for (const offer of senderOffers) {
        const trip = allTrips.find(t => t && String(t.id) === String(offer.tripId) && !t.deletedAt);
        if (!trip) continue;
        const amount = Number(offer.price || offer.totalPrice || 0);
        if (amount <= 0) continue;
        const status = offer.status || "pending";
        if (status === "accepted" || status === "completed") {
          result.push({
            id: `exp-${offer.offerId || offer.id}`,
            type: "expense",
            title: (offer.requestedSeats || 0) > 0 ? "Оплата за место" : "Оплата за груз",
            description: `${trip.from} → ${trip.to}`,
            amount: -amount,
            date: offer.createdAt || trip.date || "",
            status: status === "completed" ? "completed" : "pending",
            person: trip.driverName || "Водитель",
            personLabel: "Водитель",
            seats: offer.requestedSeats || 0,
            cargoKg: offer.requestedCargo || 0,
          });
        } else if (status === "cancelled" || status === "rejected" || status === "declined") {
          result.push({
            id: `ret-${offer.offerId || offer.id}`,
            type: "income",
            title: "Возврат по отмене",
            description: `${trip.from} → ${trip.to}`,
            amount,
            date: offer.createdAt || trip.date || "",
            status: "completed",
            person: trip.driverName || "Водитель",
            personLabel: "Водитель",
          });
        }
      }
    }

    result.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    console.log(`[payments] Returning ${result.length} payments for ${email}`);
    return c.json({ payments: result });
  } catch (err) {
    console.log("Error GET /payments/:email:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  USER STATS — рейтинг, количество поездок и отзывов из реального KV
//  GET /users/:email/stats?role=driver|sender
// ══════════════════════════════════════════════════════════════════════════════

app.get("/make-server-4e36197a/users/:email/stats", async (c) => {
  try {
    const email = decodeURIComponent(c.req.param("email")).toLowerCase().trim();
    const role = c.req.query("role") || "sender";
    console.log(`[user-stats] Computing stats for ${email}, role=${role}`);

    const allReviews: any[] = await kv.getByPrefix("ovora:review:");

    let tripCount = 0;
    if (role === "driver") {
      tripCount = (await store.trips.listByDriver(supabase, email)).filter(t => !t.deletedAt).length;
    } else {
      tripCount = (await store.offers.listBySender(supabase, email))
        .filter(o => o.status === "accepted" || o.status === "completed").length;
    }

    const receivedReviews = allReviews.filter(r => r && r.targetEmail === email);
    const reviewCount = receivedReviews.length;
    const avgRating = calculateAverageRating(receivedReviews.map(r => r.rating));

    console.log(`[user-stats] trips=${tripCount}, reviews=${reviewCount}, avg=${avgRating.toFixed(2)}`);
    return c.json({
      tripCount,
      reviewCount,
      avgRating,
      reviews: receivedReviews.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    });
  } catch (err) {
    console.log("Error GET /users/:email/stats:", err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  BORDERS — статус КПП + краудсорсинг
// ══════════════════════════════════════════════════════════════════════════════

const DEFAULT_BORDERS = [
  { id: 'verkhniy-lars',   name: 'Верхний Ларс',      from: 'Россия',      to: 'Грузия',       status: 'congested', queueMin: 180, queueTrucks: 120, route: 'Военно-Грузинская дорога' },
  { id: 'nizhniy-zaramag', name: 'Нижний Зарамаг',     from: 'Россия',      to: 'Ю.Осетия',     status: 'open',      queueMin: 20,  queueTrucks: 5,   route: 'Транскавказская магистраль' },
  { id: 'yarag-kazmalyar', name: 'Яраг-Казмаляр',      from: 'Россия',      to: 'Азербайджан',  status: 'open',      queueMin: 45,  queueTrucks: 30,  route: 'М-29 Кавказ' },
  { id: 'sagarchin',       name: 'Сагарчин',            from: 'Россия',      to: 'Казахстан',    status: 'open',      queueMin: 30,  queueTrucks: 15,  route: 'М-5 Урал' },
  { id: 'mashtakovo',      name: 'Маштаково',           from: 'Россия',      to: 'Казахстан',    status: 'congested', queueMin: 90,  queueTrucks: 60,  route: 'М-32' },
  { id: 'panj',            name: 'Нижний Пяндж',        from: 'Таджикистан', to: 'Афганистан',   status: 'closed',    queueMin: 0,   queueTrucks: 0,   route: 'Международный мост' },
  { id: 'dushanbe-oybek',  name: 'Ойбек',               from: 'Таджикистан', to: 'Узбекистан',   status: 'open',      queueMin: 25,  queueTrucks: 10,  route: 'Таджикистан–Узбекистан' },
  { id: 'petuhovo',        name: 'Петухово',             from: 'Россия',      to: 'Казахстан',    status: 'open',      queueMin: 15,  queueTrucks: 8,   route: 'М-51 Байкал' },
];

async function seedBorders() {
  const existing = await kv.getByPrefix('ovora:border:');
  if (existing.filter(b => b).length === 0) {
    const now = new Date().toISOString();
    for (const b of DEFAULT_BORDERS) {
      await kv.set(`ovora:border:${b.id}`, { ...b, updatedAt: now, reportCount: 0 });
    }
    console.log('[borders] Seeded', DEFAULT_BORDERS.length, 'checkpoints');
  }
}
seedBorders().catch(console.warn);

app.get('/make-server-4e36197a/borders', async (c) => {
  try {
    const borders = await kv.getByPrefix('ovora:border:');
    const filtered = borders.filter((b: any) => b && !b.deletedAt);
    return c.json({ borders: filtered });
  } catch (err) {
    console.log('Error GET /borders:', err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

app.post('/make-server-4e36197a/borders/:id/report', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    const { userName, status, queueMin, queueTrucks, text } = body;
    const userEmail = actingAs(c, body.userEmail);
    if (!userEmail) return c.json({ error: 'userEmail required' }, 400);
    const border: any = await kv.get(`ovora:border:${id}`);
    if (!border) return c.json({ error: 'Border not found' }, 404);
    const reportId = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();
    const report = { id: reportId, borderId: id, userEmail, userName: userName || 'Пользователь', status, queueMin, queueTrucks, text, createdAt: now };
    await kv.set(`ovora:border-report:${id}:${reportId}`, report);
    if (status) {
      await kv.set(`ovora:border:${id}`, { ...border, status, queueMin: queueMin ?? border.queueMin, queueTrucks: queueTrucks ?? border.queueTrucks, updatedAt: now, lastReportBy: userName || 'Пользователь', reportCount: (border.reportCount || 0) + 1 });
    }
    return c.json({ success: true, report });
  } catch (err) {
    console.log('Error POST /borders/:id/report:', err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

app.get('/make-server-4e36197a/borders/:id/reports', async (c) => {
  try {
    const id = c.req.param('id');
    const reports: any[] = await kv.getByPrefix(`ovora:border-report:${id}:`);
    const sorted = reports.filter(r => r).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 20);
    return c.json({ reports: sorted });
  } catch (err) {
    console.log('Error GET /borders/:id/reports:', err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  REST STOPS — места отдыха, стоянки, кафе
// ══════════════════════════════════════════════════════════════════════════════

const DEFAULT_REST_STOPS = [
  { id: 'rs-samara-m5',   name: 'Дорожный причал',      route: 'М-5 Урал',           km: 1020, city: 'Самара',          amenities: ['shower','wifi','parking','cafe','24h'],  price: 800,  hasDiscount: true,  discountPct: 20, rating: 4.7, reviewCount: 34 },
  { id: 'rs-ufa-m5',      name: 'Трасса Отель',          route: 'М-5 Урал',           km: 1290, city: 'Уфа',             amenities: ['shower','wifi','parking','cafe'],         price: 1200, hasDiscount: false, discountPct: 0,  rating: 4.4, reviewCount: 18 },
  { id: 'rs-chelyab-m5',  name: 'КомфортПлюс',           route: 'М-5 Урал',           km: 1600, city: 'Челябинск',       amenities: ['shower','parking','cafe','24h'],          price: 600,  hasDiscount: true,  discountPct: 20, rating: 4.2, reviewCount: 27 },
  { id: 'rs-rostov-m4',   name: 'Степной берег',         route: 'М-4 Дон',            km: 1050, city: 'Ростов-на-Дону',  amenities: ['shower','wifi','parking','cafe','24h'],  price: 900,  hasDiscount: true,  discountPct: 20, rating: 4.8, reviewCount: 51 },
  { id: 'rs-voronezh-m4', name: 'Транзит Хаус',          route: 'М-4 Дон',            km: 525,  city: 'Воронеж',         amenities: ['shower','wifi','parking'],                price: 700,  hasDiscount: false, discountPct: 0,  rating: 4.0, reviewCount: 12 },
  { id: 'rs-dushanbe-1',  name: 'Чорраха',                route: 'Трасса Душанбе',     km: 0,    city: 'Душанбе',         amenities: ['shower','wifi','parking','cafe','24h'],  price: 120,  hasDiscount: true,  discountPct: 20, rating: 4.5, reviewCount: 22 },
  { id: 'rs-khujand-1',   name: 'Сугдиён',                route: 'Трасса Худжанд',     km: 0,    city: 'Худжанд',         amenities: ['shower','parking','cafe'],                price: 80,   hasDiscount: false, discountPct: 0,  rating: 4.1, reviewCount: 9  },
  { id: 'rs-kazan-m7',    name: 'ВолгаСтоп',              route: 'М-7 Волга',          km: 780,  city: 'Казань',          amenities: ['shower','wifi','parking','cafe','24h'],  price: 850,  hasDiscount: true,  discountPct: 20, rating: 4.6, reviewCount: 39 },
];

async function seedRestStops() {
  const existing = await kv.getByPrefix('ovora:restplace:');
  if (existing.filter(p => p).length === 0) {
    const now = new Date().toISOString();
    for (const p of DEFAULT_REST_STOPS) {
      await kv.set(`ovora:restplace:${p.id}`, { ...p, createdAt: now, updatedAt: now });
    }
    console.log('[rest-stops] Seeded', DEFAULT_REST_STOPS.length, 'places');
  }
}
seedRestStops().catch(console.warn);

app.get('/make-server-4e36197a/rest-stops', async (c) => {
  try {
    const places: any[] = await kv.getByPrefix('ovora:restplace:');
    const sorted = places.filter(p => p && !p.deletedAt).sort((a, b) => b.rating - a.rating);
    return c.json({ places: sorted });
  } catch (err) {
    console.log('Error GET /rest-stops:', err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

app.post('/make-server-4e36197a/rest-stops/:id/review', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    const { userName, rating, text } = body;
    const userEmail = actingAs(c, body.userEmail);
    if (!userEmail || !rating) return c.json({ error: 'userEmail and rating required' }, 400);
    const place: any = await kv.get(`ovora:restplace:${id}`);
    if (!place) return c.json({ error: 'Place not found' }, 404);
    const reviewId = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();
    await kv.set(`ovora:restplace-review:${id}:${reviewId}`, { id: reviewId, placeId: id, userEmail, userName: userName || 'Пользователь', rating, text, createdAt: now });
    const allReviews: any[] = await kv.getByPrefix(`ovora:restplace-review:${id}:`);
    const newAvg = calculateAverageRating(allReviews.map(r => r.rating));
    await kv.set(`ovora:restplace:${id}`, { ...place, rating: newAvg, reviewCount: allReviews.length, updatedAt: now });
    return c.json({ success: true });
  } catch (err) {
    console.log('Error POST /rest-stops/:id/review:', err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  RADIO CHANNELS — платформенная рация (текст по трассам)
// ══════════════════════════════════════════════════════════════════════════════

const DEFAULT_CHANNELS = [
  { id: 'ch-russia', name: 'Россия',                emoji: '🇷🇺', color: '#5ba3f5', desc: 'Общий канал — внутренние рейсы по России' },
  { id: 'ch-ru-kz',  name: 'Россия → Казахстан',   emoji: '🇰🇿', color: '#00AFCA', desc: 'Сагарчин · Маштаково · Петухово · Троицк' },
  { id: 'ch-ru-uz',  name: 'Россия → Узбекистан',  emoji: '🇺🇿', color: '#1eb854', desc: 'Транзит через Казахстан · Ташкент · Самарканд' },
  { id: 'ch-ru-kg',  name: 'Россия → Кыргызстан',  emoji: '🇰🇬', color: '#e63946', desc: 'Бишкек · Ош · транзит КЗ' },
  { id: 'ch-ru-by',  name: 'Россия → Беларусь',    emoji: '🇧🇾', color: '#d62828', desc: 'М-1 · Смоленск · Брест · Минск' },
  { id: 'ch-ru-tj',  name: 'Россия → Таджикистан', emoji: '🇹🇯', color: '#d97706', desc: 'Душанбе · Худжанд · транзит УЗ/КЗ' },
  { id: 'ch-ru-am',  name: 'Россия → Кавказ',      emoji: '🏔️', color: '#7c3aed', desc: 'Верхний Ларс · Армения · Грузия · Азербайджан' },
  { id: 'ch-ru-cn',  name: 'Россия → Китай',       emoji: '🇨🇳', color: '#dc2626', desc: 'Забайкальск · Маньчжурия · Достык' },
  { id: 'ch-sos',    name: 'SOS / Помощь',          emoji: '🆘', color: '#ef4444', desc: 'Срочная помощь — авария · поломка · опасность' },
];

// Upsert каждый дефолтный канал: если отсутствует — добавить. Уже существующие не перезаписываем (чтобы сохранить createdAt).
async function seedChannels() {
  let created = 0;
  for (const ch of DEFAULT_CHANNELS) {
    const existing = await kv.get(`ovora:radio:channel:${ch.id}`);
    if (!existing) {
      await kv.set(`ovora:radio:channel:${ch.id}`, { ...ch, createdAt: new Date().toISOString() });
      created++;
    }
  }
  if (created > 0) console.log('[radio] Seeded', created, 'new channels');
}
seedChannels().catch(console.warn);

app.get('/make-server-4e36197a/radio/channels', async (c) => {
  try {
    const channels: any[] = await kv.getByPrefix('ovora:radio:channel:');
    const sorted = channels.filter(ch => ch && !ch.deletedAt)
      .sort((a, b) => DEFAULT_CHANNELS.findIndex(d => d.id === a.id) - DEFAULT_CHANNELS.findIndex(d => d.id === b.id));
    return c.json({ channels: sorted });
  } catch (err) {
    console.log('Error GET /radio/channels:', err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

app.get('/make-server-4e36197a/radio/channels/:channelId/messages', async (c) => {
  try {
    const channelId = c.req.param('channelId');
    const before  = parseInt(c.req.query('before') || '0') || 0;
    const limit   = Math.min(parseInt(c.req.query('limit') || '30') || 30, 60);
    const messages: any[] = await kv.getByPrefix(`ovora:radio:msg:${channelId}:`);
    let sorted = messages.filter(m => m).sort((a, b) => (a.ts || 0) - (b.ts || 0));
    if (before > 0) sorted = sorted.filter(m => (m.ts || 0) < before);
    const hasMore = sorted.length > limit;
    const page = sorted.slice(-limit);
    return c.json({ messages: page, hasMore });
  } catch (err) {
    console.log('Error GET /radio/:id/messages:', err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

app.post('/make-server-4e36197a/radio/channels/:channelId/heartbeat', async (c) => {
  try {
    const channelId = c.req.param('channelId');
    const body = await c.req.json();
    const { userName, userRole } = body;
    const userEmail = actingAs(c, body.userEmail);
    if (!userEmail) return c.json({ error: 'userEmail required' }, 400);
    const safeKey = userEmail.replace(/[^a-z0-9]/gi, '_').substring(0, 60);
    await kv.set(`ovora:radio:presence:${channelId}:${safeKey}`, {
      userEmail, userName: userName || 'Аноним', userRole: userRole || 'sender', ts: Date.now(),
    });
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

app.get('/make-server-4e36197a/radio/channels/:channelId/presence', async (c) => {
  try {
    const channelId = c.req.param('channelId');
    const entries: any[] = await kv.getByPrefix(`ovora:radio:presence:${channelId}:`);
    const cutoff = Date.now() - 90_000;
    const users = entries.filter(e => e && (e.ts || 0) > cutoff)
      .sort((a, b) => (b.ts || 0) - (a.ts || 0));
    return c.json({ users, count: users.length });
  } catch (err) {
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

app.post('/make-server-4e36197a/radio/channels/:channelId/messages', async (c) => {
  try {
    const channelId = c.req.param('channelId');
    const body = await c.req.json();
    const { userName, userRole, type, text, audioUrl, audioDuration } = body;
    const userEmail = actingAs(c, body.userEmail);
    const msgType: 'text' | 'voice' = type === 'voice' ? 'voice' : 'text';

    if (!userEmail) return c.json({ error: 'userEmail required' }, 400);
    // Только водители могут писать
    if ((userRole || 'sender') !== 'driver') return c.json({ error: 'Only drivers can write to this channel' }, 403);

    if (msgType === 'text' && !text?.trim()) return c.json({ error: 'text required' }, 400);
    if (msgType === 'voice' && !audioUrl) return c.json({ error: 'audioUrl required' }, 400);

    const channel: any = await kv.get(`ovora:radio:channel:${channelId}`);
    if (!channel) return c.json({ error: 'Channel not found' }, 404);

    const msgId = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();
    const message: any = {
      id: msgId, channelId, userEmail,
      userName: userName || 'Пользователь',
      userRole: userRole || 'driver',
      type: msgType,
      ts: Date.now(), createdAt: now,
    };
    if (msgType === 'text') {
      message.text = String(text).trim().substring(0, 500);
    } else {
      message.audioUrl = String(audioUrl);
      message.audioDuration = Math.min(Math.max(Number(audioDuration) || 0, 0), 60);
    }

    await kv.set(`ovora:radio:msg:${channelId}:${msgId}`, message);
    // Trim: keep last 200
    const allMsgs: any[] = await kv.getByPrefix(`ovora:radio:msg:${channelId}:`);
    if (allMsgs.length > 200) {
      const toDelete = allMsgs.filter(m => m).sort((a, b) => (a.ts || 0) - (b.ts || 0)).slice(0, allMsgs.length - 200);
      await Promise.all(toDelete.map(m => kv.del(`ovora:radio:msg:${channelId}:${m.id}`).catch(() => {})));
    }
    return c.json({ success: true, message });
  } catch (err) {
    console.log('Error POST /radio/:id/messages:', err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// Voice upload: принимает multipart file → загружает в Supabase Storage → возвращает публичный URL
app.post('/make-server-4e36197a/radio/voice-upload', async (c) => {
  try {
    const form = await c.req.formData();
    const file = form.get('file') as File | null;
    const userEmail = actingAs(c, form.get('userEmail'));
    if (!file) return c.json({ error: 'file required' }, 400);
    if (!userEmail) return c.json({ error: 'userEmail required' }, 400);
    if (file.size > 2_000_000) return c.json({ error: 'file too large (max 2MB)' }, 400);

    const ext = (file.name?.split('.').pop() || 'webm').toLowerCase().substring(0, 5);
    const safeEmail = userEmail.replace(/[^a-z0-9]/gi, '_').substring(0, 40);
    const path = `${safeEmail}/${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`;
    const buf = new Uint8Array(await file.arrayBuffer());
    const { error: upErr } = await supabase.storage.from(RADIO_VOICE_BUCKET).upload(path, buf, {
      contentType: file.type || 'audio/webm', upsert: false,
    });
    if (upErr) return c.json({ error: `upload failed: ${upErr.message}` }, 500);
    const { data: pub } = supabase.storage.from(RADIO_VOICE_BUCKET).getPublicUrl(path);
    return c.json({ success: true, audioUrl: pub.publicUrl });
  } catch (err) {
    console.log('Error POST /radio/voice-upload:', err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// DELETE own message (using app.on to avoid 'delete' reserved word issues)
app.on('DELETE', '/make-server-4e36197a/radio/channels/:channelId/messages/:msgId', async (c) => {
  try {
    const channelId = c.req.param('channelId');
    const msgId     = c.req.param('msgId');
    const userEmail = actingAs(c, (await c.req.json()).userEmail);
    if (!userEmail) return c.json({ error: 'userEmail required' }, 400);
    const msg: any = await kv.get(`ovora:radio:msg:${channelId}:${msgId}`);
    if (!msg) return c.json({ error: 'Message not found' }, 404);
    if (msg.userEmail !== userEmail) return c.json({ error: 'Forbidden' }, 403);
    await kv.del(`ovora:radio:msg:${channelId}:${msgId}`);
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// Toggle reaction on message
app.post('/make-server-4e36197a/radio/channels/:channelId/messages/:msgId/react', async (c) => {
  try {
    const channelId = c.req.param('channelId');
    const msgId     = c.req.param('msgId');
    const { userEmail: _claimedUser, emoji } = await c.req.json();
    const userEmail = actingAs(c, _claimedUser);
    if (!userEmail || !emoji) return c.json({ error: 'userEmail and emoji required' }, 400);
    const ALLOWED = ['👍','⚠️','✅','🚛','❤️'];
    if (!ALLOWED.includes(emoji)) return c.json({ error: 'emoji not allowed' }, 400);
    const msg: any = await kv.get(`ovora:radio:msg:${channelId}:${msgId}`);
    if (!msg) return c.json({ error: 'Message not found' }, 404);
    const oldReactions: Record<string, string[]> = msg.reactions || {};
    const users: string[] = oldReactions[emoji] || [];
    const updatedUsers = users.includes(userEmail)
      ? users.filter((u: string) => u !== userEmail)
      : [...users, userEmail];
    const reactions: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(oldReactions)) {
      if (k !== emoji && (v as string[]).length > 0) reactions[k] = v as string[];
    }
    if (updatedUsers.length > 0) reactions[emoji] = updatedUsers;
    await kv.set(`ovora:radio:msg:${channelId}:${msgId}`, { ...msg, reactions });
    return c.json({ success: true, reactions });
  } catch (err) {
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// Report message
app.post('/make-server-4e36197a/radio/channels/:channelId/messages/:msgId/report', async (c) => {
  try {
    const channelId = c.req.param('channelId');
    const msgId     = c.req.param('msgId');
    const { userEmail: _claimedUser, reason } = await c.req.json();
    const userEmail = actingAs(c, _claimedUser);
    if (!userEmail) return c.json({ error: 'userEmail required' }, 400);
    const reportId = `${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
    await kv.set(`ovora:radio:report:${reportId}`, {
      channelId, msgId, reportedBy: userEmail, reason: reason || '', ts: Date.now(),
    });
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  AVIA MODULE — подключается через Repository + Cache + RateLimit архитектуру
//  Изолирован в: aviaRoutes.tsx / aviaRepo.tsx / cache.tsx / rateLimit.tsx
//  MIGRATION: при переходе на SQL — менять только aviaRepo.tsx
// ══════════════════════════════════════════════════════════════════════════════
setupAviaRoutes(app, {
  supabase,
  AVIA_PASSPORT_BUCKET,
  AVATAR_BUCKET,
  POD_BUCKET,
  extractDocumentData,
  sendPushToUser,
});

Deno.serve(app.fetch);



