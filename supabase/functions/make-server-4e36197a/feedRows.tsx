// Преобразование «строка таблицы ↔ JSON API» для отзывов и уведомлений CARGO (MIGR-1, этап 4).
// Чистые функции без базы — покрыты тестами feedRows.test.ts. Формат ответов сайту прежний.

type Json = Record<string, any>;

const iso = (v: unknown): string | null => {
  if (v == null || v === '') return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

function without(obj: Json, keys: string[]): Json {
  const rest: Json = {};
  for (const [k, v] of Object.entries(obj || {})) if (!keys.includes(k) && v !== undefined) rest[k] = v;
  return rest;
}

const norm = (email: unknown) => String(email || '').toLowerCase().trim();

// ── Отзыв ───────────────────────────────────────────────────────────────────
const REVIEW_COLUMNS = ['reviewId', 'authorEmail', 'targetEmail', 'tripId', 'rating', 'createdAt'];

export function reviewToRow(review: Json): Json {
  return {
    id: String(review.reviewId),
    author_email: norm(review.authorEmail),
    target_email: norm(review.targetEmail),
    trip_id: String(review.tripId ?? ''),
    rating: Number(review.rating),
    created_at: iso(review.createdAt) ?? new Date().toISOString(),
    data: without(review, REVIEW_COLUMNS),
  };
}

export function rowToReview(row: Json): Json {
  return {
    ...(row.data || {}),
    reviewId: row.id,
    authorEmail: row.author_email,
    targetEmail: row.target_email,
    tripId: row.trip_id,
    rating: Number(row.rating),
    createdAt: iso(row.created_at),
  };
}

// ── Уведомление ─────────────────────────────────────────────────────────────
const NOTIFICATION_COLUMNS = ['id', 'userEmail', 'type', 'isUnread', 'createdAt'];

export function notificationToRow(email: string, notification: Json): Json {
  return {
    user_email: norm(email),
    id: String(notification.id),
    type: String(notification.type || 'info'),
    is_unread: notification.isUnread !== false,
    created_at: iso(notification.createdAt) ?? new Date().toISOString(),
    data: without(notification, NOTIFICATION_COLUMNS),
  };
}

export function rowToNotification(row: Json): Json {
  return {
    ...(row.data || {}),
    id: row.id,
    userEmail: row.user_email,
    type: row.type,
    isUnread: row.is_unread === true,
    createdAt: iso(row.created_at),
  };
}
