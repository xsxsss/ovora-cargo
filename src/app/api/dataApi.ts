import { projectId, publicAnonKey } from '../../../utils/supabase/info';
import { CSRF_HEADER, CSRF_TOKEN } from './csrfToken';

const BASE = `https://${projectId}.supabase.co/functions/v1/make-server-4e36197a`;

// ── In-memory cache ────────────────────────────────────────────────────────────
// Короткий TTL: снижает дублирующие запросы при навигации между страницами
interface CacheEntry { data: any; ts: number }
const _cache = new Map<string, CacheEntry>();

function cacheGet<T>(key: string, ttlMs: number): T | null {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > ttlMs) { _cache.delete(key); return null; }
  return entry.data as T;
}
function cacheSet(key: string, data: any): void {
  _cache.set(key, { data, ts: Date.now() });
}
export function cacheClear(prefix?: string): void {
  if (!prefix) { _cache.clear(); return; }
  for (const k of _cache.keys()) { if (k.startsWith(prefix)) _cache.delete(k); }
}

const TRIPS_TTL   = 30_000; // 30 сек
const _USER_TTL    = 60_000; // 1 мин
const STATS_TTL   = 120_000; // 2 мин

// Роль cargo-admin/avia-admin аутентифицируется ТОЛЬКО через JWT (X-Admin-Token) —
// у неё нет legacy-кода, совпадающего с ADMIN_ACCESS_CODE. super-admin использует
// JWT, если он выдан (ADMIN_JWT_SECRET настроен), иначе падает на legacy
// X-Admin-Code — это сохраняет текущее прод-поведение без миграции секретов.
function getAdminAuthHeader(): Record<string, string> {
  if (typeof sessionStorage === 'undefined') return {};
  const jwt = sessionStorage.getItem('ovora_admin_jwt');
  if (jwt) return { 'X-Admin-Token': jwt };
  const code = sessionStorage.getItem('ovora_admin_token');
  if (code) return { 'X-Admin-Code': code };
  return {};
}

function getHeaders(path: string, isFormData: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${publicAnonKey}`,
    [CSRF_HEADER]: CSRF_TOKEN,
  };
  if (!isFormData) {
    headers['Content-Type'] = 'application/json';
  }
  // Add admin auth for protected routes via custom header
  const isAdmin = path.startsWith('/admin/') || path.startsWith('/kv/');
  if (isAdmin) {
    Object.assign(headers, getAdminAuthHeader());
  } else if (typeof localStorage !== 'undefined') {
    // Сессионный токен пользователя (X-User-Token). Активируется, когда бэкенд
    // настроен с USER_JWT_SECRET; иначе токена нет и бэкенд работает в legacy-режиме.
    try {
      const userToken = localStorage.getItem('ovora_user_token');
      if (userToken) headers['X-User-Token'] = userToken;
    } catch { /* ignore */ }
  }
  return headers;
}

/** Headers for direct fetch calls in admin components */
export function adminHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${publicAnonKey}`,
    [CSRF_HEADER]: CSRF_TOKEN,
  };
  Object.assign(headers, getAdminAuthHeader());
  return headers;
}

const OFFERS_CACHE_KEY = 'ovora_cached_offers';

/** Retry helper — tries up to `attempts` times with exponential backoff */
async function reqWithRetry(method: string, path: string, body?: any, attempts = 3): Promise<any> {
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000); // 12s timeout
    try {
      const res = await fetch(`${BASE}${path}`, {
        method,
        headers: getHeaders(path, body instanceof FormData),
        body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        const text = await res.text();
        const httpErr: any = new Error(`API ${method} ${path} failed (${res.status}): ${text}`);
        httpErr.status = res.status;
        throw httpErr;
      }
      return res.json();
    } catch (err: any) {
      clearTimeout(timer);
      lastErr = err;
      // Don't retry on explicit HTTP errors (4xx/5xx) — only on network errors
      if (err?.status !== undefined) throw err;
      if (i < attempts - 1) {
        await new Promise(r => setTimeout(r, 800 * (i + 1))); // 800ms, 1600ms backoff
      }
    }
  }
  throw lastErr;
}

async function req(method: string, path: string, body?: any) {
  return reqWithRetry(method, path, body);
}

