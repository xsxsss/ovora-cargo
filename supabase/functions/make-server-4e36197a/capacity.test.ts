import { describe, it, expect } from 'vitest';
import {
  adjustTripCapacity, transitionCargoStatus, transitionRecordStatus, patchRecord, isTripClosed,
  canChangeTripOffer, canChangeCargoOffer, parseOfferCounts, expectedOfferPrice,
  type CapacityKV,
} from './capacity.tsx';

// KV в памяти с той же семантикой условной записи, что у kv_store.setIfUnchanged.
// beforeWrite позволяет вклиниться «другому запросу» между чтением и записью.
function memoryKV(initial: Record<string, any> = {}) {
  const store = new Map<string, any>(Object.entries(structuredClone(initial)));
  let beforeWrite: ((key: string) => Promise<void> | void) | null = null;
  const kv: CapacityKV & { set(k: string, v: any): Promise<void> } = {
    async get(key) { return structuredClone(store.get(key)); },
    async set(key, value) { store.set(key, structuredClone(value)); },
    async setIfUnchanged(key, expected, value) {
      if (beforeWrite) { const hook = beforeWrite; beforeWrite = null; await hook(key); }
      const current = store.get(key);
      if (!current) return false;
      if ((current.updatedAt ?? null) !== expected) return false;
      store.set(key, structuredClone(value));
      return true;
    },
  };
  return {
    kv,
    read: (key: string) => store.get(key),
    interruptNextWrite: (hook: (key: string) => Promise<void> | void) => { beforeWrite = hook; },
  };
}

const T0 = '2026-09-14T10:00:00.000Z';
const trip = (over: Record<string, any> = {}) => ({
  id: 't1', status: 'planned', availableSeats: 3, childSeats: 2, cargoCapacity: 100, updatedAt: T0, ...over,
});

