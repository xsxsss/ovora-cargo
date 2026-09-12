import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { signAviaToken, verifyAviaActor, aviaAuthEnabled, aviaLegacyOpen, aviaUnauthorized, AVIA_TOKEN_INVALID } from './aviaAuth.tsx';

const SECRET = 'avia-test-secret-key-at-least-32-chars-long';

function makeContext(headers: Record<string, string> = {}) {
  return {
    req: { header: (name: string) => headers[name], path: '/make-server-4e36197a/avia/profile/992900000000' },
    json: (body: unknown, status?: number) => ({ body, status: status ?? 200 }),
  };
}

describe('verifyAviaActor', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env.AVIA_JWT_SECRET = SECRET;
    delete process.env.AVIA_AUTH_LEGACY_OPEN;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('пропускает владельца токена', async () => {
    const token = await signAviaToken('992900000000');
    expect(token).toBeTypeOf('string');
    const c = makeContext({ 'X-Avia-Token': token! });
    expect(await verifyAviaActor(c, '992900000000')).toBe(true);
  });

  it('отклоняет подмену чужого номера при валидном своём токене', async () => {
    const token = await signAviaToken('992900000000');
    const c = makeContext({ 'X-Avia-Token': token! });
    expect(await verifyAviaActor(c, '992911111111')).toBe(false);
  });

  it('отклоняет запрос без заголовка X-Avia-Token', async () => {
    expect(await verifyAviaActor(makeContext(), '992900000000')).toBe(false);
  });

  it('отклоняет токен, подписанный другим секретом', async () => {
    const token = await signAviaToken('992900000000');
    process.env.AVIA_JWT_SECRET = 'another-secret-key-at-least-32-characters';
    const c = makeContext({ 'X-Avia-Token': token! });
    expect(await verifyAviaActor(c, '992900000000')).toBe(false);
  });

  // ── Регрессия: раньше отсутствие секрета означало «пропустить всех» ──────────
  it('без AVIA_JWT_SECRET отклоняет запрос (fail-closed)', async () => {
    delete process.env.AVIA_JWT_SECRET;
    expect(aviaAuthEnabled()).toBe(false);
    expect(await verifyAviaActor(makeContext(), '992900000000')).toBe(false);
  });

  it('без секрета пропускает только при явном AVIA_AUTH_LEGACY_OPEN=1', async () => {
    delete process.env.AVIA_JWT_SECRET;
    process.env.AVIA_AUTH_LEGACY_OPEN = '1';
    expect(aviaLegacyOpen()).toBe(true);
    expect(await verifyAviaActor(makeContext(), '992900000000')).toBe(true);
  });

  it('AVIA_AUTH_LEGACY_OPEN не действует, пока секрет настроен', async () => {
    process.env.AVIA_AUTH_LEGACY_OPEN = '1';
    expect(await verifyAviaActor(makeContext(), '992900000000')).toBe(false);
  });

  it('любое значение AVIA_AUTH_LEGACY_OPEN кроме "1" не открывает доступ', async () => {
    delete process.env.AVIA_JWT_SECRET;
    for (const v of ['0', 'true', 'yes', '']) {
      process.env.AVIA_AUTH_LEGACY_OPEN = v;
      expect(await verifyAviaActor(makeContext(), '992900000000')).toBe(false);
    }
  });

  it('signAviaToken не выдаёт токен без секрета', async () => {
    delete process.env.AVIA_JWT_SECRET;
    expect(await signAviaToken('992900000000')).toBeUndefined();
  });
});

describe('aviaUnauthorized', () => {
  it('отдаёт 401 с кодом, по которому клиент понимает, что надо перелогиниться', () => {
    const res = aviaUnauthorized(makeContext()) as any;
    expect(res.status).toBe(401);
    expect(res.body.code).toBe(AVIA_TOKEN_INVALID);
  });
});