// ══════════════════════════════════════════════════════════════════
// TRIPS
// ══════════════════════════════════════════════════════════════════

export async function createTrip(trip: any) {
  const data = await req('POST', '/trips', trip);
  cacheClear('trips:'); // сбрасываем кэш поездок
  _mirrorTrips(data.trip, 'add');
  return data.trip;
}

export async function getTrips(): Promise<any[]> {
  // Проверяем in-memory кэш
  const cached = cacheGet<any[]>('trips:all', TRIPS_TTL);
  if (cached) return cached;

  const data = await req('GET', '/trips');
  const activeOnly = (data.trips || []).filter((t: any) =>
    !t.deletedAt && t.status !== 'cancelled' && t.status !== 'completed'
  );
  localStorage.setItem('ovora_published_trips', JSON.stringify(activeOnly));
  cacheSet('trips:all', activeOnly);
  return activeOnly;
}

/** Batch-fetch trips by IDs — includes completed/cancelled */
export async function getTripsByIds(ids: string[]): Promise<any[]> {
  if (!ids.length) return [];
  const data = await req('POST', '/trips/batch', { ids });
  return data.trips || [];
}

/** All trips for a user (driver) — includes completed/cancelled */
export async function getMyTrips(email: string): Promise<any[]> {
  const data = await req('GET', `/trips/my/${encodeURIComponent(email)}`);
  const trips = data.trips || [];
  // Сохраняем ВСЕ рейсы пользователя в отдельный кэш для оффлайна
  localStorage.setItem('ovora_all_trips', JSON.stringify(trips));
  return trips;
}

export async function getTripById(id: string): Promise<any | null> {
  const cacheKey = `trip:${id}`;
  const cached = cacheGet<any>(cacheKey, TRIPS_TTL);
  if (cached) return cached;
  const data = await req('GET', `/trips/${id}`);
  const trip = data.found ? data.trip : null;
  if (trip) cacheSet(cacheKey, trip);
  return trip;
}

export async function updateTrip(id: string, updates: any) {
  const callerEmail = sessionStorage.getItem('ovora_user_email') || '';
  const data = await req('PUT', `/trips/${id}`, { ...updates, callerEmail });
  cacheClear('trips:'); // сбрасываем кэш
  _cache.delete(`trip:${id}`);
  _mirrorTrips(data.trip, 'update');
  return data.trip;
}

export async function deleteTrip(id: string) {
  const callerEmail = sessionStorage.getItem('ovora_user_email') || '';
  await req('DELETE', `/trips/${id}`, { callerEmail });
  cacheClear('trips:');
  _cache.delete(`trip:${id}`);
  _mirrorTrips({ id }, 'delete');
}

function _mirrorTrips(trip: any, action: 'add' | 'update' | 'delete') {
  try {
    const trips: any[] = JSON.parse(localStorage.getItem('ovora_published_trips') || '[]');
    if (action === 'add') {
      localStorage.setItem('ovora_published_trips', JSON.stringify([trip, ...trips]));
    } else if (action === 'update') {
      localStorage.setItem('ovora_published_trips', JSON.stringify(
        trips.map(t => t.id === trip.id ? trip : t)
      ));
    } else {
      localStorage.setItem('ovora_published_trips', JSON.stringify(
        trips.filter(t => t.id !== trip.id)
      ));
    }
  } catch {}
}

// ══════════════════════════════════════════════════════════════════
// CARGOS
// ══════════════════════════════════════════════════════════════════

export async function createCargo(cargo: any) {
  const data = await req('POST', '/cargos', cargo);
  cacheClear('cargos:'); 
  _mirrorCargos(data.cargo, 'add');
  return data.cargo;
}

export async function getCargos(): Promise<any[]> {
  const cached = cacheGet<any[]>('cargos:all', TRIPS_TTL);
  if (cached) return cached;

  const data = await req('GET', '/cargos');
  const activeOnly = (data.cargos || []).filter((t: any) =>
    !t.deletedAt && t.status !== 'cancelled' && t.status !== 'completed'
  );
  localStorage.setItem('ovora_published_cargos', JSON.stringify(activeOnly));
  cacheSet('cargos:all', activeOnly);
  return activeOnly;
}

