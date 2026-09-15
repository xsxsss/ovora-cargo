// Шифрование номера документа (паспорт, права) перед записью в базу. AES-GCM 256 через WebCrypto —
// одинаково работает в Deno и в Node (тесты). Ключ выводится из секрета DOCUMENTS_ENC_KEY (SHA-256),
// поэтому секрет может быть любой длинной строкой. База и резервные копии видят только шифр.
//
// Формат: "v1:" + base64(iv(12) | шифртекст+тег). Версия — чтобы сменить алгоритм или ключ, не ломая старые записи.

const PREFIX = 'v1:';

async function importKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromBase64(text: string): Uint8Array {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** null — нечего шифровать или нет ключа: без ключа номер не сохраняется совсем. */
export async function encryptField(plain: string | null | undefined, secret: string | undefined): Promise<string | null> {
  if (!plain || !secret) return null;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importKey(secret);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain)));
  const packed = new Uint8Array(iv.length + cipher.length);
  packed.set(iv);
  packed.set(cipher, iv.length);
  return PREFIX + toBase64(packed);
}

/** null — нет шифра, нет ключа, чужой ключ или подделка (тег AES-GCM не сошёлся). Никогда не бросает. */
export async function decryptField(stored: string | null | undefined, secret: string | undefined): Promise<string | null> {
  if (!stored || !secret || !stored.startsWith(PREFIX)) return null;
  try {
    const packed = fromBase64(stored.slice(PREFIX.length));
    if (packed.length < 13) return null;
    const key = await importKey(secret);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: packed.slice(0, 12) }, key, packed.slice(12));
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

/** Для владельца документа: видны только последние 4 символа. */
export function maskDocumentNumber(number: string | null): string | null {
  if (!number) return null;
  const clean = number.replace(/\s+/g, '');
  return clean.length <= 4 ? '••••' : '••••' + clean.slice(-4);
}