describe('adjustTripCapacity', () => {
  it('списывает места при принятии и возвращает при отмене', async () => {
    const { kv, read } = memoryKV({ 'ovora:trip:t1': trip() });
    const offer = { requestedSeats: 2, requestedChildren: 1, requestedCargo: 40 };

    expect(await adjustTripCapacity(kv, 't1', offer, -1)).toBe('ok');
    expect(read('ovora:trip:t1')).toMatchObject({ availableSeats: 1, childSeats: 1, cargoCapacity: 60 });

    expect(await adjustTripCapacity(kv, 't1', offer, 1)).toBe('ok');
    expect(read('ovora:trip:t1')).toMatchObject({ availableSeats: 3, childSeats: 2, cargoCapacity: 100 });
  });

  it('не принимает заявку больше свободного места и ничего не пишет', async () => {
    const { kv, read } = memoryKV({ 'ovora:trip:t1': trip({ availableSeats: 1 }) });
    expect(await adjustTripCapacity(kv, 't1', { requestedSeats: 2 }, -1)).toBe('insufficient');
    expect(read('ovora:trip:t1').availableSeats).toBe(1);
    expect(read('ovora:trip:t1').updatedAt).toBe(T0);
  });

  it('не принимает заявку на отменённую, завершённую или удалённую поездку', async () => {
    for (const over of [{ status: 'cancelled' }, { status: 'completed' }, { deletedAt: T0 }]) {
      const { kv } = memoryKV({ 'ovora:trip:t1': trip(over) });
      expect(await adjustTripCapacity(kv, 't1', { requestedSeats: 1 }, -1)).toBe('closed');
    }
  });

  it('возврат мест на закрытую поездку разрешён — иначе учёт разъедется', async () => {
    const { kv, read } = memoryKV({ 'ovora:trip:t1': trip({ status: 'cancelled', availableSeats: 1 }) });
    expect(await adjustTripCapacity(kv, 't1', { requestedSeats: 2 }, 1)).toBe('ok');
    expect(read('ovora:trip:t1').availableSeats).toBe(3);
  });

  it('два одновременных принятия на последнее место: проходит только одно', async () => {
    const { kv, read, interruptNextWrite } = memoryKV({ 'ovora:trip:t1': trip({ availableSeats: 1 }) });
    let second: string | undefined;
    // Второй запрос прочитал ту же поездку и записал раньше первого.
    interruptNextWrite(async () => { second = await adjustTripCapacity(kv, 't1', { requestedSeats: 1 }, -1); });

    const first = await adjustTripCapacity(kv, 't1', { requestedSeats: 1 }, -1);

    expect(second).toBe('ok');
    expect(first).toBe('insufficient');
    expect(read('ovora:trip:t1').availableSeats).toBe(0);
  });

  it('проигравший гонку перечитывает поездку и списывает от свежего значения', async () => {
    const { kv, read, interruptNextWrite } = memoryKV({ 'ovora:trip:t1': trip({ availableSeats: 3 }) });
    interruptNextWrite(async () => { await adjustTripCapacity(kv, 't1', { requestedSeats: 1 }, -1); });

    expect(await adjustTripCapacity(kv, 't1', { requestedSeats: 1 }, -1)).toBe('ok');
    expect(read('ovora:trip:t1').availableSeats).toBe(1);
  });

  it('отмена поездки между чтением и записью не даёт принять заявку', async () => {
    const { kv, read, interruptNextWrite } = memoryKV({ 'ovora:trip:t1': trip() });
    interruptNextWrite(async () => {
      await patchRecord(kv, 'ovora:trip:t1', () => ({ status: 'cancelled' }));
    });

    expect(await adjustTripCapacity(kv, 't1', { requestedSeats: 1 }, -1)).toBe('closed');
    expect(read('ovora:trip:t1')).toMatchObject({ status: 'cancelled', availableSeats: 3 });
  });

  it('не уводит места в минус, если данные уже разъехались', async () => {
    const { kv, read } = memoryKV({ 'ovora:trip:t1': trip({ availableSeats: 0 }) });
    expect(await adjustTripCapacity(kv, 't1', { requestedSeats: 0, requestedCargo: 100 }, -1)).toBe('ok');
    expect(read('ovora:trip:t1').availableSeats).toBe(0);
  });

  it('старая запись без updatedAt тоже обновляется условно', async () => {
    const { kv, read } = memoryKV({ 'ovora:trip:t1': trip({ updatedAt: undefined }) });
    expect(await adjustTripCapacity(kv, 't1', { requestedSeats: 1 }, -1)).toBe('ok');
    expect(read('ovora:trip:t1').availableSeats).toBe(2);
  });

  it('not_found для несуществующей поездки', async () => {
    const { kv } = memoryKV();
    expect(await adjustTripCapacity(kv, 'nope', { requestedSeats: 1 }, -1)).toBe('not_found');
  });

  it('conflict, если запись всё время перебивают', async () => {
    const { kv } = memoryKV({ 'ovora:trip:t1': trip() });
    const always: CapacityKV = { get: kv.get, setIfUnchanged: async () => false };
    expect(await adjustTripCapacity(always, 't1', { requestedSeats: 1 }, -1, 3)).toBe('conflict');
  });
});

describe('transitionCargoStatus', () => {
  const cargo = (over: Record<string, any> = {}) => ({ id: 'c1', status: 'active', updatedAt: T0, ...over });

  it('первый принятый отклик забирает груз, второй получает wrong_status', async () => {
    const { kv, read } = memoryKV({ 'ovora:cargo:c1': cargo() });
    expect(await transitionCargoStatus(kv, 'c1', 'active', 'matched', 3)).toBe('ok');
    expect(await transitionCargoStatus(kv, 'c1', 'active', 'matched', 3)).toBe('wrong_status');
    expect(read('ovora:cargo:c1').status).toBe('matched');
  });

  it('одновременное принятие двух откликов: груз достаётся одному', async () => {
    const { kv, interruptNextWrite } = memoryKV({ 'ovora:cargo:c1': cargo() });
    let second: string | undefined;
    interruptNextWrite(async () => { second = await transitionCargoStatus(kv, 'c1', 'active', 'matched', 3); });

    const first = await transitionCargoStatus(kv, 'c1', 'active', 'matched', 3);

    expect([first, second].sort()).toEqual(['ok', 'wrong_status']);
  });

  it('обратный путь matched → active повторяет попытку со свежей записью', async () => {
    const { kv, read, interruptNextWrite } = memoryKV({ 'ovora:cargo:c1': cargo({ status: 'matched' }) });
    // Кто-то правит заметку груза ровно в момент освобождения.
    interruptNextWrite(async () => { await patchRecord(kv, 'ovora:cargo:c1', () => ({ notes: 'x' })); });

    expect(await transitionCargoStatus(kv, 'c1', 'matched', 'active', 5)).toBe('ok');
    expect(read('ovora:cargo:c1')).toMatchObject({ status: 'active', notes: 'x' });
  });

  it('снятый груз нельзя забрать, даже если статус не успели сменить', async () => {
    const { kv } = memoryKV({ 'ovora:cargo:c1': cargo({ deletedAt: T0 }) });
    expect(await transitionCargoStatus(kv, 'c1', 'active', 'matched', 3)).toBe('wrong_status');
  });
});

