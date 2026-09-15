// Чаты CARGO и сообщения на таблицах Postgres (MIGR-1, этап 3). Возвращает тот же JSON, что раньше
// лежал в KV (chatRows.tsx). Новое сообщение с непрочитанным — функцией в базе одной транзакцией.
// Имя файла не chatStore — чтобы не путать с ядром фронта src/app/api/chatStore.ts.
import { chatToRow, rowToChat, messageToRow, rowToMessage } from "./chatRows.tsx";

type Json = Record<string, any>;
type Db = { from(table: string): any; rpc(fn: string, args: Json): any };

const ROWS_LIMIT = 5000;
const WITH_UNREAD = '*, chat_unread(email, count)';

function check<T>(res: { data: T; error: any }, what: string): T {
  if (res.error) throw new Error(`[chatTables] ${what}: ${res.error.message}`);
  return res.data;
}

const toChat = (row: Json) => rowToChat(row, row.chat_unread || []);

// ── Чаты ────────────────────────────────────────────────────────────────────
export const chats = {
  async get(db: Db, chatId: string): Promise<Json | null> {
    const row = check(await db.from('chats').select(WITH_UNREAD).eq('id', chatId).maybeSingle(), 'get chat');
    return row ? toChat(row) : null;
  },
  /** Чаты, где email — участник (GIN-индекс), новые сверху. */
  async listByParticipant(db: Db, email: string): Promise<Json[]> {
    const rows = check(await db.from('chats').select(WITH_UNREAD).contains('participants', [email])
      .order('last_message_at', { ascending: false, nullsFirst: false }).limit(ROWS_LIMIT), 'list user chats');
    return (rows as Json[]).map(toChat);
  },
  /** Чаты, в которых обсуждалась поездка. */
  async listByTrip(db: Db, tripId: string): Promise<Json[]> {
    const rows = check(await db.from('chats').select(WITH_UNREAD).contains('trip_ids', [String(tripId)]), 'list trip chats');
    return (rows as Json[]).map(toChat);
  },
  async listAll(db: Db): Promise<Json[]> {
    const rows = check(await db.from('chats').select(WITH_UNREAD).order('created_at', { ascending: false }).limit(ROWS_LIMIT), 'list chats');
    return (rows as Json[]).map(toChat);
  },
  /**
   * Создать или изменить карточку: build получает текущую (или null) и возвращает целиком. Проверка
   * параллельной правки по updated_at. Непрочитанное так не меняется — только addMessage и markRead.
   */
  async upsert(db: Db, chatId: string, build: (existing: Json | null) => Json): Promise<Json> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = check(await db.from('chats').select(WITH_UNREAD).eq('id', chatId).maybeSingle(), 'read chat') as Json | null;
      const next = { ...build(current ? toChat(current) : null), chatId };
      if (!current) {
        const res = await db.from('chats').insert(chatToRow(next)).select(WITH_UNREAD).single();
        if (res.error?.code === '23505') continue; // создал параллельный запрос — перечитать
        return toChat(check(res, 'insert chat'));
      }
      const row = { ...chatToRow({ ...next, updatedAt: new Date().toISOString() }), created_at: current.created_at };
      const res = await db.from('chats').update(row).eq('id', chatId).eq('updated_at', current.updated_at).select(WITH_UNREAD);
      const rows = check(res, 'update chat') as Json[];
      if (rows.length) return toChat(rows[0]);
    }
    throw new Error(`[chatTables] upsert chat ${chatId}: conflict after retries`);
  },
  /** Слить поля в существующую карточку. null — чата нет. */
  async patch(db: Db, chatId: string, patch: Json | ((current: Json) => Json)): Promise<Json | null> {
    const exists = check(await db.from('chats').select('id').eq('id', chatId).maybeSingle(), 'find chat');
    if (!exists) return null;
    return chats.upsert(db, chatId, (current) => {
      const base = current || {};
      return { ...base, ...(typeof patch === 'function' ? patch(base) : patch) };
    });
  },
  async markRead(db: Db, chatId: string, email: string): Promise<void> {
    check(await db.from('chat_unread').upsert({ chat_id: chatId, email, count: 0 }, { onConflict: 'chat_id,email' }), 'mark read');
  },
  /** Удаляет чат; сообщения и непрочитанное база удаляет каскадом. */
  async remove(db: Db, chatId: string): Promise<void> {
    check(await db.from('chats').delete().eq('id', chatId), 'delete chat');
  },
};

// ── Сообщения ───────────────────────────────────────────────────────────────
export const messages = {
  async list(db: Db, chatId: string): Promise<Json[]> {
    const rows = check(await db.from('messages').select('*').eq('chat_id', chatId).order('ts', { ascending: true }), 'list messages');
    return (rows as Json[]).map(rowToMessage);
  },
  async get(db: Db, chatId: string, msgId: string): Promise<Json | null> {
    const row = check(await db.from('messages').select('*').eq('chat_id', chatId).eq('id', msgId).maybeSingle(), 'get message');
    return row ? rowToMessage(row) : null;
  },
  async findByProposalId(db: Db, chatId: string, proposalId: string): Promise<Json | null> {
    const rows = check(await db.from('messages').select('*').eq('chat_id', chatId).eq('proposal->>id', proposalId).limit(1),
      'find proposal') as Json[];
    return rows.length ? rowToMessage(rows[0]) : null;
  },
  /** Последнее сообщение чата или null. */
  async latest(db: Db, chatId: string): Promise<Json | null> {
    const rows = check(await db.from('messages').select('*').eq('chat_id', chatId).order('ts', { ascending: false }).limit(1),
      'latest message') as Json[];
    return rows.length ? rowToMessage(rows[0]) : null;
  },
  async count(db: Db, chatId: string): Promise<number> {
    const res = await db.from('messages').select('id', { count: 'exact', head: true }).eq('chat_id', chatId);
    check(res, 'count messages');
    return res.count || 0;
  },
  /**
   * Записать сообщение: карточка чата (последнее сообщение, оферта) и непрочитанное у остальных участников
   * меняются в той же транзакции. false — чата нет.
   */
  async add(db: Db, msg: Json, preview: string): Promise<boolean> {
    const row = messageToRow(msg);
    return check(await db.rpc('ovora_chat_add_message', {
      p_chat_id: row.chat_id, p_id: row.id, p_sender_id: row.sender_id, p_type: row.type, p_text: row.text,
      p_proposal: row.proposal, p_ts: row.ts, p_created_at: row.created_at, p_data: row.data, p_preview: preview,
    }), 'add message');
  },
  async setProposal(db: Db, chatId: string, msgId: string, proposal: Json): Promise<void> {
    check(await db.from('messages').update({ proposal }).eq('chat_id', chatId).eq('id', msgId), 'update proposal');
  },
  async remove(db: Db, chatId: string, msgId: string): Promise<void> {
    check(await db.from('messages').delete().eq('chat_id', chatId).eq('id', msgId), 'delete message');
  },
};
