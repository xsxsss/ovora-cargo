// Учёт мест в поездках, замок груза и правила смены статуса офферов.
// Вынесено из index.ts, чтобы покрыть тестами: kv передаётся параметром.

export interface CapacityKV {
  get(key: string): Promise<any>;
  setIfUnchanged(key: string, expectedUpdatedAt: string | null, value: any): Promise<boolean>;
}

export interface OfferCounts {
  requestedSeats?: number;
  requestedChildren?: number;
  requestedCargo?: number;
}

export const FINAL_OFFER_STATUSES = ['cancelled', 'declined', 'deleted', 'rejected'];

const CLOSED_TRIP_STATUSES = ['cancelled', 'completed', 'deleted'];

export function isTripClosed(trip: any): boolean {
  return !trip || !!trip.deletedAt || CLOSED_TRIP_STATUSES.includes(trip.status);
}

export async function adjustTripCapacity(
  kv: CapacityKV,
  tripId: string,
  offer: OfferCounts,
  direction: -1 | 1,
  maxRetries = 3,
): Promise<'ok' | 'insufficient' | 'conflict' | 'not_found' | 'closed'> {
  const seats = offer.requestedSeats || 0;
  const children = offer.requestedChildren || 0;
  const cargo = offer.requestedCargo || 0;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const trip: any = await kv.get(`ovora:trip:${tripId}`);
    if (!trip) return 'not_found';

    if (direction === -1) {
      if (isTripClosed(trip)) return 'closed';
      if (seats > (trip.availableSeats || 0) ||
          children > (trip.childSeats || 0) ||
          cargo > (trip.cargoCapacity || 0)) {
        return 'insufficient';
      }
    }

    const next = {
      ...trip,
      updatedAt: nextUpdatedAt(trip.updatedAt),
      availableSeats: Math.max(0, (trip.availableSeats || 0) + direction * seats),
      childSeats: Math.max(0, (trip.childSeats || 0) + direction * children),
      cargoCapacity: Math.max(0, (trip.cargoCapacity || 0) + direction * cargo),
    };
    if (await kv.setIfUnchanged(`ovora:trip:${tripId}`, trip.updatedAt || null, next)) return 'ok';
  }
  return 'conflict';
}

export async function transitionCargoStatus(
  kv: CapacityKV,
  cargoId: string,
  from: string,
  to: string,
  maxRetries: number,
): Promise<'ok' | 'wrong_status' | 'conflict' | 'not_found'> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const cargo: any = await kv.get(`ovora:cargo:${cargoId}`);
    if (!cargo) return 'not_found';
    if (cargo.status !== from || cargo.deletedAt) return 'wrong_status';
    const next = { ...cargo, status: to, updatedAt: nextUpdatedAt(cargo.updatedAt) };
    if (await kv.setIfUnchanged(`ovora:cargo:${cargoId}`, cargo.updatedAt || null, next)) return 'ok';
  }
  return 'conflict';
}

/**
 * Условное изменение записи с перечитыванием на каждой попытке. `patch` получает свежую
 * запись и возвращает поля для записи или null, если менять нечего. `updatedAt` ставится сам.
 */
export async function patchRecord(
  kv: CapacityKV,
  key: string,
  patch: (current: any) => Record<string, unknown> | null,
  maxRetries = 3,
): Promise<{ result: 'ok' | 'skipped' | 'not_found' | 'conflict'; record?: any }> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const current: any = await kv.get(key);
    if (!current) return { result: 'not_found' };
    const changes = patch(current);
    if (!changes) return { result: 'skipped', record: current };
    const next = { ...current, ...changes, updatedAt: nextUpdatedAt(current.updatedAt) };
    if (await kv.setIfUnchanged(key, current.updatedAt || null, next)) return { result: 'ok', record: next };
  }
  return { result: 'conflict' };
}

/**
 * Смена статуса записи (оффер, отклик) только из ожидаемых статусов. Два запроса к одному
 * офферу — «принять» и «отменить» — не пройдут оба: второй получит wrong_status.
 * `previous` — запись, из которой сделан переход (или та, что помешала).
 */
export async function transitionRecordStatus(
  kv: CapacityKV,
  key: string,
  allowedFrom: string[],
  to: string,
  extra: Record<string, unknown> = {},
  maxRetries = 3,
): Promise<{ result: 'ok' | 'wrong_status' | 'not_found' | 'conflict'; previous?: any; record?: any }> {
  let previous: any;
  const write = await patchRecord(kv, key, (current) => {
    previous = current;
    return allowedFrom.includes(current.status) ? { ...extra, status: to } : null;
  }, maxRetries);
  if (write.result === 'skipped') return { result: 'wrong_status', previous };
  return { result: write.result, previous, record: write.record };
}

// Две записи в одну миллисекунду дали бы одинаковый updatedAt, и условная запись
// второго писателя прошла бы поверх первого. Метка всегда строго растёт.
function nextUpdatedAt(previous: string | undefined): string {
  const now = Date.now();
  const prev = previous ? Date.parse(previous) : NaN;
  return new Date(Number.isFinite(prev) && prev >= now ? prev + 1 : now).toISOString();
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
