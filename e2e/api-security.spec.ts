import { test, expect } from '@playwright/test';
import { API, siteHeaders } from './env';

// Сервер обязан отказывать без входа и без прав. Если какой-то из этих тестов стал зелёным
// «не в ту сторону» — открылась дыра, выпускать нельзя.

test('сервер жив', async ({ request }) => {
  const res = await request.get(`${API}/health`, { headers: siteHeaders() });
  expect(await res.json()).toEqual({ status: 'ok' });
});

test.describe('CORS и CSRF', () => {
  test('посторонний сайт не получает разрешения читать ответы', async ({ request }) => {
    const res = await request.get(`${API}/health`, { headers: siteHeaders({ Origin: 'https://evil.example' }) });
    expect(res.headers()['access-control-allow-origin']).toBeUndefined();
  });

  test('наш сайт получает', async ({ request }) => {
    const res = await request.get(`${API}/health`, { headers: siteHeaders() });
    expect(res.headers()['access-control-allow-origin']).toBe(new URL(siteHeaders().Origin).origin);
  });

  test('запись без CSRF-заголовка отклоняется', async ({ request }) => {
    const headers = siteHeaders();
    delete headers['X-Csrf-Token'];
    const res = await request.post(`${API}/offers`, { headers, data: {} });
    expect(res.status()).toBe(403);
  });
});

test.describe('без входа нельзя действовать от чужого имени', () => {
  const denied = (status: number) => expect([400, 401, 403]).toContain(status);

  test('создать заявку на поездку', async ({ request }) => {
    const res = await request.post(`${API}/offers`, {
      headers: siteHeaders(),
      data: { tripId: 't1', senderEmail: 'victim@mail.ru', senderName: 'X', requestedSeats: 1 },
    });
    denied(res.status());
  });

  test('опубликовать поездку', async ({ request }) => {
    const res = await request.post(`${API}/trips`, {
      headers: siteHeaders(),
      data: { driverEmail: 'victim@mail.ru', from: 'A', to: 'B', availableSeats: 3 },
    });
    denied(res.status());
  });

  test('опубликовать груз', async ({ request }) => {
    const res = await request.post(`${API}/cargos`, {
      headers: siteHeaders(),
      data: { senderEmail: 'victim@mail.ru', from: 'A', to: 'B' },
    });
    denied(res.status());
  });

  test('перезаписать чужой профиль через регистрацию', async ({ request }) => {
    const res = await request.post(`${API}/auth/register`, {
      headers: siteHeaders(),
      data: { email: 'victim@mail.ru', role: 'driver', firstName: 'Hacked', phone: '+992000000000' },
    });
    expect(res.status()).toBe(403);
  });

  test('изменить чужой профиль', async ({ request }) => {
    const res = await request.put(`${API}/auth/user`, {
      headers: siteHeaders(),
      data: { email: 'victim@mail.ru', firstName: 'Hacked' },
    });
    expect(res.status()).toBe(403);
  });

  test('узнать имя и телефон человека по email', async ({ request }) => {
    const res = await request.post(`${API}/auth/login-email`, {
      headers: siteHeaders(),
      data: { email: 'victim@mail.ru' },
    });
    expect(res.status()).toBe(403);
  });

  test('видеть заявки чужой поездки с телефонами отправителей', async ({ request }) => {
    const trips = await (await request.get(`${API}/trips`, { headers: siteHeaders() })).json();
    const tripId = trips?.trips?.[0]?.id ?? 'no-trips';
    const res = await request.get(`${API}/offers/trip/${tripId}`, { headers: siteHeaders() });
    expect((await res.json()).offers ?? []).toEqual([]);
  });

  test('читать чужую переписку', async ({ request }) => {
    const res = await request.get(`${API}/chat/pair_x_y/messages?callerEmail=victim@mail.ru`, { headers: siteHeaders() });
    denied(res.status());
  });

  test('смотреть чужие документы', async ({ request }) => {
    const res = await request.get(`${API}/documents/${encodeURIComponent('victim@mail.ru')}`, { headers: siteHeaders() });
    expect(res.ok()).toBe(false);
  });
});

test.describe('админка', () => {
  test('без кода — 401', async ({ request }) => {
    const res = await request.get(`${API}/admin/users`, { headers: siteHeaders() });
    expect(res.status()).toBe(401);
  });

  test('с неверным кодом — 401', async ({ request }) => {
    const res = await request.get(`${API}/admin/users`, { headers: siteHeaders({ 'X-Admin-Code': 'wrong-code' }) });
    expect(res.status()).toBe(401);
  });

  test('поддельный токен админа не принимается', async ({ request }) => {
    const fake = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic3VwZXItYWRtaW4ifQ.fake';
    const res = await request.get(`${API}/admin/users`, { headers: siteHeaders({ 'X-Admin-Token': fake }) });
    expect(res.status()).toBe(401);
  });
});

test.describe('отписка от писем', () => {
  test('без подписи отписать нельзя', async ({ request }) => {
    const res = await request.post(`${API}/email/unsubscribe`, {
      headers: siteHeaders(),
      data: { email: 'victim@mail.ru', sig: 'forged' },
    });
    expect(res.status()).toBe(400);
  });

  test('старая ссылка из письма ведёт на страницу сайта и ничего не меняет сама', async ({ request }) => {
    const res = await request.get(`${API}/email/unsubscribe?email=victim@mail.ru`, {
      headers: siteHeaders(), maxRedirects: 0,
    });
    expect(res.status()).toBe(302);
    expect(res.headers()['location']).toContain('/unsubscribe?');
  });
});
