import { describe, it, expect } from 'vitest';
import {
  errorKind, addError, isDue, formatAlert, recordServerError, announceIfNew, ALERT_INTERVAL_MS,
} from './alerts.tsx';

function memoryKV() {
  const store = new Map<string, any>();
  return {
    store,
    kv: {
      async get(k: string) { return structuredClone(store.get(k)); },
      async set(k: string, v: any) { store.set(k, structuredClone(v)); },
    },
  };
}

function fakeTelegram(updates: any[] = [{ message: { chat: { id: 42, type: 'private' } } }]) {
  const sent: any[] = [];
  const fetchFn = async (url: string, init?: RequestInit) => {
    const method = url.split('/').pop();
    if (method === 'getUpdates') return new Response(JSON.stringify({ ok: true, result: updates }));
    sent.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ ok: true }));
  };
  return { sent, fetchFn };
}

describe('errorKind', () => {
  it('убирает префикс функции и заменяет идентификаторы', () => {
    expect(errorKind('put', '/make-server-4e36197a/offers/t_17892/o9', 500)).toBe('500 PUT /offers/:id/:id');
    expect(errorKind('GET', '/make-server-4e36197a/users/a@b.c/devices', 503)).toBe('503 GET /users/:id/devices');
  });
});

describe('накопление и сводка', () => {
  it('одинаковые ошибки складываются', () => {
    const p = addError(addError(null, 'k', 1), 'k', 2);
    expect(p.counts.k).toBe(2);
  });

  it('разнообразие ошибок ограничено — сводка не разрастается', () => {
    let p = null as any;
    for (let i = 0; i < 100; i++) p = addError(p, `k${i}`, 1);
    expect(Object.keys(p.counts).length).toBeLessThanOrEqual(31);
  });

  it('первая ошибка отправляется сразу, следующие — не раньше интервала', () => {
    const now = Date.parse('2026-09-15T10:00:00Z');
    const p = addError(null, 'k', now);
    expect(isDue(p, now)).toBe(true);
    expect(isDue({ ...p, lastSentAt: now }, now + ALERT_INTERVAL_MS - 1)).toBe(false);
    expect(isDue({ ...p, lastSentAt: now }, now + ALERT_INTERVAL_MS)).toBe(true);
  });

  it('сводка содержит итог и типы ошибок', () => {
    const text = formatAlert({ since: 0, lastSentAt: 0, counts: { '500 GET /trips': 3, '503 PUT /offers/:id/:id': 1 } }, 'prod');
    expect(text).toContain('4 ошибок');
    expect(text).toContain('500 GET /trips — 3');
  });
});

describe('recordServerError', () => {
  it('шлёт сводку владельцу и обнуляет счётчик', async () => {
    const { kv, store } = memoryKV();
    const { sent, fetchFn } = fakeTelegram();
    await recordServerError(kv, fetchFn, 'token', 'prod', '500 GET /trips', 10_000_000);
    expect(sent).toHaveLength(1);
    expect(sent[0].chat_id).toBe(42);
    expect(store.get('ovora:alerts:pending').counts).toEqual({});
  });

  it('в пределах интервала только копит, без сообщений', async () => {
    const { kv, store } = memoryKV();
    const { sent, fetchFn } = fakeTelegram();
    await recordServerError(kv, fetchFn, 'token', 'prod', 'a', 10_000_000);
    await recordServerError(kv, fetchFn, 'token', 'prod', 'a', 10_000_000 + 1000);
    await recordServerError(kv, fetchFn, 'token', 'prod', 'b', 10_000_000 + 2000);
    expect(sent).toHaveLength(1);
    expect(store.get('ovora:alerts:pending').counts).toEqual({ a: 1, b: 1 });
  });

  it('без токена или без чата ошибки не теряются', async () => {
    const { kv, store } = memoryKV();
    const { sent, fetchFn } = fakeTelegram([]);
    await recordServerError(kv, fetchFn, '', 'prod', 'a', 10_000_000);
    await recordServerError(kv, fetchFn, 'token', 'prod', 'a', 10_000_000);
    expect(sent).toHaveLength(0);
    expect(store.get('ovora:alerts:pending').counts.a).toBe(2);
  });

  it('чат запоминается один раз — чужой, написавший боту позже, его не перехватит', async () => {
    const { kv } = memoryKV();
    await announceIfNew(kv, fakeTelegram().fetchFn, 'token', 'prod');
    const intruder = fakeTelegram([{ message: { chat: { id: 666, type: 'private' } } }]);
    await recordServerError(kv, intruder.fetchFn, 'token', 'prod', 'a', 10_000_000);
    expect(intruder.sent[0].chat_id).toBe(42);
  });
});

describe('announceIfNew', () => {
  it('приветствие уходит только при первом подключении', async () => {
    const { kv } = memoryKV();
    const t = fakeTelegram();
    expect(await announceIfNew(kv, t.fetchFn, 'token', 'prod')).toBe(true);
    expect(await announceIfNew(kv, t.fetchFn, 'token', 'prod')).toBe(false);
    expect(t.sent).toHaveLength(1);
  });
});
