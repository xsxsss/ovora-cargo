// Оповещения об ошибках сервера в Telegram. Sentry недоступен из России и Таджикистана.
// Каждый ответ 5xx копится в KV; не чаще раза в ALERT_INTERVAL_MS уходит одна сводка.
// Токен бота — секрет TELEGRAM_BOT_TOKEN. Чат владельца запоминается при первом запуске
// из getUpdates (владелец сначала пишет боту) и дальше не меняется.

export const ALERT_INTERVAL_MS = 15 * 60_000;
const PENDING_KEY = 'ovora:alerts:pending';
const CHAT_KEY = 'ovora:alerts:telegram_chat_id';
const MAX_KINDS = 30;

export interface AlertKV {
  get(key: string): Promise<any>;
  set(key: string, value: any): Promise<void>;
}

export interface Pending {
  since: number;
  lastSentAt: number;
  counts: Record<string, number>;
}

/** «PUT /offers/123_abc/456» → «PUT /offers/:id/:id» — одна строка на тип ошибки. */
export function errorKind(method: string, path: string, status: number): string {
  const p = path.replace(/^\/make-server-4e36197a/, '')
    .split('/').map(seg => (/\d/.test(seg) || seg.includes('@') || seg.length > 24 ? ':id' : seg)).join('/');
  return `${status} ${method.toUpperCase()} ${p || '/'}`;
}

export function addError(pending: Pending | null, kind: string, now: number): Pending {
  const next: Pending = pending ? { ...pending, counts: { ...pending.counts } } : { since: now, lastSentAt: 0, counts: {} };
  if (!(kind in next.counts) && Object.keys(next.counts).length >= MAX_KINDS) kind = 'другие ошибки';
  next.counts[kind] = (next.counts[kind] || 0) + 1;
  return next;
}

export function isDue(pending: Pending | null, now: number): boolean {
  return !!pending && Object.keys(pending.counts).length > 0 && now - pending.lastSentAt >= ALERT_INTERVAL_MS;
}

export function formatAlert(pending: Pending, site: string): string {
  const total = Object.values(pending.counts).reduce((a, b) => a + b, 0);
  const lines = Object.entries(pending.counts).sort((a, b) => b[1] - a[1]).slice(0, 15)
    .map(([kind, n]) => `• ${kind} — ${n}`);
  return [`⚠️ Ovora (${site}): ${total} ошибок сервера`, ...lines, '', 'Подробности — логи функции в Supabase.'].join('\n');
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

async function telegram(fetchFn: Fetch, token: string, method: string, body?: unknown): Promise<any> {
  const res = await fetchFn(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  return res.json().catch(() => ({}));
}

/** Чат владельца: сохранённый или первый личный чат из сообщений боту. */
export async function resolveChatId(kv: AlertKV, fetchFn: Fetch, token: string): Promise<{ chatId: number | null; isNew: boolean }> {
  const saved = await kv.get(CHAT_KEY);
  if (typeof saved === 'number') return { chatId: saved, isNew: false };
  const updates = await telegram(fetchFn, token, 'getUpdates');
  const chat = (updates?.result || []).map((u: any) => u?.message?.chat).find((c: any) => c?.type === 'private');
  if (typeof chat?.id !== 'number') return { chatId: null, isNew: false };
  await kv.set(CHAT_KEY, chat.id);
  return { chatId: chat.id, isNew: true };
}

export async function recordServerError(
  kv: AlertKV, fetchFn: Fetch, token: string, site: string, kind: string, now = Date.now(),
): Promise<void> {
  const pending = addError(await kv.get(PENDING_KEY), kind, now);
  if (!token || !isDue(pending, now)) {
    await kv.set(PENDING_KEY, pending);
    return;
  }
  const { chatId } = await resolveChatId(kv, fetchFn, token);
  if (chatId === null) {
    await kv.set(PENDING_KEY, pending);
    return;
  }
  await kv.set(PENDING_KEY, { since: now, lastSentAt: now, counts: {} });
  await telegram(fetchFn, token, 'sendMessage', { chat_id: chatId, text: formatAlert(pending, site) });
}

/** Одноразовое «мониторинг подключён» — чтобы владелец увидел, что бот работает. */
export async function announceIfNew(kv: AlertKV, fetchFn: Fetch, token: string, site: string): Promise<boolean> {
  if (!token) return false;
  const { chatId, isNew } = await resolveChatId(kv, fetchFn, token);
  if (chatId === null || !isNew) return false;
  await telegram(fetchFn, token, 'sendMessage', {
    chat_id: chatId,
    text: `✅ Ovora (${site}): мониторинг подключён. Сюда будут приходить сводки ошибок сервера, не чаще раза в 15 минут.`,
  });
  return true;
}