export async function getMyCargos(email: string): Promise<any[]> {
  const data = await req('GET', `/cargos/my/${encodeURIComponent(email)}`);
  const cargos = data.cargos || [];
  localStorage.setItem('ovora_all_cargos', JSON.stringify(cargos));
  return cargos;
}

export async function getCargoById(id: string): Promise<any | null> {
  const cacheKey = `cargo:${id}`;
  const cached = cacheGet<any>(cacheKey, TRIPS_TTL);
  if (cached) return cached;
  const data = await req('GET', `/cargos/${id}`);
  const cargo = data.found ? data.cargo : null;
  if (cargo) cacheSet(cacheKey, cargo);
  return cargo;
}

export async function updateCargo(id: string, updates: any) {
  const callerEmail = sessionStorage.getItem('ovora_user_email') || '';
  const data = await req('PUT', `/cargos/${id}`, { ...updates, callerEmail });
  cacheClear('cargos:'); 
  _cache.delete(`cargo:${id}`);
  _mirrorCargos(data.cargo, 'update');
  return data.cargo;
}

export async function deleteCargo(id: string) {
  const callerEmail = sessionStorage.getItem('ovora_user_email') || '';
  await req('DELETE', `/cargos/${id}`, { callerEmail });
  cacheClear('cargos:');
  _cache.delete(`cargo:${id}`);
  _mirrorCargos({ id }, 'delete');
}

function _mirrorCargos(cargo: any, action: 'add' | 'update' | 'delete') {
  try {
    const cargos: any[] = JSON.parse(localStorage.getItem('ovora_published_cargos') || '[]');
    if (action === 'add') {
      localStorage.setItem('ovora_published_cargos', JSON.stringify([cargo, ...cargos]));
    } else if (action === 'update') {
      localStorage.setItem('ovora_published_cargos', JSON.stringify(
        cargos.map(t => t.id === cargo.id ? cargo : t)
      ));
    } else {
      localStorage.setItem('ovora_published_cargos', JSON.stringify(
        cargos.filter(t => t.id !== cargo.id)
      ));
    }
  } catch {}
}

// ══════════════════════════════════════════════════════════════════
// OFFERS
// ══════════════════════════════════════════════════════════════════

export async function submitOffer(offer: any) {
  const idempotencyKey = offer.idempotencyKey
    || (typeof crypto !== 'undefined' && crypto.randomUUID?.())
    || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const data = await req('POST', '/offers', { ...offer, idempotencyKey });
  _mirrorOffers(data.offer, 'add');
  return data.offer;
}

export async function getOffersForTrip(tripId: string): Promise<any[]> {
  const data = await req('GET', `/offers/trip/${tripId}`);
  return data.offers || [];
}

export async function getOffersForUser(email: string): Promise<any[]> {
  const data = await req('GET', `/offers/user/${encodeURIComponent(email)}`);
  return data.offers || [];
}

export async function getOffersForDriver(email: string): Promise<any[]> {
  const data = await req('GET', `/offers/driver/${encodeURIComponent(email)}`);
  return data.offers || [];
}

/** Авто-отмена осиротевших pending offers (вызывать периодически, не при каждом GET) */
export async function cleanupOrphanedOffers(driverEmail: string): Promise<number> {
  try {
    const data = await req('POST', '/offers/cleanup', { driverEmail });
    return data.cancelled || 0;
  } catch {
    return 0;
  }
}

export async function updateOffer(tripId: string, offerId: string, updates: any) {
  // Добавляем callerEmail для серверной проверки участника
  const callerEmail = sessionStorage.getItem('ovora_user_email') || '';
  const data = await req('PUT', `/offers/${tripId}/${offerId}`, { ...updates, callerEmail });
  _mirrorOffers(data.offer, 'update');
  return data.offer;
}

function _mirrorOffers(offer: any, action: 'add' | 'update') {
  try {
    const offers: any[] = JSON.parse(localStorage.getItem(OFFERS_CACHE_KEY) || '[]');
    if (action === 'add') {
      localStorage.setItem(OFFERS_CACHE_KEY, JSON.stringify([offer, ...offers]));
    } else {
      localStorage.setItem(OFFERS_CACHE_KEY, JSON.stringify(
        offers.map(o => o.offerId === offer.offerId ? offer : o)
      ));
    }
  } catch {}
}

// ══════════════════════════════════════════════════════════════════
// REVIEWS
// ══════════════════════���═══════════════════════════════════════════

