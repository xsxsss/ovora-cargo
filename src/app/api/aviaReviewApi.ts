import { projectId, publicAnonKey } from '../../../utils/supabase/info';
import { CSRF_HEADER, CSRF_TOKEN } from './csrfToken';
import { getAviaSession } from './aviaApi';

const BASE = `https://${projectId}.supabase.co/functions/v1/make-server-4e36197a`;
const BASE_HEADERS = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${publicAnonKey}`,
  [CSRF_HEADER]: CSRF_TOKEN,
};

/** anon key + CSRF + (если есть сессия) X-Avia-Token владельца сессии */
function getHeaders(): Record<string, string> {
  const token = getAviaSession()?.token;
  return token ? { ...BASE_HEADERS, 'X-Avia-Token': token } : BASE_HEADERS;
}

// ── Типы ─────────────────────────────────────────────────────────────────────

export type AviaReviewType = 'like' | 'dislike';

export interface AviaReview {
  id: string;
  dealId: string;
  authorPhone: string;
  authorName?: string;
  recipientPhone: string;
  type: AviaReviewType;
  comment: string;
  authorRole: 'courier' | 'sender';
  createdAt: string;
}

export interface AviaDealReviewedStatus {
  byInitiator?: boolean;
  byRecipient?: boolean;
}

export interface AviaPublicProfile {
  phone: string;
  firstName: string | null;
  lastName: string | null;
  role: 'courier' | 'sender' | null;
  likes: number;
  dislikes: number;
  reviewsCount: number;
  dealsCompleted: number;
  createdAt: string | null;
}

// ── API функции ───────────────────────────────────────────────────────────────

/** Создать отзыв (like/dislike + обязательный комментарий) */
export async function createAviaReview(params: {
  dealId: string;
  authorPhone: string;
  type: AviaReviewType;
  comment: string;
}): Promise<{ success: boolean; review?: AviaReview; error?: string }> {
  try {
    const res = await fetch(`${BASE}/avia/reviews`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        ...params,
        authorPhone: params.authorPhone.replace(/\D/g, ''),
      }),
    });
    const data = await res.json();
    if (res.status === 409) return { success: false, error: data.error };
    if (!res.ok || data.error) return { success: false, error: data.error || 'Ошибка создания отзыва' };
    return { success: true, review: data.review };
  } catch (err: any) {
    return { success: false, error: err.message || 'Ошибка сети' };
  }
}

/** Статус отзывов по списку сделок за один запрос (вместо N запросов per-deal) */
export async function getAviaDealReviewStatusBatch(dealIds: string[]): Promise<Record<string, AviaDealReviewedStatus>> {
  if (dealIds.length === 0) return {};
  try {
    const res = await fetch(`${BASE}/avia/reviews/deal-batch`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ dealIds }),
    });
    if (!res.ok) return {};
    const data = await res.json();
    return data.statuses || {};
  } catch {
    return {};
  }
}

/** Все отзывы о пользователе */
export async function getAviaUserReviews(phone: string): Promise<AviaReview[]> {
  try {
    const clean = phone.replace(/\D/g, '');
    const res = await fetch(`${BASE}/avia/reviews/user/${encodeURIComponent(clean)}`, {
      headers: getHeaders(),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.reviews || [];
  } catch {
    return [];
  }
}

/** Публичный профиль пользователя */
export async function getAviaPublicProfile(phone: string): Promise<{
  profile: AviaPublicProfile;
  reviews: AviaReview[];
} | null> {
  try {
    const clean = phone.replace(/\D/g, '');
    const res = await fetch(`${BASE}/avia/public-profile/${encodeURIComponent(clean)}`, {
      headers: getHeaders(),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data;
  } catch {
    return null;
  }
}