describe('patchRecord', () => {
  it('не затирает изменение, сделанное между чтением и записью', async () => {
    const { kv, read, interruptNextWrite } = memoryKV({ 'ovora:trip:t1': trip() });
    interruptNextWrite(async () => { await adjustTripCapacity(kv, 't1', { requestedSeats: 2 }, -1); });

    const { result } = await patchRecord(kv, 'ovora:trip:t1', () => ({ driverName: 'Новое имя' }));

    expect(result).toBe('ok');
    expect(read('ovora:trip:t1')).toMatchObject({ availableSeats: 1, driverName: 'Новое имя' });
  });

  it('skipped, если patch решил, что менять нечего', async () => {
    const { kv, read } = memoryKV({ 'ovora:trip:t1': trip({ status: 'cancelled' }) });
    const { result } = await patchRecord(kv, 'ovora:trip:t1', t => (t.status === 'cancelled' ? null : { status: 'cancelled' }));
    expect(result).toBe('skipped');
    expect(read('ovora:trip:t1').updatedAt).toBe(T0);
  });

  it('updatedAt строго растёт, даже если запись пришла в ту же миллисекунду', async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const { kv, read } = memoryKV({ 'ovora:trip:t1': trip({ updatedAt: future }) });
    await patchRecord(kv, 'ovora:trip:t1', () => ({ notes: 'a' }));
    expect(Date.parse(read('ovora:trip:t1').updatedAt)).toBeGreaterThan(Date.parse(future));
  });
});

describe('transitionRecordStatus', () => {
  const offer = (over: Record<string, any> = {}) => ({ offerId: 'o1', status: 'pending', updatedAt: T0, ...over });

  it('«принять» и «отменить» одного оффера одновременно: проходит только одно', async () => {
    const { kv, read, interruptNextWrite } = memoryKV({ k: offer() });
    let cancel: any;
    interruptNextWrite(async () => { cancel = await transitionRecordStatus(kv, 'k', ['pending'], 'cancelled'); });

    const accept = await transitionRecordStatus(kv, 'k', ['pending'], 'accepted');

    expect(cancel.result).toBe('ok');
    expect(accept.result).toBe('wrong_status');
    expect(accept.previous.status).toBe('cancelled');
    expect(read('k').status).toBe('cancelled');
  });

  it('previous — это запись, из которой сделан переход', async () => {
    const { kv } = memoryKV({ k: offer({ status: 'accepted' }) });
    const r = await transitionRecordStatus(kv, 'k', ['pending', 'accepted'], 'cancelled', { cancelledAt: T0 });
    expect(r.result).toBe('ok');
    expect(r.previous.status).toBe('accepted');
    expect(r.record).toMatchObject({ status: 'cancelled', cancelledAt: T0 });
  });

  it('повторная отмена уже отменённого — wrong_status, запись не трогается', async () => {
    const { kv, read } = memoryKV({ k: offer({ status: 'cancelled' }) });
    expect((await transitionRecordStatus(kv, 'k', ['pending', 'accepted'], 'cancelled')).result).toBe('wrong_status');
    expect(read('k').updatedAt).toBe(T0);
  });

  it('extra не может переписать статус', async () => {
    const { kv, read } = memoryKV({ k: offer() });
    await transitionRecordStatus(kv, 'k', ['pending'], 'cancelled', { status: 'accepted' });
    expect(read('k').status).toBe('cancelled');
  });
});

describe('isTripClosed', () => {
  it('открыты planned, active, inProgress, frozen', () => {
    for (const status of ['planned', 'active', 'inProgress', 'frozen']) {
      expect(isTripClosed({ status })).toBe(false);
    }
  });
  it('закрыты cancelled, completed, deleted и мягко удалённые', () => {
    expect(isTripClosed({ status: 'cancelled' })).toBe(true);
    expect(isTripClosed({ status: 'completed' })).toBe(true);
    expect(isTripClosed({ status: 'planned', deletedAt: T0 })).toBe(true);
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
