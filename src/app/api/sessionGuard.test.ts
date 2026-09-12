// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { aviaFetch, cargoFetch, AVIA_SESSION_EXPIRED_EVENT, USER_SESSION_EXPIRED_EVENT } from './sessionGuard';

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('sessionGuard', () => {
  let fired: string[];

  const record = (name: string) => () => { fired.push(name); };
  const onAvia = record('avia');
  const onUser = record('user');

  beforeEach(() => {
    fired = [];
    window.addEventListener(AVIA_SESSION_EXPIRED_EVENT, onAvia);
    window.addEventListener(USER_SESSION_EXPIRED_EVENT, onUser);
  });

  afterEach(() => {
    window.removeEventListener(AVIA_SESSION_EXPIRED_EVENT, onAvia);
    window.removeEventListener(USER_SESSION_EXPIRED_EVENT, onUser);
    vi.unstubAllGlobals();
  });

  it('поднимает событие на 401 с кодом AVIA_TOKEN_INVALID', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'Unauthorized', code: 'AVIA_TOKEN_INVALID' }, 401)));
    await aviaFetch('/avia/profile/1');
    expect(fired).toEqual(['avia']);
  });

  it('молчит на 401 без кода — это «неверный PIN», сессию трогать нельзя', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'Неверный PIN', attemptsLeft: 2 }, 401)));
    await aviaFetch('/avia/login');
    expect(fired).toEqual([]);
  });

  it('молчит на успешном ответе', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: true }, 200)));
    await aviaFetch('/avia/flights');
    expect(fired).toEqual([]);
  });

  it('не путает платформы: код CARGO не разлогинивает AVIA', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ code: 'USER_TOKEN_INVALID' }, 401)));
    await aviaFetch('/avia/flights');
    expect(fired).toEqual([]);
    await cargoFetch('/cargos');
    expect(fired).toEqual(['user']);
  });

  it('не забирает тело ответа у вызывающего кода', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'Unauthorized', code: 'AVIA_TOKEN_INVALID' }, 401)));
    const res = await aviaFetch('/avia/profile/1');
    await expect(res.json()).resolves.toMatchObject({ code: 'AVIA_TOKEN_INVALID' });
  });

  it('переживает ответ, который не является JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>gateway</html>', { status: 401 })));
    await expect(aviaFetch('/avia/flights')).resolves.toBeInstanceOf(Response);
    expect(fired).toEqual([]);
  });
});
