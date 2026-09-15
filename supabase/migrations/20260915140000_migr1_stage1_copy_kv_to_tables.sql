-- MIGR-1, этап 1, шаг 4: перенос поездок, заявок, грузов и откликов из KV в таблицы.
--
-- Преобразование то же, что в bookingRows.tsx (tripToRow, offerToRow, cargoToRow, cargoOfferToRow).
-- Идемпотентно: существующие строки не трогаются (on conflict do nothing), запускать можно сколько
-- угодно раз. KV не меняется — откат: supabase/rollback/migr1_stage1_tables_to_kv.sql.
--
-- Порядок выпуска: этот скрипт → выкладка новой функции → этот скрипт ещё раз (подхватит то, что
-- старая функция успела записать в KV за время выкладки).

create or replace function pg_temp.migr1_num(v jsonb) returns numeric
language plpgsql immutable as $$
begin
  if v is null or jsonb_typeof(v) = 'null' then return 0; end if;
  if jsonb_typeof(v) = 'number' then return (v #>> '{}')::numeric; end if;
  if jsonb_typeof(v) = 'string' and btrim(v #>> '{}') ~ '^-?[0-9]+(\.[0-9]+)?$' then
    return btrim(v #>> '{}')::numeric;
  end if;
  return 0;
end $$;

-- Пусто → null, иначе число не меньше 0 (необязательные колонки: вес и бюджет груза, цена отклика).
-- greatest(0, null) в Postgres даёт 0, а не null — поэтому ограничение внутри функции.
create or replace function pg_temp.migr1_num_or_null(v jsonb) returns numeric
language plpgsql immutable as $$
begin
  if v is null or jsonb_typeof(v) = 'null' or (jsonb_typeof(v) = 'string' and btrim(v #>> '{}') = '') then
    return null;
  end if;
  return greatest(0, pg_temp.migr1_num(v));
end $$;

create or replace function pg_temp.migr1_ts(v text) returns timestamptz
language plpgsql stable as $$
begin
  if v is null or v = '' then return null; end if;
  return v::timestamptz;
exception when others then
  return null;
end $$;

do $$
declare
  kv_trips int; kv_offers int; kv_cargos int; kv_cargo_offers int;
  missing_trips int; missing_offers int; missing_cargos int; missing_cargo_offers int;
  orphan_offers int; orphan_cargo_offers int;
begin
  -- ── Поездки ──────────────────────────────────────────────────────────────
  insert into public.trips (id, driver_email, status, origin, destination, trip_date, available_seats, child_seats,
    cargo_capacity, price_per_seat, price_per_kg, price_per_child, currency, created_at, updated_at, completed_at,
    deleted_at, data)
  select
    v->>'id',
    lower(btrim(coalesce(v->>'driverEmail', ''))),
    -- Старые статусы: active/scheduled считаются открытыми, deleted — отменой с отметкой удаления.
    case
      when v->>'status' in ('planned', 'active', 'inProgress', 'frozen', 'completed', 'cancelled') then v->>'status'
      when v->>'status' = 'deleted' then 'cancelled'
      else 'planned'
    end,
    coalesce(v->>'from', ''),
    coalesce(v->>'to', ''),
    v->>'date',
    greatest(0, trunc(pg_temp.migr1_num(v->'availableSeats')))::int,
    greatest(0, trunc(pg_temp.migr1_num(v->'childSeats')))::int,
    greatest(0, pg_temp.migr1_num(v->'cargoCapacity')),
    greatest(0, pg_temp.migr1_num(v->'pricePerSeat')),
    greatest(0, pg_temp.migr1_num(v->'pricePerKg')),
    greatest(0, pg_temp.migr1_num(v->'pricePerChild')),
    coalesce(nullif(v->>'currency', ''), 'TJS'),
    coalesce(pg_temp.migr1_ts(v->>'createdAt'), now()),
    coalesce(pg_temp.migr1_ts(v->>'updatedAt'), now()),
    pg_temp.migr1_ts(v->>'completedAt'),
    coalesce(pg_temp.migr1_ts(v->>'deletedAt'), case when v->>'status' = 'deleted' then now() end),
    v - array['id', 'driverEmail', 'status', 'from', 'to', 'date', 'availableSeats', 'childSeats', 'cargoCapacity',
      'pricePerSeat', 'pricePerKg', 'pricePerChild', 'currency', 'createdAt', 'updatedAt', 'completedAt', 'deletedAt']
  from (select value as v from public.kv_store_4e36197a where key like 'ovora:trip:%') s
  where coalesce(v->>'id', '') <> ''
  on conflict do nothing;

  -- ── Заявки на поездку ────────────────────────────────────────────────────
  -- Заявку без поездки перенести нельзя (связь в схеме) — такие только считаются и выводятся.
  -- on conflict без цели: дубль ожидающей заявки (уникальный индекс) тоже пропускается.
  insert into public.offers (id, trip_id, sender_email, driver_email, status, requested_seats, requested_children,
    requested_cargo, price, currency, created_at, updated_at, data)
  select
    v->>'offerId',
    v->>'tripId',
    lower(btrim(coalesce(v->>'senderEmail', ''))),
    lower(btrim(coalesce(v->>'driverEmail', ''))),
    case when v->>'status' in ('pending', 'accepted', 'declined', 'rejected', 'cancelled', 'deleted') then v->>'status'
         else 'cancelled' end,
    greatest(0, trunc(pg_temp.migr1_num(v->'requestedSeats')))::int,
    greatest(0, trunc(pg_temp.migr1_num(v->'requestedChildren')))::int,
    greatest(0, pg_temp.migr1_num(v->'requestedCargo')),
    greatest(0, pg_temp.migr1_num(v->'price')),
    coalesce(nullif(v->>'currency', ''), 'TJS'),
    coalesce(pg_temp.migr1_ts(v->>'createdAt'), now()),
    coalesce(pg_temp.migr1_ts(v->>'updatedAt'), now()),
    v - array['offerId', 'tripId', 'senderEmail', 'driverEmail', 'status', 'requestedSeats', 'requestedChildren',
      'requestedCargo', 'price', 'currency', 'createdAt', 'updatedAt']
  from (select value as v from public.kv_store_4e36197a where key like 'ovora:offer:%') s
  where coalesce(v->>'offerId', '') <> ''
    and exists (select 1 from public.trips t where t.id = s.v->>'tripId')
  on conflict do nothing;

  -- ── Грузы ────────────────────────────────────────────────────────────────
  insert into public.cargos (id, sender_email, status, origin, destination, cargo_weight, budget, currency,
    created_at, updated_at, deleted_at, data)
  select
    v->>'id',
    lower(btrim(coalesce(v->>'senderEmail', ''))),
    case
      when v->>'status' in ('active', 'matched', 'completed', 'cancelled') then v->>'status'
      when v->>'status' = 'deleted' then 'cancelled'
      else 'active'
    end,
    coalesce(v->>'from', ''),
    coalesce(v->>'to', ''),
    pg_temp.migr1_num_or_null(v->'cargoWeight'),
    pg_temp.migr1_num_or_null(v->'budget'),
    coalesce(nullif(v->>'currency', ''), 'TJS'),
    coalesce(pg_temp.migr1_ts(v->>'createdAt'), now()),
    coalesce(pg_temp.migr1_ts(v->>'updatedAt'), now()),
    coalesce(pg_temp.migr1_ts(v->>'deletedAt'), case when v->>'status' = 'deleted' then now() end),
    v - array['id', 'senderEmail', 'status', 'from', 'to', 'cargoWeight', 'budget', 'currency', 'createdAt',
      'updatedAt', 'deletedAt']
  from (select value as v from public.kv_store_4e36197a where key like 'ovora:cargo:%') s
  where coalesce(v->>'id', '') <> ''
  on conflict do nothing;

  -- ── Отклики на груз ──────────────────────────────────────────────────────
  insert into public.cargo_offers (id, cargo_id, driver_email, sender_email, status, price, created_at, updated_at, data)
  select
    v->>'offerId',
    v->>'cargoId',
    lower(btrim(coalesce(v->>'driverEmail', ''))),
    lower(btrim(coalesce(v->>'senderEmail', ''))),
    case when v->>'status' in ('pending', 'accepted', 'rejected', 'declined', 'cancelled', 'deleted') then v->>'status'
         else 'cancelled' end,
    pg_temp.migr1_num_or_null(v->'price'),
    coalesce(pg_temp.migr1_ts(v->>'createdAt'), now()),
    coalesce(pg_temp.migr1_ts(v->>'updatedAt'), now()),
    v - array['offerId', 'cargoId', 'driverEmail', 'senderEmail', 'status', 'price', 'createdAt', 'updatedAt']
  from (select value as v from public.kv_store_4e36197a where key like 'ovora:cargo-offer:%') s
  where coalesce(v->>'offerId', '') <> ''
    and exists (select 1 from public.cargos cg where cg.id = s.v->>'cargoId')
  on conflict do nothing;

  -- ── Сверка: каждая запись KV должна быть в таблице ───────────────────────
  select count(*), count(*) filter (where not exists (select 1 from public.trips t where t.id = kv.value->>'id'))
    into kv_trips, missing_trips
    from public.kv_store_4e36197a kv where key like 'ovora:trip:%';
  select count(*),
         count(*) filter (where not exists (select 1 from public.offers o where o.id = kv.value->>'offerId')),
         count(*) filter (where not exists (select 1 from public.trips t where t.id = kv.value->>'tripId'))
    into kv_offers, missing_offers, orphan_offers
    from public.kv_store_4e36197a kv where key like 'ovora:offer:%';
  select count(*), count(*) filter (where not exists (select 1 from public.cargos c where c.id = kv.value->>'id'))
    into kv_cargos, missing_cargos
    from public.kv_store_4e36197a kv where key like 'ovora:cargo:%';
  select count(*),
         count(*) filter (where not exists (select 1 from public.cargo_offers o where o.id = kv.value->>'offerId')),
         count(*) filter (where not exists (select 1 from public.cargos c where c.id = kv.value->>'cargoId'))
    into kv_cargo_offers, missing_cargo_offers, orphan_cargo_offers
    from public.kv_store_4e36197a kv where key like 'ovora:cargo-offer:%';

  raise notice 'MIGR-1 copy: trips kv=% missing=% | offers kv=% missing=% (orphans %) | cargos kv=% missing=% | cargo_offers kv=% missing=% (orphans %)',
    kv_trips, missing_trips, kv_offers, missing_offers, orphan_offers,
    kv_cargos, missing_cargos, kv_cargo_offers, missing_cargo_offers, orphan_cargo_offers;

  -- Сироты (заявка на удалённую из KV поездку) — ожидаемо, их некуда привязать.
  -- Всё остальное пропущенное — ошибка: откатываем весь перенос.
  if missing_trips > 0 or missing_cargos > 0
     or missing_offers > orphan_offers or missing_cargo_offers > orphan_cargo_offers then
    raise exception 'MIGR-1 copy: records not transferred (see notice above), rolled back';
  end if;
end $$;
