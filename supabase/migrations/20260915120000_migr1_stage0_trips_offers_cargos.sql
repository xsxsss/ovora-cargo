-- MIGR-1, этап 0: схема поездок, заявок, грузов и откликов. Код пока работает с KV — таблицы пустые.
-- Заготовленные раньше trips/offers/cargos пересоздаются: у них CASCADE стирал историю броней,
-- не было полей учёта мест и ограничений. Защита: если в них уже есть данные — миграция падает.

do $$
declare
  t text;
  has_rows boolean;
begin
  foreach t in array array['public.trips', 'public.offers', 'public.cargos'] loop
    if to_regclass(t) is not null then
      execute format('select exists (select 1 from %s)', t) into has_rows;
      if has_rows then
        raise exception 'MIGR-1 stage 0: % already contains data, refusing to recreate', t;
      end if;
    end if;
  end loop;
end $$;

drop table if exists public.offers;
drop table if exists public.trips;
drop table if exists public.cargos;

-- ── Поездки ─────────────────────────────────────────────────────────────────
create table public.trips (
  id              text primary key,
  driver_email    text not null,
  status          text not null default 'planned'
                  check (status in ('planned', 'active', 'inProgress', 'frozen', 'completed', 'cancelled')),
  origin          text not null default '',
  destination     text not null default '',
  trip_date       text,
  available_seats integer not null default 0 check (available_seats >= 0),
  child_seats     integer not null default 0 check (child_seats >= 0),
  cargo_capacity  numeric not null default 0 check (cargo_capacity >= 0),
  price_per_seat  numeric not null default 0 check (price_per_seat >= 0),
  price_per_kg    numeric not null default 0 check (price_per_kg >= 0),
  currency        text not null default 'TJS',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  completed_at    timestamptz,
  deleted_at      timestamptz,
  -- Поля карточки, по которым не ищут и не считают: имя и фото водителя, координаты, заметки.
  data            jsonb not null default '{}'::jsonb
);
create index trips_driver_email_idx on public.trips (driver_email);
create index trips_search_idx on public.trips (trip_date)
  where deleted_at is null and status in ('planned', 'active', 'frozen');

-- ── Заявки на поездку ───────────────────────────────────────────────────────
create table public.offers (
  id                 text primary key,
  -- RESTRICT, не CASCADE: поездки удаляются мягко, история броней — доказательство в споре.
  trip_id            text not null references public.trips (id) on delete restrict,
  sender_email       text not null,
  driver_email       text not null,
  status             text not null default 'pending'
                     check (status in ('pending', 'accepted', 'declined', 'rejected', 'cancelled', 'deleted')),
  requested_seats    integer not null default 0 check (requested_seats >= 0),
  requested_children integer not null default 0 check (requested_children >= 0),
  requested_cargo    numeric not null default 0 check (requested_cargo >= 0),
  price              numeric not null default 0 check (price >= 0),
  currency           text not null default 'TJS',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  data               jsonb not null default '{}'::jsonb
);
create index offers_trip_id_idx on public.offers (trip_id);
create index offers_sender_email_idx on public.offers (sender_email);
create index offers_driver_email_idx on public.offers (driver_email);
-- Одна ожидающая заявка отправителя на поездку — раньше это проверял код, и два запроса подряд проходили оба.
create unique index offers_one_pending_per_sender on public.offers (trip_id, sender_email) where status = 'pending';

-- ── Грузы ───────────────────────────────────────────────────────────────────
create table public.cargos (
  id           text primary key,
  sender_email text not null,
  status       text not null default 'active' check (status in ('active', 'matched', 'completed', 'cancelled')),
  origin       text not null default '',
  destination  text not null default '',
  cargo_weight numeric check (cargo_weight >= 0),
  budget       numeric check (budget >= 0),
  currency     text not null default 'TJS',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  data         jsonb not null default '{}'::jsonb
);
create index cargos_sender_email_idx on public.cargos (sender_email);
create index cargos_search_idx on public.cargos (created_at) where deleted_at is null and status = 'active';

-- ── Отклики водителей на груз ───────────────────────────────────────────────
create table public.cargo_offers (
  id           text primary key,
  cargo_id     text not null references public.cargos (id) on delete restrict,
  driver_email text not null,
  sender_email text not null,
  status       text not null default 'pending'
               check (status in ('pending', 'accepted', 'rejected', 'declined', 'cancelled', 'deleted')),
  price        numeric check (price >= 0),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  data         jsonb not null default '{}'::jsonb
);
create index cargo_offers_cargo_id_idx on public.cargo_offers (cargo_id);
create index cargo_offers_driver_email_idx on public.cargo_offers (driver_email);
create index cargo_offers_sender_email_idx on public.cargo_offers (sender_email);
-- Один принятый отклик на груз и одна ожидающая заявка водителя — гарантирует база, а не код.
create unique index cargo_offers_one_accepted on public.cargo_offers (cargo_id) where status = 'accepted';
create unique index cargo_offers_one_pending_per_driver on public.cargo_offers (cargo_id, driver_email) where status = 'pending';

-- ── Доступ: только сервер (service_role). Сайт ходит через edge-функцию ──────
alter table public.trips enable row level security;
alter table public.offers enable row level security;
alter table public.cargos enable row level security;
alter table public.cargo_offers enable row level security;
revoke all on public.trips, public.offers, public.cargos, public.cargo_offers from anon, authenticated;
