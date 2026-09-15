import { test, expect, type APIRequestContext } from '@playwright/test';
import { API, siteHeaders } from './env';

// Профиль и документы: персональные данные видит только владелец, статус проверки ставит только админ.
// Вход — тестовый (/e2e/login), существует только на тестовой площадке.

const run = Date.now().toString(36);
const owner = `e2e+profile-${run}@ovora.test`;
const stranger = `e2e+stranger-${run}@ovora.test`;
const PHONE = '+992900000001';

async function login(request: APIRequestContext, email: string, role: 'driver' | 'sender') {
  const res = await request.post(`${API}/e2e/login`, { headers: siteHeaders(), data: { email, role } });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()).token as string;
}

const as = (token: string) => siteHeaders({ 'X-User-Token': token });

test.describe.serial('профиль и документы', () => {
  let ownerToken = '';
  let strangerToken = '';

  test.beforeAll(async ({ request }) => {
    const probe = await request.post(`${API}/e2e/login`, { headers: siteHeaders(), data: { email: owner, role: 'driver' } });
    test.skip(probe.status() === 404, 'тестовый вход выключен на этом сервере');
    ownerToken = await login(request, owner, 'driver');
    strangerToken = await login(request, stranger, 'sender');
  });

  test('владелец меняет профиль, но не роль, статус и проверку', async ({ request }) => {
    const res = await request.put(`${API}/users/${encodeURIComponent(owner)}`, {
      headers: as(ownerToken),
      data: { phone: PHONE, firstName: 'Профиль', role: 'sender', status: 'blocked', isVerified: true, rating: 5, documentsVerified: true },
    });
    expect(res.status(), await res.text()).toBe(200);
    const user = (await res.json()).user;
    expect(user.phone).toBe(PHONE);
    expect(user.firstName).toBe('Профиль');
    expect(user.role).toBe('driver');
    expect(user.status).not.toBe('blocked');
    expect(user.isVerified).not.toBe(true);
    expect(user.rating).not.toBe(5);
    expect(user.documentsVerified).not.toBe(true);
  });

  test('чужой профиль нельзя изменить', async ({ request }) => {
    const res = await request.put(`${API}/users/${encodeURIComponent(owner)}`, {
      headers: as(strangerToken),
      data: { firstName: 'Взлом' },
    });
    expect(res.status()).toBe(403);
  });

  test('телефон виден владельцу и не виден другим', async ({ request }) => {
    const own = await (await request.get(`${API}/users/${encodeURIComponent(owner)}`, { headers: as(ownerToken) })).json();
    expect(own.user.phone).toBe(PHONE);

    const other = await (await request.get(`${API}/users/${encodeURIComponent(owner)}`, { headers: as(strangerToken) })).json();
    expect(other.user.email).toBe(owner);
    expect(other.user.phone).toBeUndefined();

    const anonymous = await (await request.get(`${API}/users/${encodeURIComponent(owner)}`, { headers: siteHeaders() })).json();
    expect(anonymous.user.phone).toBeUndefined();
  });

  test('чужие документы не читаются', async ({ request }) => {
    const res = await request.get(`${API}/documents/user/${encodeURIComponent(owner)}?callerEmail=${encodeURIComponent(owner)}`, {
      headers: as(strangerToken),
    });
    expect(res.status()).toBe(403);
  });

  test('загруженный документ без распознанного ФИО уходит на ручную проверку', async ({ request }) => {
    // 1×1 PNG: распознать нечего — документ не может стать «проверенным» сам.
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
    const headers = as(ownerToken);
    delete headers['Content-Type'];
    const res = await request.post(`${API}/documents/upload`, {
      headers,
      multipart: {
        file: { name: 'passport.png', mimeType: 'image/png', buffer: png },
        userEmail: owner, documentId: 'passport', documentType: 'passport', title: 'Паспорт', subtitle: 'e2e',
      },
    });
    expect(res.status(), await res.text()).toBe(200);
    const doc = (await res.json()).document;
    expect(doc.status).toBe('pending');
    expect(doc.userEmail).toBe(owner);
  });

  test('тип документа — только из списка', async ({ request }) => {
    const headers = as(ownerToken);
    delete headers['Content-Type'];
    const res = await request.post(`${API}/documents/upload`, {
      headers,
      multipart: {
        file: { name: 'x.png', mimeType: 'image/png', buffer: Buffer.from('x') },
        userEmail: owner, documentId: 'x', documentType: '../../etc', title: 'x', subtitle: 'x',
      },
    });
    expect(res.status()).toBe(400);
  });

  test('свои документы читаются', async ({ request }) => {
    const res = await request.get(`${API}/documents/user/${encodeURIComponent(owner)}`, { headers: as(ownerToken) });
    expect(res.status(), await res.text()).toBe(200);
    const docs = (await res.json()).documents;
    const passport = docs.find((d: any) => d.id === 'passport');
    expect(passport?.status).toBe('pending');
    expect(passport?.documentNumber).toBeUndefined();
  });

  test('владелец не может сам поставить документу «проверен»', async ({ request }) => {
    const res = await request.put(`${API}/documents/doc-${run}`, {
      headers: as(ownerToken),
      data: { userEmail: owner, status: 'verified' },
    });
    expect(res.status()).toBe(404);
  });

  test('менять статус документа без админа нельзя', async ({ request }) => {
    const res = await request.put(`${API}/admin/documents/doc-${run}/status`, {
      headers: as(ownerToken),
      data: { userEmail: owner, status: 'verified' },
    });
    expect([401, 403]).toContain(res.status());
  });
});
