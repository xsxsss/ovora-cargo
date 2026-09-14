import { projectId, publicAnonKey } from '../../../utils/supabase/info';
import { CSRF_HEADER, CSRF_TOKEN } from './csrfToken';
import { withUserToken } from './userToken';

const BASE = `https://${projectId}.supabase.co/functions/v1/make-server-4e36197a`;
const HEADERS = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${publicAnonKey}`,
  [CSRF_HEADER]: CSRF_TOKEN,
};

// ── Типы ─────────────────────────────────────────────────────────────────────

export type SubStatus = 'trial' | 'active' | 'expired' | 'lifetime';

export interface Subscription {
  email: string;
  status: SubStatus;
  trialEndsAt: string | null;   // ISO date
  paidAt: string | null;
  expiresAt: string | null;
  txId?: string;                // ID перевода от пользователя
  activatedBy?: string;         // admin email
  createdAt: string;
}

export interface SubStats {
  totalUsers: number;
  activeSubscriptions: number;
  trialUsers: number;
  expiredUsers: number;
  annualRevenue: number;        // сомони
  costCoverage: number;         // %
}

// ── Расходы платформы (при 5М users / 1М плательщиков) ───────────────────────

export const PLATFORM_COSTS = {
  // При 5М зарегистрированных пользователей
  targetUsers: 5_000_000,
  payingUsers: 1_000_000,
  annualCostUsd: 72_060,

  // Разбивка по статьям (USD/год)
  breakdown: [
    { name: 'Supabase Enterprise (база данных + API)', usd: 36_000 },
    { name: 'Яндекс Карты API', usd: 24_000 },
    { name: 'Push-уведомления (Firebase)', usd: 6_000 },
    { name: 'CDN / хранилище файлов', usd: 2_400 },
    { name: 'Мониторинг и безопасность', usd: 3_600 },
    { name: 'Домен + SSL сертификат', usd: 60 },
  ],

  // Цены в местных валютах (покрывают расходы + 20% запас)
  prices: {
    TJS: 9,    // сомони/год
    RUB: 99,   // рублей/год
    KZT: 490,  // тенге/год
    USD: 1,    // доллар/год
  },

  // Пробный период
  trialDays: 30,
} as const;

// ── Вычисление цены за пользователя ──────────────────────────────────────────

export function calcPricePerUser(
  totalCostUsd: number,
  payingUsers: number,
  exchangeRate: number,
): number {
  return Math.ceil((totalCostUsd / payingUsers) * exchangeRate * 1.2); // +20% запас
}

// ── API вызовы ────────────────────────────────────────────────────────────────

export async function getSubscription(email: string): Promise<Subscription | null> {
  try {
    const res = await fetch(`${BASE}/subscription/${encodeURIComponent(email)}`, {
      headers: withUserToken(HEADERS),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.subscription || null;
  } catch {
    return null;
  }
}

export async function submitPaymentRequest(
  email: string,
  txId: string,
  currency: keyof typeof PLATFORM_COSTS['prices'],
  amount: number,
): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${BASE}/subscription/request`, {
    method: 'POST',
    headers: withUserToken(HEADERS),
    body: JSON.stringify({ email, txId, currency, amount }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Ошибка отправки заявки');
  return data;
}

export async function getSubStats(): Promise<SubStats> {
  const res = await fetch(`${BASE}/admin/subscription/stats`, {
    headers: withUserToken(HEADERS),
  });
  const data = await res.json();
  return data.stats;
}

export async function getAllSubscriptions(): Promise<Subscription[]> {
  const res = await fetch(`${BASE}/admin/subscriptions`, {
    headers: withUserToken(HEADERS),
  });
  const data = await res.json();
  return data.subscriptions || [];
}

export async function activateSubscription(
  email: string,
  adminEmail: string,
): Promise<void> {
  const res = await fetch(`${BASE}/admin/subscription/activate`, {
    method: 'POST',
    headers: withUserToken(HEADERS),
    body: JSON.stringify({ email, adminEmail }),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Ошибка активации');
  }
}

export async function grantLifetime(
  email: string,
  adminEmail: string,
): Promise<void> {
  const res = await fetch(`${BASE}/admin/subscription/lifetime`, {
    method: 'POST',
    headers: withUserToken(HEADERS),
    body: JSON.stringify({ email, adminEmail }),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Ошибка');
  }
}

export async function revokeSubscription(
  email: string,
  adminEmail: string,
): Promise<void> {
  const res = await fetch(`${BASE}/admin/subscription/revoke`, {
    method: 'POST',
    headers: withUserToken(HEADERS),
    body: JSON.stringify({ email, adminEmail }),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Ошибка');
  }
}

// ── Локальный кэш статуса подписки ───────────────────────────────────────────

const SUB_CACHE_KEY = 'ovora_subscription_cache';
const SUB_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 часов

export function getCachedSubscription(): Subscription | null {
  try {
    const raw = localStorage.getItem(SUB_CACHE_KEY);
    if (!raw) return null;
    const { sub, ts }: { sub: Subscription; ts: number } = JSON.parse(raw);
    if (Date.now() - ts > SUB_CACHE_TTL) { localStorage.removeItem(SUB_CACHE_KEY); return null; }
    return sub;
  } catch { return null; }
}

export function cacheSubscription(sub: Subscription): void {
  try {
    localStorage.setItem(SUB_CACHE_KEY, JSON.stringify({ sub, ts: Date.now() }));
  } catch {}
}

export function clearSubscriptionCache(): void {
  localStorage.removeItem(SUB_CACHE_KEY);
}

// ── Хелперы ───────────────────────────────────────────────────────────────────

export function isSubActive(sub: Subscription | null): boolean {
  if (!sub) return false;
  if (sub.status === 'lifetime') return true;
  if (sub.status === 'active') {
    if (!sub.expiresAt) return true;
    return new Date(sub.expiresAt) > new Date();
  }
  if (sub.status === 'trial') {
    if (!sub.trialEndsAt) return true;
    return new Date(sub.trialEndsAt) > new Date();
  }
  return false;
}

export function getDaysLeft(sub: Subscription | null): number {
  if (!sub) return 0;
  const endDate = sub.status === 'trial' ? sub.trialEndsAt : sub.expiresAt;
  if (!endDate) return 0;
  const diff = new Date(endDate).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

export function getStatusLabel(status: SubStatus): string {
  switch (status) {
    case 'trial':    return 'Пробный период';
    case 'active':   return 'Активна';
    case 'expired':  return 'Истекла';
    case 'lifetime': return 'Пожизненная';
  }
}
