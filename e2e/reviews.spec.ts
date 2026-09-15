import { test, expect, type APIRequestContext } from '@playwright/test';
import { API, siteHeaders } from './env';

// Отзывы: только попутчик по завершённой поездке, оценка 1..5, один отзыв на поездку, «проверенный» ставит сервер.
// Вход — тестовый (/e2e/login), существует только на тестовой площадке.

const run = Date.now().toString(36);
const driver = `e2e+rev-driver-${run}@ovora.test`;
const sender = `e2e+rev-sender-${run}@ovora.test`;
const stranger = `e2e+rev-stranger-${run}@ovora.test`;

async function login(request: APIRequestContext, email: string, role: 'driver' | 'sender') {
  const res = await request.post(`${API}/e2e/login`, { headers: siteHeaders(), data: { email, role } });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()).token as string;
}

const as = (token: string) => siteHeaders({ 'X-User-Token': token });

test.describe.serial('отзывы', () => {
  let driverToken = '';
  let senderToken = '';
  let strangerToken = '';
  let tripId = '';
  let reviewId = '';

  test.beforeAll(async ({ request }) => {
    const probe = await request.post(`${API}/e2e/login`, { headers: siteHeaders(), data: { email: driver, role: 'driver' } });
    test.skip(probe.status() === 404, 'тестовый вход выключен на этом сервере');
    driverToken = await login(request, driver, 'driver');
    senderToken = await login(request, sender, 'sender');
    strangerToken = await login(request, stranger, 'sender');
  });

  test('подготовка: поездка, принятая бронь, поездка завершена', async ({ request }) => {
    const created = await request.post(`${API}/trips`, {
      headers: as(driverToken),
      data: { driverEmail: driver, driverName: 'D', from: 'A', to: 'B', date: new Date().toISOString().slice(0, 10),
        availableSeats: 2, childSeats: 0, cargoCapacity: 0, pricePerSeat: 100, pricePerChild: 0, pricePerKg: 0 },
    });
    expect(created.status(), await created.text()).toBe(200);
    tripId = (await created.json()).trip.id;

    const offer = await request.post(`${API}/offers`, {
      headers: as(senderToken), data: { tripId, senderEmail: sender, senderName: 'S', requestedSeats: 1, price: 100 },
    });
    expect(offer.status(), await offer.text()).toBe(200);
    const offerId = (await offer.json()).offer.offerId;
    const accepted = await request.put(`${API}/offers/${tripId}/${offerId}`, { headers: as(driverToken), data: { status: 'accepted' } });
    expect(accepted.status(), await accepted.text()).toBe(200);

    for (const status of ['inProgress', 'completed']) {
      const res = await request.put(`${API}/trips/${tripId}`, { headers: as(driverToken), data: { status } });
      expect(res.status(), await res.text()).toBe(200);
    }
  });

  const review = (over: Record<string, unknown> = {}) => ({
    authorEmail: sender, targetEmail: driver, tripId, rating: 5, comment: 'Хорошо', authorName: 'S', ...over,
  });

  test('оценка вне 1..5 отклоняется', async ({ request }) => {
    for (const rating of [0, 6, 1000, 4.5]) {
      const res = await request.post(`${API}/reviews`, { headers: as(senderToken), data: review({ rating }) });
      expect(res.status(), `rating ${rating}`).toBe(400);
    }
  });

  test('посторонний не оставляет отзыв о чужой поездке', async ({ request }) => {
    const res = await request.post(`${API}/reviews`, { headers: as(strangerToken), data: review({ authorEmail: stranger }) });
    expect(res.status()).toBe(403);
  });

  test('попутчик оставляет отзыв; «проверенный» и лишние поля — решает сервер', async ({ request }) => {
    const res = await request.post(`${API}/reviews`, {
      headers: as(senderToken), data: review({ rating: 4, verified: false, helpful: 999, categories: { punctuality: 100 } }),
    });
    expect(res.status(), await res.text()).toBe(200);
    const saved = (await res.json()).review;
    reviewId = saved.reviewId;
    expect(saved.rating).toBe(4);
    expect(saved.verified).toBe(true);
    expect(saved.helpful).toBeUndefined();
    expect(saved.categories.punctuality).toBe(4);
  });

  test('второй отзыв на ту же поездку — 409', async ({ request }) => {
    const res = await request.post(`${API}/reviews`, { headers: as(senderToken), data: review() });
    expect(res.status()).toBe(409);
  });

  test('отзыв виден в отзывах водителя, рейтинг пересчитан', async ({ request }) => {
    const list = await (await request.get(`${API}/reviews/user/${encodeURIComponent(driver)}`, { headers: siteHeaders() })).json();
    expect(list.reviews.some((r: any) => r.reviewId === reviewId)).toBe(true);
    const stats = await (await request.get(`${API}/users/${encodeURIComponent(driver)}/stats?role=driver`, { headers: siteHeaders() })).json();
    expect(stats.avgRating).toBe(4);
  });

  test('чужой отзыв не удалить', async ({ request }) => {
    const res = await request.delete(`${API}/reviews/${reviewId}`, { headers: as(strangerToken), data: { callerEmail: sender } });
    expect(res.status()).toBe(404);
    const byAdminRoute = await request.delete(`${API}/admin/reviews/${reviewId}`, { headers: as(strangerToken) });
    expect([401, 403]).toContain(byAdminRoute.status());
  });
});