export async function submitReview(review: any) {
  try {
    const data = await req('POST', '/reviews', { ...review, callerEmail: review.authorEmail });
    // Сбрасываем кэш статистики для обоих участников
    if (review.targetEmail) cacheClear(`stats:${review.targetEmail}`);
    if (review.authorEmail) cacheClear(`stats:${review.authorEmail}`);
    return data.review;
  } catch (err: any) {
    // ✅ FIX #3: Обработка дубликата (409) — проверяем реальный HTTP-статус,
    // а не подстроку '409' в тексте сообщения (могла случайно совпасть с
    // содержимым текста ошибки или путём запроса).
    if (err?.status === 409) {
      throw new Error('DUPLICATE_REVIEW');
    }
    throw err;
  }
}

export async function getReviewsForUser(email: string): Promise<any[]> {
  const data = await req('GET', `/reviews/user/${encodeURIComponent(email)}`);
  return data.reviews;
}

export async function getAllReviews(opts?: { minRating?: number; limit?: number }): Promise<any[]> {
  const params = new URLSearchParams();
  if (opts?.minRating !== undefined) params.set('minRating', String(opts.minRating));
  if (opts?.limit !== undefined) params.set('limit', String(opts.limit));
  const qs = params.toString();
  const data = await req('GET', `/reviews${qs ? `?${qs}` : ''}`);
  return data.reviews;
}

// ══════════════════════════════════════════════════════════════════════════════
// CHAT
// ══════════════════════════════════════════════════════════════════════════════

export async function initChat(
  chatId: string,
  participants: string[],
  tripId?: string,
  tripRoute?: string,
  contactInfo?: Record<string, any>,   // { [viewerEmail]: ContactInfo }
  senderInfo?: Record<string, any>,
  tripData?: any, // ✅ Add tripData parameter
  callerEmail?: string,
) {
  await req('POST', '/chat/init', { chatId, participants, tripId, tripRoute, contactInfo, senderInfo, tripData, callerEmail });
}

export async function sendMessage(msg: {
  chatId: string;
  senderId: string;
  senderName: string;
  text?: string;
  type?: 'text' | 'proposal' | 'system';
  proposal?: any;
  from?: 'driver' | 'sender' | 'system';
  senderAvatar?: string;
  participants?: string[];
}) {
  const data = await req('POST', '/chat/message', msg);
  return data.message;
}

export async function getChatMessages(chatId: string, callerEmail: string): Promise<any[]> {
  const data = await req('GET', `/chat/${chatId}/messages?callerEmail=${encodeURIComponent(callerEmail)}`);
  return data.messages;
}

export async function markChatRead(chatId: string, userEmail: string) {
  try {
    await req('PUT', `/chat/${chatId}/read`, { userEmail });
  } catch {
    // Silent fail - marking as read is not critical
  }
}

export async function updateChatProposal(chatId: string, proposalId: string, status: 'accepted' | 'rejected', senderId?: string) {
  const data = await req('PUT', `/chat/${chatId}/proposal/${proposalId}`, { status, senderId });
  return data.message;
}

export async function getUserChats(email: string): Promise<any[]> {
  const data = await req('GET', `/chats/user/${encodeURIComponent(email)}`);
  return data.chats;
}

export async function deleteChatFromDb(chatId: string, callerEmail: string): Promise<void> {
  await req('DELETE', `/chat/${chatId}?callerEmail=${encodeURIComponent(callerEmail)}`);
}

export async function deleteMessageFromDb(chatId: string, msgId: string, callerEmail: string): Promise<void> {
  await req('DELETE', `/chat/${chatId}/message/${msgId}?callerEmail=${encodeURIComponent(callerEmail)}`);
}

// ══════════════════════════════════════════════════════════════════
// DOCUMENTS
// ════════════════════════════════════════════════════════════════

export async function uploadDocument(file: File, email: string, docType: string): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('email', email);
  formData.append('docType', docType);
  const data = await req('POST', '/documents/upload', formData);
  return data.url;
}

export async function getUserDocuments(email: string): Promise<any[]> {
  const data = await req('GET', `/documents/${encodeURIComponent(email)}`);
  return data.docs;
}

