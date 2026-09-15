import { describe, it, expect } from 'vitest';
import {
  isTripClosed, canChangeTripOffer, canChangeCargoOffer, parseOfferCounts, expectedOfferPrice,
} from './capacity.tsx';

describe('isTripClosed', () => {
  it('открыты planned, active, inProgress, frozen', () => {
    for (const status of ['planned', 'active', 'inProgress', 'frozen']) {
      expect(isTripClosed({ status })).toBe(false);
    }
  });
  it('закрыты cancelled, completed, deleted и мягко удалённые', () => {
    expect(isTripClosed({ status: 'cancelled' })).toBe(true);
    expect(isTripClosed({ status: 'completed' })).toBe(true);
    expect(isTripClosed({ status: 'planned', deletedAt: '2026-09-14T10:00:00.000Z' })).toBe(true);
    expect(isTripClosed(null)).toBe(true);
  });
});

describe('правила смены статуса офферов', () => {
  it('на поездку: принимает только водитель, отправитель может только отменить', () => {
    expect(canChangeTripOffer('driver', 'pending', 'accepted')).toBe(true);
    expect(canChangeTripOffer('driver', 'pending', 'declined')).toBe(true);
    expect(canChangeTripOffer('sender', 'pending', 'accepted')).toBe(false);
    expect(canChangeTripOffer('sender', 'pending', 'cancelled')).toBe(true);
    expect(canChangeTripOffer('sender', 'accepted', 'cancelled')).toBe(true);
    expect(canChangeTripOffer('driver', 'accepted', 'cancelled')).toBe(true);
  });

  it('на поездку: закрытый оффер не оживает', () => {
    for (const from of ['cancelled', 'declined', 'rejected']) {
      expect(canChangeTripOffer('driver', from, 'accepted')).toBe(false);
      expect(canChangeTripOffer('sender', from, 'pending')).toBe(false);
    }
  });

  it('на груз: принимает только отправитель груза, водитель может только отозвать', () => {
    expect(canChangeCargoOffer('sender', 'pending', 'accepted')).toBe(true);
    expect(canChangeCargoOffer('sender', 'pending', 'rejected')).toBe(true);
    expect(canChangeCargoOffer('driver', 'pending', 'accepted')).toBe(false);
    expect(canChangeCargoOffer('driver', 'pending', 'cancelled')).toBe(true);
    expect(canChangeCargoOffer('driver', 'rejected', 'accepted')).toBe(false);
  });
});

describe('parseOfferCounts', () => {
  it('принимает целые неотрицательные числа, пустые поля считает нулём', () => {
    expect(parseOfferCounts({ requestedSeats: 2, requestedChildren: '', requestedCargo: '15' }))
      .toEqual({ ok: true, counts: { requestedSeats: 2, requestedChildren: 0, requestedCargo: 15 } });
  });

  it('отклоняет отрицательные — иначе принятие прибавило бы места поездке', () => {
    expect(parseOfferCounts({ requestedSeats: -5 }).ok).toBe(false);
  });

  it('отклоняет дробные, нечисловые и огромные значения', () => {
    expect(parseOfferCounts({ requestedSeats: 1.5 }).ok).toBe(false);
    expect(parseOfferCounts({ requestedCargo: 'abc' }).ok).toBe(false);
    expect(parseOfferCounts({ requestedSeats: 1e9 }).ok).toBe(false);
  });

  it('отклоняет пустую заявку', () => {
    expect(parseOfferCounts({}).ok).toBe(false);
    expect(parseOfferCounts({ requestedSeats: 0, requestedCargo: 0 }).ok).toBe(false);
  });
});

describe('expectedOfferPrice', () => {
  it('детское место — цена, которую указал водитель', () => {
    const t = { pricePerSeat: 300, pricePerChild: 120, pricePerKg: 3 };
    expect(expectedOfferPrice(t, { requestedSeats: 1, requestedChildren: 2, requestedCargo: 0 })).toBe(300 + 2 * 120);
  });

  it('старая поездка без цены ребёнка — половина взрослого места', () => {
    const t = { pricePerSeat: 125, pricePerKg: 3 };
    expect(expectedOfferPrice(t, { requestedSeats: 2, requestedChildren: 3, requestedCargo: 10 }))
      .toBe(2 * 125 + 3 * Math.round(125 / 2) + 10 * 3);
  });

  it('цены строкой из старых записей тоже считаются', () => {
    expect(expectedOfferPrice({ pricePerSeat: '100' }, { requestedSeats: 1, requestedChildren: 0, requestedCargo: 0 })).toBe(100);
  });
});
