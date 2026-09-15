// Преобразование «строка таблицы ↔ JSON API» для пользователей CARGO и их документов (MIGR-1, этап 2).
// Чистые функции без базы — покрыты тестами profileRows.test.ts. Формат ответов сайту прежний.

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

function compact(obj: Json): Json {
  const out: Json = {};
  for (const [k, v] of Object.entries(obj)) if (v !== null && v !== undefined) out[k] = v;
  return out;
}

export const normEmail = (email: unknown): string => String(email || '').toLowerCase().trim();

// ── Пользователь ────────────────────────────────────────────────────────────
// Секреты и паспорт в запись пользователя не попадают никогда: код входа лежит отдельно
// (ovora:perm_code), паспорт — в documents. Старые поля отбрасываются при записи.
const USER_COLUMNS = ['email', 'role', 'status', 'phone', 'isVerified', 'createdAt', 'updatedAt'];
const USER_NEVER_STORED = ['codeHash', 'passportNumber', 'passportData'];

export function userToRow(user: Json): Json {
  const now = new Date().toISOString();
  return {
    email: normEmail(user.email),
    role: user.role === 'driver' ? 'driver' : 'sender',
    status: user.status === 'blocked' ? 'blocked' : 'active',
    phone: user.phone ? String(user.phone) : null,
    is_verified: user.isVerified === true,
    created_at: iso(user.createdAt) ?? now,
    updated_at: iso(user.updatedAt) ?? now,
    data: without(user, [...USER_COLUMNS, ...USER_NEVER_STORED]),
  };
}

export function rowToUser(row: Json): Json {
  return compact({
    ...(row.data || {}),
    email: row.email,
    role: row.role,
    status: row.status,
    phone: row.phone ?? '',
    isVerified: row.is_verified === true,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });
}

// ── Документ ────────────────────────────────────────────────────────────────
export const DOCUMENT_TYPES = ['passport', 'driver_license', 'vehicle_registration', 'insurance'] as const;
export const DOCUMENT_STATUSES = ['pending', 'verified', 'approved', 'rejected'] as const;

const DOCUMENT_COLUMNS = ['id', 'userEmail', 'type', 'status', 'photoPath', 'expiryDate', 'createdAt', 'updatedAt'];
// Ссылка на скан временная — выдаётся при чтении; номер документа — только в зашифрованной колонке.
const DOCUMENT_NEVER_STORED = ['photoUrl', 'documentNumber'];

/** documentNumberEnc — уже зашифрованный номер (docCrypto.encryptField) или null. */
export function documentToRow(doc: Json, documentNumberEnc: string | null): Json {
  const now = new Date().toISOString();
  const extracted = doc.extractedData && typeof doc.extractedData === 'object'
    ? without(doc.extractedData, ['documentNumber'])
    : doc.extractedData;
  const data = without(doc, [...DOCUMENT_COLUMNS, ...DOCUMENT_NEVER_STORED]);
  if (extracted !== undefined) data.extractedData = extracted;
  return {
    user_email: normEmail(doc.userEmail),
    id: String(doc.id),
    type: String(doc.type),
    status: (DOCUMENT_STATUSES as readonly string[]).includes(doc.status) ? doc.status : 'pending',
    photo_path: doc.photoPath || null,
    expiry_date: doc.expiryDate || null,
    document_number_enc: documentNumberEnc,
    created_at: iso(doc.createdAt) ?? iso(doc.uploadDate) ?? now,
    updated_at: iso(doc.updatedAt) ?? now,
    data,
  };
}

export function rowToDocument(row: Json): Json {
  return compact({
    ...(row.data || {}),
    id: row.id,
    userEmail: row.user_email,
    type: row.type,
    status: row.status,
    photoPath: row.photo_path,
    expiryDate: row.expiry_date,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });
}
