// Хранилище поездок, заявок, грузов и откликов на таблицах Postgres (MIGR-1).
// Возвращает тот же JSON, что раньше лежал в KV (bookingRows.tsx). Учёт мест и замок груза —
// функции в базе (миграция 20260915130000), здесь только их вызов. Проверяется сквозными
// тестами на staging: запросы к PostgREST без базы тестировать нечем.
import {
  tripToRow, rowToTrip, offerToRow, rowToOffer, cargoToRow, rowToCargo, cargoOfferToRow, rowToCargoOffer,
} from "./bookingRows.tsx";

type Json = Record<string, any>;
/** Заявка, отменённая вместе с поездкой или грузом; previous — статус до отмены. */
export type CancelledOffer = { offerId: string; senderEmail?: string; driverEmail?: string; previous: string };
// Минимум от supabase-js, который здесь нужен — чтобы модуль не зависел от версии клиента.
type Db = { from(table: string): any; rpc(fn: string, args: Json): any };

const OPEN_TRIP_STATUSES = ['planned', 'active', 'inProgress', 'frozen'];
const ROWS_LIMIT = 5000;

function check<T>(res: { data: T; error: any }, what: string): T {
  if (res.error) throw new Error(`[bookingStore] ${what}: ${res.error.message}`);
  return res.data;
}

/**
 * Частичное изменение записи: меняются только колонки, которые есть в patch, поля карточки
 * сливаются с data. Места поездки сюда не попадают (их меняют только функции учёта), поэтому
 * одновременное принятие заявки не затирается. Условие на updated_at — чтобы не потерять
 * параллельную правку data; при конфликте перечитываем.
 */
async function patchRow(
  db: Db, table: string, id: string, patch: Json,
  toRow: (full: Json) => Json, fromRow: (row: Json) => Json, protectedColumns: string[] = [],
  expectStatus?: string,
): Promise<Json | null | 'moved'> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = check(await db.from(table).select('*').eq('id', id).maybeSingle(), `read ${table}`) as Json | null;
    if (!current) return null;
    // Статус успел смениться другим запросом — переход, проверенный по старому статусу, уже неверен.
    if (expectStatus !== undefined && current.status !== expectStatus) return 'moved';
    const merged = { ...fromRow(current), ...patch };
    const full = toRow(merged);
    const changes: Json = { updated_at: new Date().toISOString(), data: full.data };
    for (const column of Object.keys(full)) {
      if (column === 'id' || column === 'data' || column === 'created_at' || protectedColumns.includes(column)) continue;
      if (JSON.stringify(full[column]) !== JSON.stringify(current[column])) changes[column] = full[column];
    }
    const res = await db.from(table).update(changes).eq('id', id).eq('updated_at', current.updated_at).select('*');
    const rows = check(res, `update ${table}`) as Json[];
    if (rows.length) return fromRow(rows[0]);
  }
  throw new Error(`[bookingStore] update ${table} ${id}: conflict after retries`);
}

const SEAT_COLUMNS = ['available_seats', 'child_seats', 'cargo_capacity'];

// ── Поездки ─────────────────────────────────────────────────────────────────
export const trips = {
  async get(db: Db, id: string): Promise<Json | null> {
    const row = check(await db.from('trips').select('*').eq('id', id).maybeSingle(), 'get trip');
    return row ? rowToTrip(row) : null;
  },
  async getMany(db: Db, ids: string[]): Promise<Json[]> {
    if (!ids.length) return [];
    return (check(await db.from('trips').select('*').in('id', ids), 'get trips') as Json[]).map(rowToTrip);
  },
  /** Поездки в поиске: не удалены и не закрыты. */
  async listOpen(db: Db): Promise<Json[]> {
    const rows = check(await db.from('trips').select('*').is('deleted_at', null)
      .in('status', OPEN_TRIP_STATUSES).order('created_at', { ascending: false }).limit(ROWS_LIMIT), 'list open trips');
    return (rows as Json[]).map(rowToTrip);
  },
  async listByDriver(db: Db, email: string): Promise<Json[]> {
    const rows = check(await db.from('trips').select('*').eq('driver_email', email.toLowerCase().trim())
      .order('created_at', { ascending: false }).limit(ROWS_LIMIT), 'list driver trips');
    return (rows as Json[]).map(rowToTrip);
  },
  async listAll(db: Db): Promise<Json[]> {
    const rows = check(await db.from('trips').select('*').order('created_at', { ascending: false }).limit(ROWS_LIMIT), 'list trips');
    return (rows as Json[]).map(rowToTrip);
  },
  async insert(db: Db, trip: Json): Promise<Json> {
    const row = check(await db.from('trips').insert(tripToRow(trip)).select('*').single(), 'insert trip');
    return rowToTrip(row);
  },
  /** Изменение полей поездки, кроме мест. expectStatus — статус, по которому проверен переход. */
  patch(db: Db, id: string, patch: Json, expectStatus?: string): Promise<Json | null | 'moved'> {
    return patchRow(db, 'trips', id, patch, tripToRow, rowToTrip, SEAT_COLUMNS, expectStatus);
  },
  /** Отмена поездки и всех её живых заявок одной транзакцией. null — поездки нет. */
  async cancel(db: Db, id: string, softDelete: boolean): Promise<CancelledOffer[] | null> {
    return check(await db.rpc('ovora_cancel_trip', { p_trip_id: id, p_soft_delete: softDelete }), 'cancel trip');
  },
  async hardDelete(db: Db, id: string): Promise<void> {
    check(await db.from('offers').delete().eq('trip_id', id), 'delete trip offers');
    check(await db.from('trips').delete().eq('id', id), 'delete trip');
  },
};

