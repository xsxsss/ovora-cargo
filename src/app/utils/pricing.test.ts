import { describe, it, expect } from 'vitest';
import { childSeatPrice } from './pricing';
import { expectedOfferPrice } from '../../../supabase/functions/make-server-4e36197a/capacity.tsx';

describe('childSeatPrice', () => {
  it('цена, которую указал водитель', () => {
    expect(childSeatPrice({ pricePerSeat: 300, pricePerChild: 120 })).toBe(120);
  });

  it('старая поездка без цены ребёнка — половина взрослого места', () => {
    expect(childSeatPrice({ pricePerSeat: 125 })).toBe(63);
    expect(childSeatPrice({ pricePerSeat: 125, pricePerChild: 0 })).toBe(63);
  });

  it('цены строкой из старых записей', () => {
    expect(childSeatPrice({ pricePerSeat: '300', pricePerChild: '150' })).toBe(150);
  });

  it('сайт и сервер считают итог одинаково — иначе сервер отклонит заявку', () => {
    const trip = { pricePerSeat: 300, pricePerChild: 120, pricePerKg: 5 };
    const counts = { requestedSeats: 2, requestedChildren: 3, requestedCargo: 10 };
    const siteTotal = counts.requestedSeats * trip.pricePerSeat + counts.requestedChildren * childSeatPrice(trip) + counts.requestedCargo * trip.pricePerKg;
    expect(expectedOfferPrice(trip, counts)).toBe(siteTotal);
  });
});
