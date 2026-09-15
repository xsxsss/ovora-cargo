// Преобразование «строка таблицы ↔ JSON API» для чатов CARGO и их сообщений (MIGR-1, этап 3).
// Чистые функции без базы — покрыты тестами chatRows.test.ts. Формат ответов сайту прежний
// (карточка чата = бывший ovora:chatmeta, сообщение = бывший ovora:chat:{chatId}:{msgId}).

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

// ── Чат ─────────────────────────────────────────────────────────────────────
// unreadByEmail хранится отдельной таблицей chat_unread — в строку чата не попадает.
const CHAT_COLUMNS = ['chatId', 'participants', 'tripIds', 'lastMessage', 'lastMessageAt', 'lastSenderId',
  'hasProposal', 'proposalStatus', 'createdAt', 'updatedAt', 'unreadByEmail', 'unread'];

export function chatToRow(chat: Json): Json {
  const now = new Date().toISOString();
  const tripIds = Array.isArray(chat.tripIds) ? chat.tripIds.map(String) : (chat.tripId ? [String(chat.tripId)] : []);
  return {
    id: String(chat.chatId),
    participants: [...new Set((chat.participants || []).map(String))],
    trip_ids: [...new Set(tripIds)],
    last_message: chat.lastMessage ?? null,
    last_message_at: iso(chat.lastMessageAt),
    last_sender_id: chat.lastSenderId ?? null,
    has_proposal: chat.hasProposal === true,
    proposal_status: chat.proposalStatus ?? null,
    created_at: iso(chat.createdAt) ?? now,
    updated_at: iso(chat.updatedAt) ?? now,
    data: without(chat, CHAT_COLUMNS),
  };
}

/** unreadRows — строки chat_unread этого чата ({ email, count }). */
export function rowToChat(row: Json, unreadRows: Json[] = []): Json {
  const unreadByEmail: Record<string, number> = {};
  for (const u of unreadRows) unreadByEmail[u.email] = Number(u.count) || 0;
  return {
    ...(row.data || {}),
    chatId: row.id,
    participants: row.participants || [],
    tripIds: row.trip_ids || [],
    lastMessage: row.last_message ?? null,
    lastMessageAt: iso(row.last_message_at),
    lastSenderId: row.last_sender_id ?? undefined,
    hasProposal: row.has_proposal === true,
    proposalStatus: row.proposal_status ?? null,
    unreadByEmail,
    createdAt: iso(row.created_at),
  };
}

// ── Сообщение ───────────────────────────────────────────────────────────────
const MESSAGE_COLUMNS = ['chatId', 'msgId', 'senderId', 'type', 'text', 'proposal', 'ts', 'createdAt'];
export const MESSAGE_TYPES = ['text', 'proposal', 'system'] as const;

export function messageToRow(msg: Json): Json {
  const ts = Number(msg.ts);
  const createdAt = iso(msg.createdAt);
  const safeTs = Number.isFinite(ts) && ts > 0 ? Math.trunc(ts) : (createdAt ? Date.parse(createdAt) : Date.now());
  return {
    chat_id: String(msg.chatId),
    id: String(msg.msgId),
    sender_id: String(msg.senderId || ''),
    type: (MESSAGE_TYPES as readonly string[]).includes(msg.type) ? msg.type : 'text',
    text: msg.text ?? null,
    proposal: msg.proposal ?? null,
    ts: safeTs,
    created_at: createdAt ?? new Date(safeTs).toISOString(),
    data: without(msg, MESSAGE_COLUMNS),
  };
}

export function rowToMessage(row: Json): Json {
  return {
    ...(row.data || {}),
    chatId: row.chat_id,
    msgId: row.id,
    senderId: row.sender_id,
    type: row.type,
    text: row.text ?? null,
    proposal: row.proposal ?? null,
    ts: Number(row.ts),
    createdAt: iso(row.created_at),
  };
}

/** Текст последнего сообщения в карточке чата — как раньше в /chat/message. */
export function messagePreview(msg: Json): string {
  return msg.type === 'proposal' ? 'Новая оферта на перевозку' : (msg.text || '');
}
