// Правила смены статуса заявок и расчёты по заявке. Сам учёт мест и замок груза — функции
// в базе (миграция 20260915130000, вызов в bookingStore.tsx).

export interface OfferCounts {
  requestedSeats?: number;
  requestedChildren?: number;
  requestedCargo?: number;
}

const CLOSED_TRIP_STATUSES = ['cancelled', 'completed', 'deleted'];

export function isTripClosed(trip: any): boolean {
  return !trip || !!trip.deletedAt || CLOSED_TRIP_STATUSES.includes(trip.status);
}

export type OfferRole = 'driver' | 'sender';

// Оффер на поездку: отправитель просит места, водитель решает.
const TRIP_OFFER_TRANSITIONS: Record<OfferRole, Record<string, string[]>> = {
  driver: {
    pending: ['accepted', 'declined', 'rejected'],
    accepted: ['cancelled'],
  },
  sender: {
    pending: ['cancelled'],
    accepted: ['cancelled'],
  },
};

// Отклик на груз: водитель предлагает перевозку, отправитель груза решает.
const CARGO_OFFER_TRANSITIONS: Record<OfferRole, Record<string, string[]>> = {
  sender: {
    pending: ['accepted', 'rejected', 'declined'],
    accepted: ['cancelled', 'rejected'],
  },
  driver: {
    pending: ['cancelled'],
    accepted: ['cancelled'],
  },
};

export function canChangeTripOffer(role: OfferRole, from: string, to: string): boolean {
  return !!TRIP_OFFER_TRANSITIONS[role][from]?.includes(to);
}

export function canChangeCargoOffer(role: OfferRole, from: string, to: string): boolean {
  return !!CARGO_OFFER_TRANSITIONS[role][from]?.includes(to);
}

const MAX_REQUESTED = { requestedSeats: 50, requestedChildren: 50, requestedCargo: 100_000 };

/** Количество мест и груза в заявке: целые, не отрицательные, хотя бы что-то запрошено. */
export function parseOfferCounts(body: any):
  { ok: true; counts: Required<OfferCounts> } | { ok: false; error: string } {
  const counts = { requestedSeats: 0, requestedChildren: 0, requestedCargo: 0 };
  for (const field of Object.keys(MAX_REQUESTED) as (keyof typeof MAX_REQUESTED)[]) {
    const raw = body?.[field];
    if (raw == null || raw === '') continue;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > MAX_REQUESTED[field]) {
      return { ok: false, error: `${field} must be a whole number from 0 to ${MAX_REQUESTED[field]}` };
    }
    counts[field] = n;
  }
  if (counts.requestedSeats + counts.requestedChildren + counts.requestedCargo === 0) {
    return { ok: false, error: 'Request at least one seat or some cargo' };
  }
  return { ok: true, counts };
}

/** Та же формула, что во фронте (src/app/utils/pricing.ts): детское место — цена водителя, у старых поездок — половина взрослого. */
export function expectedOfferPrice(trip: any, counts: Required<OfferCounts>): number {
  const perSeat = Number(trip?.pricePerSeat) || 0;
  const perChild = Number(trip?.pricePerChild) || 0;
  const perKg = Number(trip?.pricePerKg) || 0;
  return counts.requestedSeats * perSeat
    + counts.requestedChildren * (perChild > 0 ? perChild : Math.round(perSeat / 2))
    + counts.requestedCargo * perKg;
}