// ══════════════════════════════════════════════════════════════════
// NOTIFICATIONS
// ══════════════════════════════════════════════════════════════════

export async function pushNotifToDb(email: string, notification: any) {
  if (!email) return;
  try { await req('POST', '/notifications', { email, notification }); } catch {}
}

export async function getNotificationsFromDb(email: string): Promise<any[]> {
  const data = await req('GET', `/notifications/${encodeURIComponent(email)}`);
  return data.notifications;
}

// ══════════════════════════════════════════════════════════════════
// ADMIN
// ══════════════════════════════════════════════════════════════════

export async function getAdminStats() {
  return req('GET', '/admin/stats');
}

export async function getAdminUsers() {
  const data = await req('GET', '/admin/users');
  return data.users;
}

export async function getBlacklist() {
  const data = await req('GET', '/admin/blacklist');
  return data.entries || [];
}

export async function removeFromBlacklist(phone: string) {
  return req('DELETE', `/admin/blacklist/${encodeURIComponent(phone)}`);
}

export async function getAdminTrips() {
  const data = await req('GET', '/admin/trips');
  return data.trips;
}

export async function getAdminOffers() {
  const data = await req('GET', '/admin/offers');
  return data.offers;
}

export async function getAdminReviews() {
  const data = await req('GET', '/admin/reviews');
  return data.reviews;
}

export async function getAdminShipments() {
  const data = await req('GET', '/admin/shipments');
  return data.shipments;
}

export async function getAdminChats() {
  const data = await req('GET', '/admin/chats');
  return data.chats;
}

export async function getAdminChatMessages(chatId: string) {
  const data = await req('GET', `/admin/chat/${encodeURIComponent(chatId)}/messages`);
  return data.messages;
}

export async function deleteAdminReview(reviewId: string) {
  return req('DELETE', `/admin/reviews/${encodeURIComponent(reviewId)}`);
}

export async function updateAdminOfferStatus(tripId: string, offerId: string, status: string) {
  const data = await req('PUT', `/admin/offers/${encodeURIComponent(tripId)}/${encodeURIComponent(offerId)}/status`, { status });
  return data.offer;
}

export async function getAdminCargos() {
  const data = await req('GET', '/admin/cargos');
  return data.cargos;
}

export async function deleteAdminCargo(cargoId: string) {
  return req('DELETE', `/admin/cargos/${encodeURIComponent(cargoId)}`);
}

export async function updateAdminCargo(cargoId: string, updates: Record<string, unknown>) {
  const data = await req('PUT', `/admin/cargos/${encodeURIComponent(cargoId)}`, updates);
  return data.cargo;
}

export async function searchAdmin(q: string) {
  return req('GET', `/admin/search?q=${encodeURIComponent(q)}`);
}

export async function revokeAllAdminSessions() {
  return req('POST', '/admin/auth/revoke-all');
}

// ── Admin documents ────────────────────────────────────────────────
export async function getAdminDocuments() {
  const data = await req('GET', '/admin/documents');
  return data.documents;
}

export async function updateAdminDocStatus(documentId: string, userEmail: string, status: string, notes?: string) {
  const data = await req('PUT', `/admin/documents/${encodeURIComponent(documentId)}/status`, { status, userEmail, notes });
  return data;
}

// ── Устройства входа пользователя ──────────────────────────────────
/** С какого телефона и браузера человек заходит — для разбора проблем со входом. */
export async function getUserDevices(email: string): Promise<{ current: any | null; history: any[] }> {
  const data = await req('GET', `/admin/users/${encodeURIComponent(email)}/devices`);
  return { current: data.current || null, history: data.history || [] };
}

// ── Admin audit log ───────────────────────────────────────────────
export async function getAdminAudit(filter?: {
  actorEmail?: string; targetId?: string; action?: string; limit?: number; offset?: number;
}) {
  const params = new URLSearchParams();
  if (filter?.actorEmail) params.set('actorEmail', filter.actorEmail);
  if (filter?.targetId)   params.set('targetId', filter.targetId);
  if (filter?.action)     params.set('action', filter.action);
  if (filter?.limit)      params.set('limit', String(filter.limit));
  if (filter?.offset)     params.set('offset', String(filter.offset));
  const qs = params.toString();
  return req('GET', `/admin/audit${qs ? `?${qs}` : ''}`) as Promise<{ entries: any[]; total: number }>;
}

