import { describe, it, expect } from 'vitest';
import { unsubscribeSignature, isValidUnsubscribeSignature, unsubscribeUrl } from './unsubscribeLink.tsx';

const SECRET = 'test-secret-that-is-at-least-32-chars-long';

describe('подпись ссылки отписки', () => {
  it('подпись из письма проходит проверку', () => {
    const sig = unsubscribeSignature('user@mail.ru', SECRET);
    expect(isValidUnsubscribeSignature('user@mail.ru', sig, SECRET)).toBe(true);
  });

  it('регистр и пробелы адреса не ломают ссылку', () => {
    const sig = unsubscribeSignature('User@Mail.ru ', SECRET);
    expect(isValidUnsubscribeSignature('user@mail.ru', sig, SECRET)).toBe(true);
  });

  it('подпись чужого адреса не подходит — нельзя отписать другого человека', () => {
    const sig = unsubscribeSignature('attacker@mail.ru', SECRET);
    expect(isValidUnsubscribeSignature('victim@mail.ru', sig, SECRET)).toBe(false);
  });

  it('без подписи, с мусором или другим секретом — отказ', () => {
    expect(isValidUnsubscribeSignature('user@mail.ru', '', SECRET)).toBe(false);
    expect(isValidUnsubscribeSignature('user@mail.ru', 'abc', SECRET)).toBe(false);
    const sig = unsubscribeSignature('user@mail.ru', 'other-secret-other-secret-other-secret');
    expect(isValidUnsubscribeSignature('user@mail.ru', sig, SECRET)).toBe(false);
  });

  it('без секрета ссылка не принимается', () => {
    expect(isValidUnsubscribeSignature('user@mail.ru', 'x', '')).toBe(false);
  });

  it('ссылка содержит адрес и подпись, которые снова проходят проверку', () => {
    const url = new URL(unsubscribeUrl('https://ovora-cargo.saburov.workers.dev/', 'A+b@mail.ru', SECRET));
    expect(url.pathname).toBe('/unsubscribe');
    const email = url.searchParams.get('email')!;
    expect(email).toBe('a+b@mail.ru');
    expect(isValidUnsubscribeSignature(email, url.searchParams.get('sig')!, SECRET)).toBe(true);
  });
});
