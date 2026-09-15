// Преобразование «строка таблицы ↔ JSON, который сервер отдаёт сайту» для поездок, заявок,
// грузов и откликов. Формат ответов API не меняется: поля, по которым база считает и ищет, лежат
// в колонках, остальные — в data. Чистые функции без базы — покрыты тестами bookingRows.test.ts.

type Json = Record<string, any>;

const num = (v: unknown): number => Number(v) || 0;
const iso = (v: unknown): string | null => (v == null || v === '' ? null : new Date(String(v)).toISOString());

function without(obj: Json, keys: string[]): Json {
  const rest: Json = {};
  for (const [k, v] of Object.entries(obj || {})) if (!keys.includes(k) && v !== undefined) rest[k] = v;
  return rest;
}

/** null-поля не отдаём: в KV их просто не было, сайт проверяет `!trip.deletedAt`. */
function compact(obj: Json): Json {
  const out: Json = {};
  for (const [k, v] of Object.entries(obj)) if (v !== null && v !== undefined) out[k] = v;
  return out;
}

// ── Поездка ─────────────────────────────────────────────────────────────────
const TRIP_COLUMNS = ['id', 'driverEmail', 'status', 'from', 'to', 'date', 'availableSeats', 'childSeats',
  'cargoCapacity', 'pricePerSeat', 'pricePerKg', 'pricePerChild', 'currency', 'createdAt', 'updatedAt',
  'completedAt', 'deletedAt'];

export function tripToRow(trip: Json): Json {
  return {
    id: String(trip.id),
    driver_email: String(trip.driverEmail || '').toLowerCase().trim(),
    status: trip.status || 'planned',
    origin: trip.from || '',
    destination: trip.to || '',
    trip_date: trip.date ?? null,
    available_seats: Math.max(0, Math.trunc(num(trip.availableSeats))),
    child_seats: Math.max(0, Math.trunc(num(trip.childSeats))),
    cargo_capacity: Math.max(0, num(trip.cargoCapacity)),
    price_per_seat: Math.max(0, num(trip.pricePerSeat)),
    price_per_kg: Math.max(0, num(trip.pricePerKg)),
    price_per_child: Math.max(0, num(trip.pricePerChild)),
    currency: trip.currency || 'TJS',
    created_at: iso(trip.createdAt) ?? new Date().toISOString(),
    updated_at: iso(trip.updatedAt) ?? new Date().toISOString(),
    completed_at: iso(trip.completedAt),
    deleted_at: iso(trip.deletedAt),
    data: without(trip, TRIP_COLUMNS),
  };
}

export function rowToTrip(row: Json): Json {
  return compact({
    ...(row.data || {}),
    id: row.id,
    driverEmail: row.driver_email,
    status: row.status,
    from: row.origin,
    to: row.destination,
    date: row.trip_date,
    availableSeats: num(row.available_seats),
    childSeats: num(row.child_seats),
    cargoCapacity: num(row.cargo_capacity),
    pricePerSeat: num(row.price_per_seat),
    pricePerKg: num(row.price_per_kg),
    pricePerChild: num(row.price_per_child),
    currency: row.currency,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    completedAt: iso(row.completed_at),
    deletedAt: iso(row.deleted_at),
  });
}

// ── Заявка на поездку ───────────────────────────────────────────────────────
const OFFER_COLUMNS = ['offerId', 'tripId', 'senderEmail', 'driverEmail', 'status', 'requestedSeats',
  'requestedChildren', 'requestedCargo', 'price', 'currency', 'createdAt', 'updatedAt'];

export function offerToRow(offer: Json): Json {
  return {
    id: String(offer.offerId),
    trip_id: String(offer.tripId),
    sender_email: String(offer.senderEmail || '').toLowerCase().trim(),
    driver_email: String(offer.driverEmail || '').toLowerCase().trim(),
    status: offer.status || 'pending',
    requested_seats: Math.max(0, Math.trunc(num(offer.requestedSeats))),
    requested_children: Math.max(0, Math.trunc(num(offer.requestedChildren))),
    requested_cargo: Math.max(0, num(offer.requestedCargo)),
    price: Math.max(0, num(offer.price)),
    currency: offer.currency || 'TJS',
    created_at: iso(offer.createdAt) ?? new Date().toISOString(),
    updated_at: iso(offer.updatedAt) ?? new Date().toISOString(),
    data: without(offer, OFFER_COLUMNS),
  };
}

export function rowToOffer(row: Json): Json {
  return compact({
    ...(row.data || {}),
    offerId: row.id,
    tripId: row.trip_id,
    senderEmail: row.sender_email,
    driverEmail: row.driver_email,
    status: row.status,
    requestedSeats: num(row.requested_seats),
    requestedChildren: num(row.requested_children),
    requestedCargo: num(row.requested_cargo),
    price: num(row.price),
    currency: row.currency,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });
}

// ── Груз ────────────────────────────────────────────────────────────────────
const CARGO_COLUMNS = ['id', 'senderEmail', 'status', 'from', 'to', 'cargoWeight', 'budget', 'currency',
  'createdAt', 'updatedAt', 'deletedAt'];

export function cargoToRow(cargo: Json): Json {
  const weight = cargo.cargoWeight == null || cargo.cargoWeight === '' ? null : Math.max(0, num(cargo.cargoWeight));
  const budget = cargo.budget == null || cargo.budget === '' ? null : Math.max(0, num(cargo.budget));
  return {
    id: String(cargo.id),
    sender_email: String(cargo.senderEmail || '').toLowerCase().trim(),
    status: cargo.status || 'active',
    origin: cargo.from || '',
    destination: cargo.to || '',
    cargo_weight: weight,
    budget,
    currency: cargo.currency || 'TJS',
    created_at: iso(cargo.createdAt) ?? new Date().toISOString(),
    updated_at: iso(cargo.updatedAt) ?? new Date().toISOString(),
    deleted_at: iso(cargo.deletedAt),
    data: without(cargo, CARGO_COLUMNS),
  };
}

export function rowToCargo(row: Json): Json {
  return compact({
    ...(row.data || {}),
    id: row.id,
    senderEmail: row.sender_email,
    status: row.status,
    from: row.origin,
    to: row.destination,
    cargoWeight: row.cargo_weight == null ? null : num(row.cargo_weight),
    budget: row.budget == null ? null : num(row.budget),
    currency: row.currency,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    deletedAt: iso(row.deleted_at),
  });
}

// ── Отклик на груз ──────────────────────────────────────────────────────────
const CARGO_OFFER_COLUMNS = ['offerId', 'cargoId', 'driverEmail', 'senderEmail', 'status', 'price',
  'createdAt', 'updatedAt'];

export function cargoOfferToRow(offer: Json): Json {
  return {
    id: String(offer.offerId),
    cargo_id: String(offer.cargoId),
    driver_email: String(offer.driverEmail || '').toLowerCase().trim(),
    sender_email: String(offer.senderEmail || '').toLowerCase().trim(),
    status: offer.status || 'pending',
    price: offer.price == null || offer.price === '' ? null : Math.max(0, num(offer.price)),
    created_at: iso(offer.createdAt) ?? new Date().toISOString(),
    updated_at: iso(offer.updatedAt) ?? new Date().toISOString(),
    data: without(offer, CARGO_OFFER_COLUMNS),
  };
}

export function rowToCargoOffer(row: Json): Json {
  return compact({
    ...(row.data || {}),
    offerId: row.id,
    cargoId: row.cargo_id,
    driverEmail: row.driver_email,
    senderEmail: row.sender_email,
    status: row.status,
    price: row.price == null ? null : num(row.price),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });
}