// ── Заявки на поездку ───────────────────────────────────────────────────────
export const offers = {
  async get(db: Db, tripId: string, offerId: string): Promise<Json | null> {
    const row = check(await db.from('offers').select('*').eq('id', offerId).eq('trip_id', tripId).maybeSingle(), 'get offer');
    return row ? rowToOffer(row) : null;
  },
  async listByTrip(db: Db, tripId: string): Promise<Json[]> {
    const rows = check(await db.from('offers').select('*').eq('trip_id', tripId).order('created_at', { ascending: false }), 'list trip offers');
    return (rows as Json[]).map(rowToOffer);
  },
  async listBySender(db: Db, email: string): Promise<Json[]> {
    const rows = check(await db.from('offers').select('*').eq('sender_email', email.toLowerCase().trim())
      .order('created_at', { ascending: false }).limit(ROWS_LIMIT), 'list sender offers');
    return (rows as Json[]).map(rowToOffer);
  },
  async listByDriver(db: Db, email: string): Promise<Json[]> {
    const rows = check(await db.from('offers').select('*').eq('driver_email', email.toLowerCase().trim())
      .order('created_at', { ascending: false }).limit(ROWS_LIMIT), 'list driver offers');
    return (rows as Json[]).map(rowToOffer);
  },
  async listAll(db: Db): Promise<Json[]> {
    const rows = check(await db.from('offers').select('*').order('created_at', { ascending: false }).limit(ROWS_LIMIT), 'list offers');
    return (rows as Json[]).map(rowToOffer);
  },
  /** duplicate — у отправителя уже есть ожидающая заявка на эту поездку (уникальный индекс). */
  async insert(db: Db, offer: Json): Promise<{ offer?: Json; duplicate?: true }> {
    const res = await db.from('offers').insert(offerToRow(offer)).select('*').single();
    if (res.error?.code === '23505') return { duplicate: true };
    return { offer: rowToOffer(check(res, 'insert offer')) };
  },
  /** ok | not_found | wrong_status | trip_not_found | closed | insufficient */
  async accept(db: Db, tripId: string, offerId: string): Promise<string> {
    return check(await db.rpc('ovora_accept_trip_offer', { p_trip_id: tripId, p_offer_id: offerId }), 'accept offer');
  },
  /** Отказ или отмена; места возвращаются, если заявка была принята. */
  async change(db: Db, tripId: string, offerId: string, to: string, allowedFrom: string[], stamp: string | null):
    Promise<{ result: 'ok' | 'not_found' | 'wrong_status'; previous?: string }> {
    return check(await db.rpc('ovora_change_trip_offer', {
      p_trip_id: tripId, p_offer_id: offerId, p_to: to, p_allowed_from: allowedFrom, p_stamp: stamp,
    }), 'change offer');
  },
  /** Поля карточки заявки (имя, фото) — статус и места так не меняются. */
  patchCard(db: Db, tripId: string, offerId: string, patch: Json): Promise<Json | null | 'moved'> {
    const { status: _s, requestedSeats: _a, requestedChildren: _b, requestedCargo: _c, price: _p, ...card } = patch;
    return patchRow(db, 'offers', offerId, { ...card, tripId }, offerToRow, rowToOffer,
      ['status', 'requested_seats', 'requested_children', 'requested_cargo', 'price', 'trip_id', 'sender_email', 'driver_email']);
  },
};

