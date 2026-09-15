// Отзывы и уведомления CARGO на таблицах Postgres (MIGR-1, этап 4). Возвращает тот же JSON, что раньше
// лежал в KV (feedRows.tsx). Уникальность «один отзыв автора о человеке за поездку» держит база.
import { reviewToRow, rowToReview, notificationToRow, rowToNotification } from "./feedRows.tsx";

type Json = Record<string, any>;
type Db = { from(table: string): any };

const ROWS_LIMIT = 5000;
const norm = (email: string) => String(email || '').toLowerCase().trim();

function check<T>(res: { data: T; error: any }, what: string): T {
  if (res.error) throw new Error(`[feedTables] ${what}: ${res.error.message}`);
  return res.data;
}

// ── Отзывы ──────────────────────────────────────────────────────────────────
export const reviews = {
  async get(db: Db, reviewId: string): Promise<Json | null> {
    const row = check(await db.from('reviews').select('*').eq('id', reviewId).maybeSingle(), 'get review');
    return row ? rowToReview(row) : null;
  },
  /** duplicate — автор уже оставлял отзыв этому человеку за эту поездку. */
  async insert(db: Db, review: Json): Promise<{ review?: Json; duplicate?: true }> {
    const res = await db.from('reviews').insert(reviewToRow(review)).select('*').single();
    if (res.error?.code === '23505') return { duplicate: true };
    return { review: rowToReview(check(res, 'insert review')) };
  },
  /** Отзывы, где человек автор или адресат, новые сверху. */
  async listByUser(db: Db, email: string): Promise<Json[]> {
    // Два запроса вместо .or(...): почта приходит из адреса, а в строку фильтра PostgREST её вставлять нельзя —
    // запятая или скобка в «почте» поменяли бы сам фильтр.
    const key = norm(email);
    const [asTarget, asAuthor] = await Promise.all([
      db.from('reviews').select('*').eq('target_email', key).order('created_at', { ascending: false }).limit(ROWS_LIMIT),
      db.from('reviews').select('*').eq('author_email', key).order('created_at', { ascending: false }).limit(ROWS_LIMIT),
    ]);
    const rows = [...check(asTarget, 'list target reviews') as Json[], ...check(asAuthor, 'list author reviews') as Json[]];
    return rows.map(rowToReview).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  },
  async listByTarget(db: Db, email: string): Promise<Json[]> {
    const rows = check(await db.from('reviews').select('*').eq('target_email', norm(email))
      .order('created_at', { ascending: false }).limit(ROWS_LIMIT), 'list target reviews');
    return (rows as Json[]).map(rowToReview);
  },
  async listAll(db: Db, minRating?: number, limit = ROWS_LIMIT): Promise<Json[]> {
    let query = db.from('reviews').select('*');
    if (minRating !== undefined && Number.isFinite(minRating)) query = query.gte('rating', minRating);
    const rows = check(await query.order('created_at', { ascending: false }).limit(Math.min(limit, ROWS_LIMIT)), 'list reviews');
    return (rows as Json[]).map(rowToReview);
  },
  async remove(db: Db, reviewId: string): Promise<void> {
    check(await db.from('reviews').delete().eq('id', reviewId), 'delete review');
  },
};

// ── Уведомления ─────────────────────────────────────────────────────────────
export const notifications = {
  async add(db: Db, email: string, notification: Json): Promise<Json> {
    const row = notificationToRow(email, notification);
    const res = await db.from('notifications').upsert(row, { onConflict: 'user_email,id' }).select('*').single();
    return rowToNotification(check(res, 'add notification'));
  },
  async list(db: Db, email: string): Promise<Json[]> {
    const rows = check(await db.from('notifications').select('*').eq('user_email', norm(email))
      .order('created_at', { ascending: false }).limit(ROWS_LIMIT), 'list notifications');
    return (rows as Json[]).map(rowToNotification);
  },
  /** null — уведомления нет. */
  async markRead(db: Db, email: string, id: string): Promise<Json | null> {
    const rows = check(await db.from('notifications').update({ is_unread: false })
      .eq('user_email', norm(email)).eq('id', id).select('*'), 'mark notification read') as Json[];
    return rows.length ? rowToNotification(rows[0]) : null;
  },
  async markAllRead(db: Db, email: string): Promise<void> {
    check(await db.from('notifications').update({ is_unread: false }).eq('user_email', norm(email)).eq('is_unread', true),
      'mark all notifications read');
  },
  async remove(db: Db, email: string, id: string): Promise<void> {
    check(await db.from('notifications').delete().eq('user_email', norm(email)).eq('id', id), 'delete notification');
  },
  /** Возвращает число удалённых. */
  async removeAll(db: Db, email: string): Promise<number> {
    const rows = check(await db.from('notifications').delete().eq('user_email', norm(email)).select('id'),
      'delete notifications') as Json[];
    return rows.length;
  },
};
