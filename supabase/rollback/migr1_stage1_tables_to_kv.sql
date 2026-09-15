-- ОТКАТ MIGR-1 этапа 1: таблицы → KV. Не миграция: запускается вручную, только по решению владельца,
-- ПЕРЕД выкладкой прежней версии функции (коммит до MIGR-1 этапа 1).
--
-- Копирует в KV всё, что новая функция успела записать в таблицы, в прежнем формате (как rowToTrip,
-- rowToOffer, rowToCargo, rowToCargoOffer в bookingRows.tsx) вместе с индексами старого кода.
-- Записи KV перезаписываются версией из таблиц: после выпуска таблицы — источник правды.
-- Таблицы не трогаются, скрипт можно запускать повторно.

begin;

-- ── Поездки ────────────────────────────────────────────────────────────────
insert into public.kv_store_4e36197a (key, value)
select 'ovora:trip:' || t.id,
  jsonb_strip_nulls(t.data || jsonb_build_object(
    'id', t.id, 'driverEmail', t.driver_email, 'status', t.status, 'from', t.origin, 'to', t.destination,
    'date', t.trip_date, 'availableSeats', t.available_seats, 'childSeats', t.child_seats,
    'cargoCapacity', t.cargo_capacity, 'pricePerSeat', t.price_per_seat, 'pricePerKg', t.price_per_kg,
    'pricePerChild', t.price_per_child, 'currency', t.currency,
    'createdAt', to_char(t.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'updatedAt', to_char(t.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'completedAt', to_char(t.completed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'deletedAt', to_char(t.deleted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
from public.trips t
on conflict (key) do update set value = excluded.value;

insert into public.kv_store_4e36197a (key, value)
select 'ovora:drivertrips:' || t.driver_email || ':' || t.id, jsonb_build_object('tripId', t.id, 'driverEmail', t.driver_email)
from public.trips t
on conflict (key) do update set value = excluded.value;

-- ── Заявки ─────────────────────────────────────────────────────────────────
insert into public.kv_store_4e36197a (key, value)
select 'ovora:offer:' || o.trip_id || ':' || o.id,
  jsonb_strip_nulls(o.data || jsonb_build_object(
    'offerId', o.id, 'tripId', o.trip_id, 'senderEmail', o.sender_email, 'driverEmail', o.driver_email,
    'status', o.status, 'requestedSeats', o.requested_seats, 'requestedChildren', o.requested_children,
    'requestedCargo', o.requested_cargo, 'price', o.price, 'currency', o.currency,
    'createdAt', to_char(o.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'updatedAt', to_char(o.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
from public.offers o
on conflict (key) do update set value = excluded.value;

-- Старый код держал индексы только для живых заявок.
insert into public.kv_store_4e36197a (key, value)
select k.key, k.value from (
  select 'ovora:driveroffers:' || o.driver_email || ':' || o.id as key, jsonb_build_object('tripId', o.trip_id, 'offerId', o.id) as value
  from public.offers o where o.status in ('pending', 'accepted')
  union all
  select 'ovora:senderoffers:' || o.sender_email || ':' || o.id, jsonb_build_object('tripId', o.trip_id, 'offerId', o.id)
  from public.offers o where o.status in ('pending', 'accepted')
) k
on conflict (key) do update set value = excluded.value;

-- ── Грузы ──────────────────────────────────────────────────────────────────
insert into public.kv_store_4e36197a (key, value)
select 'ovora:cargo:' || c.id,
  jsonb_strip_nulls(c.data || jsonb_build_object(
    'id', c.id, 'senderEmail', c.sender_email, 'status', c.status, 'from', c.origin, 'to', c.destination,
    'cargoWeight', c.cargo_weight, 'budget', c.budget, 'currency', c.currency,
    'createdAt', to_char(c.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'updatedAt', to_char(c.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'deletedAt', to_char(c.deleted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
from public.cargos c
on conflict (key) do update set value = excluded.value;

insert into public.kv_store_4e36197a (key, value)
select 'ovora:sendercargos:' || c.sender_email || ':' || c.id, jsonb_build_object('cargoId', c.id, 'senderEmail', c.sender_email)
from public.cargos c where c.deleted_at is null
on conflict (key) do update set value = excluded.value;

-- ── Отклики на груз ────────────────────────────────────────────────────────
insert into public.kv_store_4e36197a (key, value)
select 'ovora:cargo-offer:' || o.cargo_id || ':' || o.id,
  jsonb_strip_nulls(o.data || jsonb_build_object(
    'offerId', o.id, 'cargoId', o.cargo_id, 'driverEmail', o.driver_email, 'senderEmail', o.sender_email,
    'status', o.status, 'price', o.price,
    'createdAt', to_char(o.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'updatedAt', to_char(o.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
from public.cargo_offers o
on conflict (key) do update set value = excluded.value;

insert into public.kv_store_4e36197a (key, value)
select k.key, k.value from (
  select 'ovora:drivercargooffers:' || o.driver_email || ':' || o.id as key, jsonb_build_object('cargoId', o.cargo_id, 'offerId', o.id) as value
  from public.cargo_offers o where o.status in ('pending', 'accepted')
  union all
  select 'ovora:sendercargooffers:' || o.sender_email || ':' || o.id, jsonb_build_object('cargoId', o.cargo_id, 'offerId', o.id)
  from public.cargo_offers o where o.status in ('pending', 'accepted')
) k
on conflict (key) do update set value = excluded.value;

commit;