// ── Грузы ───────────────────────────────────────────────────────────────────
export const cargos = {
  async get(db: Db, id: string): Promise<Json | null> {
    const row = check(await db.from('cargos').select('*').eq('id', id).maybeSingle(), 'get cargo');
    return row ? rowToCargo(row) : null;
  },
  async listOpen(db: Db): Promise<Json[]> {
    const rows = check(await db.from('cargos').select('*').is('deleted_at', null).neq('status', 'cancelled')
      .order('created_at', { ascending: false }).limit(ROWS_LIMIT), 'list cargos');
    return (rows as Json[]).map(rowToCargo);
  },
  async listBySender(db: Db, email: string): Promise<Json[]> {
    const rows = check(await db.from('cargos').select('*').eq('sender_email', email.toLowerCase().trim())
      .order('created_at', { ascending: false }).limit(ROWS_LIMIT), 'list sender cargos');
    return (rows as Json[]).map(rowToCargo);
  },
  async listAll(db: Db): Promise<Json[]> {
    const rows = check(await db.from('cargos').select('*').order('created_at', { ascending: false }).limit(ROWS_LIMIT), 'list all cargos');
    return (rows as Json[]).map(rowToCargo);
  },
  async insert(db: Db, cargo: Json): Promise<Json> {
    return rowToCargo(check(await db.from('cargos').insert(cargoToRow(cargo)).select('*').single(), 'insert cargo'));
  },
  /** Поля груза, кроме статуса: его меняет только замок отклика и снятие груза. */
  patch(db: Db, id: string, patch: Json): Promise<Json | null | 'moved'> {
    return patchRow(db, 'cargos', id, patch, cargoToRow, rowToCargo, ['status', 'sender_email', 'deleted_at']);
  },
  async cancel(db: Db, id: string): Promise<CancelledOffer[] | null> {
    return check(await db.rpc('ovora_cancel_cargo', { p_cargo_id: id }), 'cancel cargo');
  },
};

// ── Отклики на груз ─────────────────────────────────────────────────────────
export const cargoOffers = {
  async get(db: Db, cargoId: string, offerId: string): Promise<Json | null> {
    const row = check(await db.from('cargo_offers').select('*').eq('id', offerId).eq('cargo_id', cargoId).maybeSingle(), 'get cargo offer');
    return row ? rowToCargoOffer(row) : null;
  },
  async listByCargo(db: Db, cargoId: string): Promise<Json[]> {
    const rows = check(await db.from('cargo_offers').select('*').eq('cargo_id', cargoId).order('created_at', { ascending: false }), 'list cargo offers');
    return (rows as Json[]).map(rowToCargoOffer);
  },
  async listByDriver(db: Db, email: string): Promise<Json[]> {
    const rows = check(await db.from('cargo_offers').select('*').eq('driver_email', email.toLowerCase().trim())
      .order('created_at', { ascending: false }).limit(ROWS_LIMIT), 'list driver cargo offers');
    return (rows as Json[]).map(rowToCargoOffer);
  },
  async listBySender(db: Db, email: string): Promise<Json[]> {
    const rows = check(await db.from('cargo_offers').select('*').eq('sender_email', email.toLowerCase().trim())
      .order('created_at', { ascending: false }).limit(ROWS_LIMIT), 'list sender cargo offers');
    return (rows as Json[]).map(rowToCargoOffer);
  },
  async insert(db: Db, offer: Json): Promise<{ offer?: Json; duplicate?: true }> {
    const res = await db.from('cargo_offers').insert(cargoOfferToRow(offer)).select('*').single();
    if (res.error?.code === '23505') return { duplicate: true };
    return { offer: rowToCargoOffer(check(res, 'insert cargo offer')) };
  },
  /** ok | not_found | wrong_status | cargo_not_found | cargo_taken */
  async accept(db: Db, cargoId: string, offerId: string): Promise<string> {
    return check(await db.rpc('ovora_accept_cargo_offer', { p_cargo_id: cargoId, p_offer_id: offerId }), 'accept cargo offer');
  },
  async change(db: Db, cargoId: string, offerId: string, to: string, allowedFrom: string[], stamp: string | null):
    Promise<{ result: 'ok' | 'not_found' | 'wrong_status'; previous?: string }> {
    return check(await db.rpc('ovora_change_cargo_offer', {
      p_cargo_id: cargoId, p_offer_id: offerId, p_to: to, p_allowed_from: allowedFrom, p_stamp: stamp,
    }), 'change cargo offer');
  },
};
