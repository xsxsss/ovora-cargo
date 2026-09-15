import { describe, it, expect } from 'vitest';
import { requestLimitPolicy, isAdminPath } from './requestLimits.tsx';

const P = '/make-server-4e36197a';
const user = { kind: 'user', id: 'a@b.c' } as const;
const avia = { kind: 'avia', id: '992900000000' } as const;
const ip = { kind: 'ip', id: '1.2.3.4' } as const;

describe('requestLimitPolicy', () => {
  it('preflight CORS не ограничивается', () => {
    expect(requestLimitPolicy('OPTIONS', `${P}/trips`, ip)).toBeNull();
  });

  it('чтение и запись считаются раздельно — опрос экрана не съедает лимит на отправку', () => {
    const read = requestLimitPolicy('GET', `${P}/trips`, user)!;
    const write = requestLimitPolicy('POST', `${P}/offers`, user)!;
    expect(read.bucket).not.toBe(write.bucket);
    expect(read.max).toBeGreaterThan(write.max);
  });

  it('вошедший пользователь считается по аккаунту, а не по IP', () => {
    expect(requestLimitPolicy('GET', `${P}/trips`, user)!.bucket).toContain('user:a@b.c');
    expect(requestLimitPolicy('GET', `${P}/avia/flights`, avia)!.bucket).toContain('avia:992900000000');
  });

  it('разные пользователи не делят лимит', () => {
    const a = requestLimitPolicy('POST', `${P}/offers`, user)!;
    const b = requestLimitPolicy('POST', `${P}/offers`, { kind: 'user', id: 'x@y.z' })!;
    expect(a.bucket).not.toBe(b.bucket);
  });

  it('админка получает больший лимит — массовые действия', () => {
    const admin = requestLimitPolicy('DELETE', `${P}/admin/cargos/1`, ip)!;
    const anon = requestLimitPolicy('DELETE', `${P}/cargos/1`, ip)!;
    expect(admin.max).toBeGreaterThan(anon.max);
    expect(admin.bucket).toContain(':admin:');
  });

  it('анонимам не меньше чтения, чем вошедшим — у операторов много людей на одном IP', () => {
    expect(requestLimitPolicy('GET', `${P}/trips`, ip)!.max)
      .toBeGreaterThanOrEqual(requestLimitPolicy('GET', `${P}/trips`, user)!.max);
  });

  it('метод в нижнем регистре обрабатывается так же', () => {
    expect(requestLimitPolicy('get', `${P}/trips`, ip)!.bucket).toContain(':read:');
  });
});

describe('isAdminPath', () => {
  it('узнаёт разделы админки с префиксом функции и без', () => {
    expect(isAdminPath(`${P}/admin/users`)).toBe(true);
    expect(isAdminPath(`${P}/avia/admin/users`)).toBe(true);
    expect(isAdminPath(`${P}/kv/list`)).toBe(true);
    expect(isAdminPath('/admin/users')).toBe(true);
  });

  it('обычные адреса и похожие имена — не админка', () => {
    expect(isAdminPath(`${P}/avia/flights`)).toBe(false);
    expect(isAdminPath(`${P}/administration`)).toBe(false);
    expect(isAdminPath(`${P}/trips`)).toBe(false);
  });
});