// ── Admin settings ─────────────────────────────────────────────────
export async function getAdminSettings() {
  const data = await req('GET', '/admin/settings');
  return data.settings;
}

export async function saveAdminSettings(settings: any) {
  return req('PUT', '/admin/settings', settings);
}

// ── Ads (Banners) ──────────────────────────────────────────────────
export async function getPublicAds(placement?: string) {
  const query = placement ? `?placement=${encodeURIComponent(placement)}` : '';
  const data = await req('GET', `/ads${query}`);
  return data.ads as any[];
}

export async function getAdminAds() {
  const data = await req('GET', '/admin/ads');
  return data.ads as any[];
}

export async function createAdminAd(ad: any) {
  const data = await req('POST', '/admin/ads', ad);
  return data.ad;
}

export async function updateAdminAd(id: string, ad: any) {
  const data = await req('PUT', `/admin/ads/${encodeURIComponent(id)}`, ad);
  return data.ad;
}

export async function deleteAdminAd(id: string) {
  return req('DELETE', `/admin/ads/${encodeURIComponent(id)}`);
}

export async function uploadAdMedia(file: File, type: 'image' | 'video'): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('type', type);
  const data = await req('POST', '/admin/ads/upload', formData);
  return data.url as string;
}

// ══════════════════════════════════════════════════════════════════
// PAYMENTS — серверные вычисления
// ══════════════════════════════════════════════════════════════════

export async function getUserPayments(email: string, role: 'driver' | 'sender'): Promise<any[]> {
  const data = await req('GET', `/payments/${encodeURIComponent(email)}?role=${role}&callerEmail=${encodeURIComponent(email)}`);
  return data.payments || [];
}

// ══════════════════════════════════════════════════════════════════
// USER STATS — рейтинг, количество поездок и отзывов
// ══════════════════════════════════════════════════════════════════

export async function getUserStats(email: string, role: 'driver' | 'sender'): Promise<{
  tripCount: number;
  reviewCount: number;
  avgRating: number;
  reviews: any[];
}> {
  const cacheKey = `stats:${email}:${role}`;
  const cached = cacheGet<any>(cacheKey, STATS_TTL);
  if (cached) return cached;

  const data = await req('GET', `/users/${encodeURIComponent(email)}/stats?role=${role}`);
  const result = {
    tripCount: data.tripCount || 0,
    reviewCount: data.reviewCount || 0,
    avgRating: data.avgRating || 0,
    reviews: data.reviews || [],
  };
  cacheSet(cacheKey, result);
  return result;
}

export async function getPublicStats(): Promise<{ drivers: number; cities: number; satisfied: number }> {
  const data = await req('GET', '/stats');
  return {
    drivers: data.drivers ?? 0,
    cities: data.cities ?? 0,
    satisfied: data.satisfied ?? 98,
  };
}

// ══════════════════════════════════════════════════════════════════
// CARGO-OFFERS — Driver откликается на груз Sender
// ══════════════════════════════════════════════════════════════════

export async function submitCargoOffer(offer: {
  cargoId: string;
  driverEmail: string;
  driverName: string;
  driverPhone?: string;
  driverAvatar?: string | null;
  price?: number;
  currency?: string;
  notes?: string;
}): Promise<any> {
  const data = await req('POST', '/cargo-offers', offer);
  return data.offer;
}

export async function getCargoOffersForCargo(cargoId: string): Promise<any[]> {
  const data = await req('GET', `/cargo-offers/cargo/${cargoId}`);
  return data.offers || [];
}

export async function getCargoOffersForDriver(email: string): Promise<any[]> {
  const data = await req('GET', `/cargo-offers/driver/${encodeURIComponent(email)}`);
  return data.offers || [];
}

export async function getCargoOffersForSender(email: string): Promise<any[]> {
  const data = await req('GET', `/cargo-offers/sender/${encodeURIComponent(email)}`);
  return data.offers || [];
}

export async function updateCargoOffer(cargoId: string, offerId: string, updates: any): Promise<any> {
  const callerEmail = sessionStorage.getItem('ovora_user_email') || '';
  const data = await req('PUT', `/cargo-offers/${cargoId}/${offerId}`, { ...updates, callerEmail });
  return data.offer;
}