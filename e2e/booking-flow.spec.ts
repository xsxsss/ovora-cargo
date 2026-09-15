import { test, expect, type APIRequestContext } from '@playwright/test';
import { API, siteHeaders } from './env';

// Главный путь денег и мест: поездка → заявки → принятие → учёт мест → отмена.
// Вход — тестовый (/e2e/login), существует только на тестовой площадке.

const run = Date.now().toString(36);
const driver = `e2e+driver-${run}@ovora.test`;
const sender = `e2e+sender-${run}@ovora.test`;
const sender2 = `e2e+sender2-${run}@ovora.test`;

async function login(request: APIRequestContext, email: string, role: 'driver' | 'sender') {
  const res = await request.post(`${API}/e2e/login`, { headers: siteHeaders(), data: { email, role } });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()).token as string;
}

const as = (token: string) => siteHeaders({ 'X-User-Token': token });

async function getTrip(request: APIRequestContext, id: string) {
  const res = await request.get(`${API}/trips/${id}`, { headers: siteHeaders() });
  return (await res.json()).trip;
}

test.describe.serial('бронирование мест', () => {
  let driverToken = '';
  let senderToken = '';
  let sender2Token = '';
  let tripId = '';
  let offerId = '';
  let offer2Id = '';

  test.beforeAll(async ({ request }) => {
    const probe = await request.post(`${API}/e2e/login`, { headers: siteHeaders(), data: { email: driver, role: 'driver' } });
    test.skip(probe.status() === 404, 'тестовый вход выключен на этом сервере');
    driverToken = await login(request, driver, 'driver');
    senderToken = await login(request, sender, 'sender');
    sender2Token = await login(request, sender2, 'sender');
  });

  test('водитель публикует поездку: 3 места по 100, 2 детских по 40', async ({ request }) => {
    const res = await request.post(`${API}/trips`, {
      headers: as(driverToken),
      data: {
        driverEmail: driver, driverName: 'E2E Driver', from: 'Душанбе', to: 'Худжанд',
        date: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
        availableSeats: 3, childSeats: 2, cargoCapacity: 0, pricePerSeat: 100, pricePerChild: 40, pricePerKg: 0,
      },
    });
    expect(res.status(), await res.text()).toBe(200);
    const { trip } = await res.json();
    tripId = trip.id;
    expect(trip.status).toBe('planned');
  });

  test('опубликовать поездку от чужого имени нельзя', async ({ request }) => {
    const res = await request.post(`${API}/trips`, {
      headers: as(senderToken),
      data: { driverEmail: driver, from: 'A', to: 'B', availableSeats: 3 },
    });
    expect(res.status()).toBe(403);
  });

  test('заявка с неверной ценой отклоняется', async ({ request }) => {
    const res = await request.post(`${API}/offers`, {
      headers: as(senderToken),
      data: { tripId, senderEmail: sender, senderName: 'S1', requestedSeats: 2, price: 1 },
    });
    expect(res.status()).toBe(400);
  });

  test('детское место по цене водителя, а не половина взрослого', async ({ request }) => {
    const halfPrice = await request.post(`${API}/offers`, {
      headers: as(senderToken),
      data: { tripId, senderEmail: sender, senderName: 'S1', requestedSeats: 2, requestedChildren: 1, price: 250 },
    });
    expect(halfPrice.status()).toBe(400);
  });

  test('отправитель бронирует 2 места и 1 детское по правильной цене', async ({ request }) => {
    const res = await request.post(`${API}/offers`, {
      headers: as(senderToken),
      data: { tripId, senderEmail: sender, senderName: 'S1', requestedSeats: 2, requestedChildren: 1, price: 240 },
    });
    expect(res.status(), await res.text()).toBe(200);
    const { offer } = await res.json();
    offerId = offer.offerId;
    expect(offer.driverEmail).toBe(driver);
    expect(offer.status).toBe('pending');
  });

  test('отправитель не может сам принять свою заявку', async ({ request }) => {
    const res = await request.put(`${API}/offers/${tripId}/${offerId}`, { headers: as(senderToken), data: { status: 'accepted' } });
    expect(res.status()).toBe(403);
    expect((await getTrip(request, tripId)).availableSeats).toBe(3);
  });

  test('водитель принимает — свободных мест становится 1', async ({ request }) => {
    const res = await request.put(`${API}/offers/${tripId}/${offerId}`, { headers: as(driverToken), data: { status: 'accepted' } });
    expect(res.status(), await res.text()).toBe(200);
    const trip = await getTrip(request, tripId);
    expect(trip.availableSeats).toBe(1);
    expect(trip.childSeats).toBe(1);
  });

  test('заявки поездки видит водитель, посторонний — нет', async ({ request }) => {
    const own = await (await request.get(`${API}/offers/trip/${tripId}`, { headers: as(driverToken) })).json();
    expect(own.offers.length).toBeGreaterThan(0);
    const stranger = await (await request.get(`${API}/offers/trip/${tripId}`, { headers: as(sender2Token) })).json();
    expect(stranger.offers).toEqual([]);
  });

  test('на 2 места при 1 свободном принять нельзя', async ({ request }) => {
    const created = await request.post(`${API}/offers`, {
      headers: as(sender2Token),
      data: { tripId, senderEmail: sender2, senderName: 'S2', requestedSeats: 2, price: 200 },
    });
    expect(created.status(), await created.text()).toBe(200);
    offer2Id = (await created.json()).offer.offerId;

    const res = await request.put(`${API}/offers/${tripId}/${offer2Id}`, { headers: as(driverToken), data: { status: 'accepted' } });
    expect(res.status()).toBe(409);
    expect((await getTrip(request, tripId)).availableSeats).toBe(1);
  });

  test('вторую ожидающую заявку на ту же поездку не создать', async ({ request }) => {
    const res = await request.post(`${API}/offers`, {
      headers: as(sender2Token),
      data: { tripId, senderEmail: sender2, senderName: 'S2', requestedSeats: 1, price: 100 },
    });
    expect(res.status()).toBe(409);
    expect((await res.json()).offer?.offerId).toBe(offer2Id);
  });

  test('отправитель отменяет принятую бронь — места возвращаются', async ({ request }) => {
    const res = await request.put(`${API}/offers/${tripId}/${offerId}`, { headers: as(senderToken), data: { status: 'cancelled' } });
    expect(res.status(), await res.text()).toBe(200);
    const trip = await getTrip(request, tripId);
    expect(trip.availableSeats).toBe(3);
    expect(trip.childSeats).toBe(2);
  });

  test('отменённую бронь нельзя «оживить»', async ({ request }) => {
    const res = await request.put(`${API}/offers/${tripId}/${offerId}`, { headers: as(driverToken), data: { status: 'accepted' } });
    expect(res.status()).toBe(403);
    expect((await getTrip(request, tripId)).availableSeats).toBe(3);
  });

  test('водитель отменяет поездку — заявки отменяются, отправитель получает уведомление', async ({ request }) => {
    const res = await request.put(`${API}/trips/${tripId}`, { headers: as(driverToken), data: { status: 'cancelled' } });
    expect(res.status(), await res.text()).toBe(200);

    const offers = (await (await request.get(`${API}/offers/trip/${tripId}`, { headers: as(driverToken) })).json()).offers;
    expect(offers.find((o: any) => o.offerId === offer2Id)?.status).toBe('cancelled');

    const notes = (await (await request.get(`${API}/notifications/${encodeURIComponent(sender2)}`, { headers: as(sender2Token) })).json()).notifications;
    expect(notes.some((n: any) => n.title === 'Поездка отменена')).toBe(true);
  });

  test('на отменённую поездку забронировать нельзя', async ({ request }) => {
    const res = await request.post(`${API}/offers`, {
      headers: as(senderToken),
      data: { tripId, senderEmail: sender, senderName: 'S1', requestedSeats: 1, price: 100 },
    });
    expect([404, 409]).toContain(res.status());
  });

  test('чужие уведомления не читаются', async ({ request }) => {
    const res = await request.get(`${API}/notifications/${encodeURIComponent(sender2)}`, { headers: as(senderToken) });
    expect(res.status()).toBe(403);
  });
});

test('на боевом сервере тестового входа нет', async ({ request }) => {
  const prod = 'https://mkbcjxnoeevtkzaqcpsh.supabase.co/functions/v1/make-server-4e36197a';
  const res = await request.post(`${prod}/e2e/login`, {
    headers: { ...siteHeaders(), Origin: 'https://ovora-cargo.saburov.workers.dev' },
    data: { email: 'e2e+probe@ovora.test', role: 'driver' },
  });
  expect(res.status()).toBe(404);
});
