import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { signUserToken, verifyUserActor, verifiedEmailFromToken, userAuthEnabled, userAuthEnforced, userLegacyOpen, userUnauthorized, USER_TOKEN_INVALID } from './userAuth.tsx';

const SECRET = 'user-test-secret-key-at-least-32-chars-long';

function makeContext(headers: Record<string, string> = {}) {
  return {
    req: { header: (name: string) => headers[name], path: '/make-server-4e36197a/cargos/1' },
    json: (body: unknown, status?: number) => ({ body, status: status ?? 200 }),
  };
}

describe('verifyUserActor', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env.USER_JWT_SECRET = SECRET;
    delete process.env.USER_AUTH_LEGACY_OPEN;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('пропускает владельца токена независимо от регистра email', async () => {
    const token = await signUserToken('Owner@Example.COM');
    const c = makeContext({ 'X-User-Token': token! });
    expect(await verifyUserActor(c, 'owner@example.com')).toBe(true);
  });

  it('отклоняет подмену чужого email', async () => {
    const token = await signUserToken('owner@example.com');
    const c = makeContext({ 'X-User-Token': token! });
    expect(await verifyUserActor(c, 'victim@example.com')).toBe(false);
  });

  it('отклоняет запрос без заголовка X-User-Token', async () => {
    expect(await verifyUserActor(makeContext(), 'owner@example.com')).toBe(false);
  });

  it('verifiedEmailFromToken возвращает нормализованный email владельца', async () => {
    const token = await signUserToken('Owner@Example.COM');
    const c = makeContext({ 'X-User-Token': token! });
    expect(await verifiedEmailFromToken(c)).toBe('owner@example.com');
  });

  // ── Регрессия: раньше отсутствие секрета означало «доверять callerEmail» ─────
  it('без USER_JWT_SECRET отклоняет запрос (fail-closed)', async () => {
    delete process.env.USER_JWT_SECRET;
    expect(userAuthEnabled()).toBe(false);
    expect(userAuthEnforced()).toBe(true);
    expect(await verifyUserActor(makeContext(), 'owner@example.com')).toBe(false);
  });

  it('без секрета пропускает только при явном USER_AUTH_LEGACY_OPEN=1', async () => {
    delete process.env.USER_JWT_SECRET;
    process.env.USER_AUTH_LEGACY_OPEN = '1';
    expect(userLegacyOpen()).toBe(true);
    expect(userAuthEnforced()).toBe(false);
    expect(await verifyUserActor(makeContext(), 'owner@example.com')).toBe(true);
  });

  it('USER_AUTH_LEGACY_OPEN не действует, пока секрет настроен', async () => {
    process.env.USER_AUTH_LEGACY_OPEN = '1';
    expect(userAuthEnforced()).toBe(true);
    expect(await verifyUserActor(makeContext(), 'owner@example.com')).toBe(false);
  });

  it('signUserToken не выдаёт токен без секрета', async () => {
    delete process.env.USER_JWT_SECRET;
    expect(await signUserToken('owner@example.com')).toBeUndefined();
  });
});

describe('userUnauthorized', () => {
  it('отдаёт 401 с кодом, по которому клиент понимает, что надо перелогиниться', () => {
    const res = userUnauthorized(makeContext()) as any;
    expect(res.status).toBe(401);
    expect(res.body.code).toBe(USER_TOKEN_INVALID);
  });
});
