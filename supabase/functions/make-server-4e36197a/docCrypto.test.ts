import { describe, it, expect } from 'vitest';
import { encryptField, decryptField } from './docCrypto.tsx';

const KEY = 'test-secret-not-real-0123456789abcdef'; // pragma: allowlist secret

describe('шифрование номера документа', () => {
  it('расшифровывается тем же ключом', async () => {
    const enc = await encryptField('4509 123456', KEY);
    expect(enc).toMatch(/^v1:/);
    expect(enc).not.toContain('123456');
    expect(await decryptField(enc, KEY)).toBe('4509 123456');
  });

  it('один номер — разный шифр (случайный вектор)', async () => {
    expect(await encryptField('4509 123456', KEY)).not.toBe(await encryptField('4509 123456', KEY));
  });

  it('без ключа номер не сохраняется', async () => {
    expect(await encryptField('4509 123456', undefined)).toBeNull();
    expect(await encryptField('4509 123456', '')).toBeNull();
    expect(await encryptField(null, KEY)).toBeNull();
  });

  it('чужой ключ и подделка дают null, а не исключение', async () => {
    const enc = (await encryptField('4509 123456', KEY))!;
    expect(await decryptField(enc, 'другой-ключ')).toBeNull();
    const tampered = enc.slice(0, -4) + (enc.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    expect(await decryptField(tampered, KEY)).toBeNull();
    expect(await decryptField('v1:%%%', KEY)).toBeNull();
    expect(await decryptField('4509 123456', KEY)).toBeNull();
    expect(await decryptField(enc, undefined)).toBeNull();
  });
});
