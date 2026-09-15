import { describe, it, expect } from 'vitest';
import {
  tripToRow, rowToTrip, offerToRow, rowToOffer, cargoToRow, rowToCargo, cargoOfferToRow, rowToCargoOffer,
} from './bookingRows.tsx';

// Формы взяты с боевых записей KV (2026-09-15): переезд не должен изменить JSON, который видит сайт.
const TRIP = {
  id: '1783453626133_tisibe', driverEmail: 'driver@mail.ru', status: 'planned', from: 'Копейск', to: 'Душанбе',
  date: '2026-07-10', time: '08:00', availableSeats: 2, childSeats: 1, cargoCapacity: 150, pricePerSeat: 1,
  pricePerChild: 4, pricePerKg: 2, currency: 'TJS', createdAt: '2026-07-07T19:47:06.133Z',
  updatedAt: '2026-09-14T11:25:32.843Z', driverName: 'Гог Ош', driverPhone: '+992900000000',
  driverAvatar: null, driverRating: null, driverVerified: true, fromLat: 55.1, fromLng: 61.6, toLat: 38.5,
  toLng: 68.7, fromCountry: 'RU', toCountry: 'TJ', notes: '', tripType: 'trip', mapImage: 'x.png',
};

const OFFER = {
  offerId: '1789235710088_abc', tripId: TRIP.id, senderEmail: 'sender@mail.ru', driverEmail: 'driver@mail.ru',
  senderName: 'S', senderPhone: '+992', status: 'accepted', requestedSeats: 1, requestedChildren: 1,
  requestedCargo: 0, price: 5, currency: 'TJS', type: 'seats', cargoType: 'Пассажирские места',
  weight: '1 взр. + 1 дет.', volume: '', notes: '', from: 'Копейск', to: 'Душанбе', date: '2026-07-10',
  vehicleType: 'Газель', idempotencyKey: 'k', createdAt: '2026-09-14T10:00:00.000Z',
  updatedAt: '2026-09-14T10:05:00.000Z', acceptedAt: '2026-09-14T10:05:00.000Z',
};

const CARGO = {
  id: 'c1', senderEmail: 'sender@mail.ru', senderName: 'S', senderPhone: '+992', status: 'active',
  from: 'Москва', to: 'Душанбе', date: '2026-10-01', cargoWeight: 50, budget: 3000, currency: 'RUB',
  notes: 'хрупкое', tripType: 'cargo', createdAt: '2026-09-15T08:00:00.000Z', updatedAt: '2026-09-15T08:00:00.000Z',
};

const CARGO_OFFER = {
  offerId: 'k1', cargoId: 'c1', driverEmail: 'driver@mail.ru', driverName: 'D', senderEmail: 'sender@mail.ru',
  senderName: 'S', status: 'pending', price: 2500, message: 'заберу завтра',
  createdAt: '2026-09-15T09:00:00.000Z', updatedAt: '2026-09-15T09:00:00.000Z',
};

// PostgREST возвращает строку таблицы в JSON так же, как мы её записали.
const roundTrip = <T,>(toRow: (x: any) => any, fromRow: (r: any) => any, value: T) =>
  fromRow(JSON.parse(JSON.stringify(toRow(value))));

describe('JSON сайта не меняется после записи в таблицу и чтения обратно', () => {
  it('поездка', () => {
    const { driverAvatar: _a, driverRating: _r, ...withoutNulls } = TRIP;
    expect(roundTrip(tripToRow, rowToTrip, TRIP)).toEqual(withoutNulls);
  });
  it('заявка', () => expect(roundTrip(offerToRow, rowToOffer, OFFER)).toEqual(OFFER));
  it('груз', () => expect(roundTrip(cargoToRow, rowToCargo, CARGO)).toEqual(CARGO));
  it('отклик на груз', () => expect(roundTrip(cargoOfferToRow, rowToCargoOffer, CARGO_OFFER)).toEqual(CARGO_OFFER));
});

describe('колонки для расчётов заполнены верно', () => {
  it('поездка: места, цены и даты в колонках, прочее — в data', () => {
    const row = tripToRow(TRIP);
    expect(row).toMatchObject({
      driver_email: 'driver@mail.ru', origin: 'Копейск', destination: 'Душанбе', trip_date: '2026-07-10',
      available_seats: 2, child_seats: 1, cargo_capacity: 150, price_per_seat: 1, price_per_child: 4,
      deleted_at: null, completed_at: null,
    });
    expect(row.data).toMatchObject({ driverName: 'Гог Ош', fromLat: 55.1, time: '08:00' });
    expect(row.data).not.toHaveProperty('availableSeats');
  });

  it('почта приводится к нижнему регистру — иначе поиск «мои поездки» разойдётся с токеном', () => {
    expect(tripToRow({ ...TRIP, driverEmail: ' Driver@Mail.RU ' }).driver_email).toBe('driver@mail.ru');
    expect(offerToRow({ ...OFFER, senderEmail: 'Sender@Mail.ru' }).sender_email).toBe('sender@mail.ru');
  });

  it('мусорные числа из старых записей не нарушают ограничения базы', () => {
    const row = tripToRow({ ...TRIP, availableSeats: '-3', childSeats: 'abc', cargoCapacity: '1.5' });
    expect(row).toMatchObject({ available_seats: 0, child_seats: 0, cargo_capacity: 1.5 });
    const offer = offerToRow({ ...OFFER, requestedSeats: 2.7, price: -10 });
    expect(offer).toMatchObject({ requested_seats: 2, price: 0 });
  });

  it('удалённая поездка: deletedAt попадает в колонку и возвращается', () => {
    const deleted = { ...TRIP, status: 'cancelled', deletedAt: '2026-09-14T11:25:32.843Z' };
    expect(tripToRow(deleted).deleted_at).toBe('2026-09-14T11:25:32.843Z');
    expect(roundTrip(tripToRow, rowToTrip, deleted).deletedAt).toBe('2026-09-14T11:25:32.843Z');
  });

  it('груз без веса и бюджета — null, а не 0', () => {
    const row = cargoToRow({ ...CARGO, cargoWeight: '', budget: undefined });
    expect(row).toMatchObject({ cargo_weight: null, budget: null });
  });
});

describe('время', () => {
  it('формат Postgres (+00:00) приводится к прежнему ISO с Z', () => {
    const row = { ...JSON.parse(JSON.stringify(tripToRow(TRIP))), created_at: '2026-07-07T19:47:06.133+00:00' };
    expect(rowToTrip(row).createdAt).toBe('2026-07-07T19:47:06.133Z');
  });
});
