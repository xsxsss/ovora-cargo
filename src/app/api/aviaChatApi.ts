import { projectId, publicAnonKey } from '../../../utils/supabase/info';
import { CSRF_HEADER, CSRF_TOKEN } from './csrfToken';
import { getAviaSession } from './aviaApi';

const BASE    = `https://${projectId}.supabase.co/functions/v1/make-server-4e36197a`;
const BASE_HEADERS = {
  'Content-Type': 'application/json',
  Authorization:  `Bearer ${publicAnonKey}`,
  [CSRF_HEADER]: CSRF_TOKEN,
};

/** anon key + CSRF + (если есть сессия) X-Avia-Token владельца сессии */
function getHeaders(): Record<string, string> {
  const token = getAviaSession()?.token;
  return token ? { ...BASE_HEADERS, 'X-Avia-Token': token } : BASE_HEADERS;
}

// ── Fetch timeout ─────────────────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 10_000;

function withTimeout(signal?: AbortSignal): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  if (!signal) return timeoutSignal;
  const controller = new AbortController();
  signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  timeoutSignal.addEventListener('abort', () => controller.abort(new DOMException('Request timeout', 'TimeoutError')), { once: true });
  return controller.signal;
}

// ── Типы ─────────────────────────────────────────────────────────────────────

export type AviaChatMessageType = 'text' | 'deal_offer' | 'deal_update';

export interface DealMessageMeta {
  dealId:         string;
  dealType?:      string;
  weightKg?:      number;
  price?:         number | null;
  currency?:      string;
  adFrom?:        string;
  adTo?:          string;
  adDate?:        string | null;
  adType?:        'flight' | 'request';
  message?:       string;
  status?:        string;
  rejectReason?:  string;
  initiatorPhone?: string;
  recipientPhone?: string;
}

export interface AviaChatMessage {
  id:          string;
  chatId:      string;
  senderPhone: string;
  text:        string;
  createdAt:   string;
  type?:       AviaChatMessageType;
  meta?:       DealMessageMeta;
}

export interface AviaChatAdRef {
  type: 'flight' | 'request';
  id:   string;
  from: string;
  to:   string;
  date?: string;
}

export interface AviaChatMeta {
  chatId:          string;
  participants:    string[];
  adRef?:          AviaChatAdRef | null;
  lastMessage?:    string | null;
  lastMessageAt?:  string | null;
  lastSenderPhone?: string | null;
  unreadBy?:       Record<string, number>;
  lastSeenBy?:     Record<string, string>;
  createdAt?:      string;
}

export interface AviaChat extends AviaChatMeta {
  unread: number;
}

// ── Хелпер: канонический chatId (совпадает с серверным) ──────────────────────

export function makeAviaChatId(phone1: string, phone2: string): string {
  if (!phone1?.trim() || !phone2?.trim()) throw new Error('[aviaChatApi] makeAviaChatId: пустой номер телефона');
  const [a, b] = [phone1.trim(), phone2.trim()].sort();
  return `${a}_${b}`;
}

// ── API-функции ──────────────────────────────────────────────────────────────

/**
 * Инициализировать / открыть чат между двумя пользователями.
 * Идемпотентно: если чат уже существует — вернёт его.
 */
export async function initAviaChat(
  senderPhone:    string,
  recipientPhone: string,
  adRef?:         AviaChatAdRef | null,
): Promise<{ chatId: string; meta: AviaChatMeta; isNew: boolean }> {
  const res  = await fetch(`${BASE}/avia/chat/init`, {
    method:  'POST',
    headers: getHeaders(),
    body:    JSON.stringify({ senderPhone, recipientPhone, adRef }),
    signal:  withTimeout(),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || 'Ошибка инициализации чата');
  return data;
}

/** Получить историю сообщений чата */
export async function getAviaChatMessages(
  chatId: string,
  callerPhone: string,
): Promise<{ messages: AviaChatMessage[]; meta: AviaChatMeta }> {
  try {
    const url = `${BASE}/avia/chat/${encodeURIComponent(chatId)}/messages?callerPhone=${encodeURIComponent(callerPhone)}`;
    const res  = await fetch(url, {
      headers: getHeaders(),
      signal:  withTimeout(),
    });
    if (!res.ok) return { messages: [], meta: { chatId, participants: [], unread: 0 } as any };
    return await res.json();
  } catch {
    return { messages: [], meta: { chatId, participants: [], unread: 0 } as any };
  }
}

/** Отправить обычное текстовое сообщение */
export async function sendAviaChatMessage(
  chatId:      string,
  senderPhone: string,
  text:        string,
): Promise<AviaChatMessage> {
  const res  = await fetch(`${BASE}/avia/chat/${encodeURIComponent(chatId)}/messages`, {
    method:  'POST',
    headers: getHeaders(),
    body:    JSON.stringify({ senderPhone, text, type: 'text' }),
    signal:  withTimeout(),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || 'Ошибка отправки сообщения');
  return data.message;
}

/** Отправить типизированное сообщение (deal_offer, deal_update) */
export async function sendTypedChatMessage(
  chatId:      string,
  senderPhone: string,
  text:        string,
  type:        AviaChatMessageType,
  meta?:       DealMessageMeta,
): Promise<AviaChatMessage> {
  const res  = await fetch(`${BASE}/avia/chat/${encodeURIComponent(chatId)}/messages`, {
    method:  'POST',
    headers: getHeaders(),
    body:    JSON.stringify({ senderPhone, text, type, meta }),
    signal:  withTimeout(),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || 'Ошибка отправки сообщения');
  return data.message;
}

/** Пометить чат как прочитанный */
export async function markAviaChatSeen(
  chatId: string,
  phone: string,
  signal?: AbortSignal,
): Promise<void> {
  // Guard: пустой chatId даёт URL с "//seen" → браузер бросает Failed to fetch
  if (!chatId || !chatId.trim() || !phone || !phone.trim()) return;
  try {
    await fetch(`${BASE}/avia/chat/${encodeURIComponent(chatId.trim())}/seen`, {
      method:  'POST',
      headers: getHeaders(),
      body:    JSON.stringify({ phone: phone.trim() }),
      signal:  withTimeout(signal),
    });
  } catch (err: any) {
    // AbortError — нормальное поведение при размонтировании
    if (err?.name === 'AbortError') return;
  }
}

/** Удалить чат + каскадная отмена связанных deals */
export async function deleteAviaChat(
  chatId: string,
  phone: string,
): Promise<{ success: boolean; cancelledDealIds: string[]; error?: string }> {
  try {
    const res = await fetch(`${BASE}/avia/chat/${encodeURIComponent(chatId)}`, {
      method:  'DELETE',
      headers: getHeaders(),
      body:    JSON.stringify({ phone }),
      signal:  withTimeout(),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      return { success: false, cancelledDealIds: [], error: data.error || 'Ошибка удаления чата' };
    }
    return { success: true, cancelledDealIds: data.cancelledDealIds || [] };
  } catch (err) {
    return { success: false, cancelledDealIds: [], error: `${err}` };
  }
}

/** Получить список всех чатов пользователя */
export async function getAviaUserChats(phone: string): Promise<AviaChat[]> {
  try {
    const clean = phone.replace(/\D/g, '');
    const res   = await fetch(`${BASE}/avia/chats/user/${encodeURIComponent(clean)}?callerPhone=${encodeURIComponent(clean)}`, {
      headers: getHeaders(),
      signal:  withTimeout(),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.chats || [];
  } catch {
    return [];
  }
}