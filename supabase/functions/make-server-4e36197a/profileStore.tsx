// Пользователи CARGO и их документы на таблицах Postgres (MIGR-1, этап 2). Возвращает тот же JSON,
// что раньше лежал в KV (profileRows.tsx). Номер документа шифруется здесь же (docCrypto.tsx):
// в открытом виде он есть только при записи и в расшифрованном — в списке документов для админки.
import { userToRow, rowToUser, documentToRow, rowToDocument, normEmail } from "./profileRows.tsx";
import { encryptField, decryptField } from "./docCrypto.tsx";

type Json = Record<string, any>;
type Db = { from(table: string): any };

const ROWS_LIMIT = 5000;

function check<T>(res: { data: T; error: any }, what: string): T {
  if (res.error) throw new Error(`[profileStore] ${what}: ${res.error.message}`);
  return res.data;
}

// ── Пользователи ────────────────────────────────────────────────────────────
export const users = {
  async get(db: Db, email: string): Promise<Json | null> {
    const row = check(await db.from('users').select('*').eq('email', normEmail(email)).maybeSingle(), 'get user');
    return row ? rowToUser(row) : null;
  },
  async getMany(db: Db, emails: string[]): Promise<Map<string, Json>> {
    const list = [...new Set(emails.map(normEmail).filter(Boolean))];
    if (!list.length) return new Map();
    const rows = check(await db.from('users').select('*').in('email', list), 'get users') as Json[];
    return new Map(rows.map(r => [r.email, rowToUser(r)]));
  },
  async listAll(db: Db): Promise<Json[]> {
    const rows = check(await db.from('users').select('*').order('created_at', { ascending: false }).limit(ROWS_LIMIT), 'list users');
    return (rows as Json[]).map(rowToUser);
  },
  /**
   * Создать или изменить: build получает текущего пользователя (или null) и возвращает запись целиком.
   * Одновременная регистрация с двух устройств не создаст двух записей и не потеряет правку.
   */
  async upsert(db: Db, email: string, build: (existing: Json | null) => Json): Promise<Json> {
    const key = normEmail(email);
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = check(await db.from('users').select('*').eq('email', key).maybeSingle(), 'read user') as Json | null;
      const next = { ...build(current ? rowToUser(current) : null), email: key };
      if (!current) {
        const res = await db.from('users').insert(userToRow(next)).select('*').single();
        if (res.error?.code === '23505') continue; // создал параллельный запрос — перечитать
        return rowToUser(check(res, 'insert user'));
      }
      const row = { ...userToRow({ ...next, updatedAt: new Date().toISOString() }), created_at: current.created_at };
      const res = await db.from('users').update(row).eq('email', key).eq('updated_at', current.updated_at).select('*');
      const rows = check(res, 'update user') as Json[];
      if (rows.length) return rowToUser(rows[0]);
    }
    throw new Error(`[profileStore] upsert user ${key}: conflict after retries`);
  },
  /** Слить поля в существующего пользователя (с проверкой параллельной правки). null — пользователя нет. */
  async patch(db: Db, email: string, patch: Json | ((current: Json) => Json)): Promise<Json | null> {
    const key = normEmail(email);
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = check(await db.from('users').select('*').eq('email', key).maybeSingle(), 'read user') as Json | null;
      if (!current) return null;
      const api = rowToUser(current);
      const next = { ...api, ...(typeof patch === 'function' ? patch(api) : patch), email: key, updatedAt: new Date().toISOString() };
      const row = { ...userToRow(next), created_at: current.created_at };
      const res = await db.from('users').update(row).eq('email', key).eq('updated_at', current.updated_at).select('*');
      const rows = check(res, 'update user') as Json[];
      if (rows.length) return rowToUser(rows[0]);
    }
    throw new Error(`[profileStore] patch user ${key}: conflict after retries`);
  },
  /** Удаляет пользователя; его документы база удаляет каскадом. */
  async remove(db: Db, email: string): Promise<void> {
    check(await db.from('users').delete().eq('email', normEmail(email)), 'delete user');
  },
};

// ── Документы ───────────────────────────────────────────────────────────────
const encKey = () => (typeof Deno !== 'undefined' ? Deno.env.get('DOCUMENTS_ENC_KEY') : undefined) || undefined;

export const documents = {
  async listByUser(db: Db, email: string): Promise<Json[]> {
    const rows = check(await db.from('documents').select('*').eq('user_email', normEmail(email))
      .order('created_at', { ascending: false }), 'list user documents');
    return (rows as Json[]).map(rowToDocument);
  },
  async get(db: Db, email: string, id: string): Promise<Json | null> {
    const row = check(await db.from('documents').select('*').eq('user_email', normEmail(email)).eq('id', id).maybeSingle(), 'get document');
    return row ? rowToDocument(row) : null;
  },
  /** Все документы с расшифрованным номером — только для админки. */
  async listAllForAdmin(db: Db): Promise<Json[]> {
    const rows = check(await db.from('documents').select('*').order('created_at', { ascending: false }).limit(ROWS_LIMIT),
      'list documents') as Json[];
    const key = encKey();
    return Promise.all(rows.map(async (r) => {
      const doc = rowToDocument(r);
      const number = await decryptField(r.document_number_enc, key);
      return number ? { ...doc, documentNumber: number } : doc;
    }));
  },
  /**
   * Сохранить документ (повторная загрузка того же типа заменяет запись). Номер берётся из
   * doc.extractedData.documentNumber и сохраняется только шифром; без ключа — не сохраняется.
   * Пользователь должен существовать (связь в схеме).
   */
  async save(db: Db, doc: Json): Promise<Json> {
    const enc = await encryptField(doc.extractedData?.documentNumber || doc.documentNumber || null, encKey());
    const row = documentToRow(doc, enc);
    const res = await db.from('documents').upsert(row, { onConflict: 'user_email,id' }).select('*').single();
    return rowToDocument(check(res, 'save document'));
  },
  /** Статус и заметки админа. null — документа нет. */
  async setStatus(db: Db, email: string, id: string, status: string, extra: Json): Promise<Json | null> {
    const current = check(await db.from('documents').select('*').eq('user_email', normEmail(email)).eq('id', id).maybeSingle(),
      'read document') as Json | null;
    if (!current) return null;
    const res = await db.from('documents').update({
      status, updated_at: new Date().toISOString(), data: { ...(current.data || {}), ...extra },
    }).eq('user_email', normEmail(email)).eq('id', id).select('*');
    const rows = check(res, 'update document status') as Json[];
    return rows.length ? rowToDocument(rows[0]) : null;
  },
  /** Возвращает удалённый документ (для удаления файла скана) или null. */
  async remove(db: Db, email: string, id: string): Promise<Json | null> {
    const res = await db.from('documents').delete().eq('user_email', normEmail(email)).eq('id', id).select('*');
    const rows = check(res, 'delete document') as Json[];
    return rows.length ? rowToDocument(rows[0]) : null;
  },
};
