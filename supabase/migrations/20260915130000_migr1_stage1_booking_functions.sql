-- MIGR-1, этап 1: учёт мест и замок груза — транзакциями в базе вместо замков и повторов в коде.
-- Порядок блокировок во всех функциях одинаковый: сначала поездка (груз), потом заявка (отклик).
-- Иначе «принять заявку» и «отменить поездку» одновременно могли бы взаимно заблокироваться.
-- Права ролей (кто может принять) проверяет сервер до вызова: функции только считают и пишут.

alter table public.trips add column if not exists price_per_child numeric not null default 0 check (price_per_child >= 0);

-- ── Принять заявку на поездку ───────────────────────────────────────────────
-- ok | not_found | wrong_status | trip_not_found | closed | insufficient
create or replace function public.ovora_accept_trip_offer(p_trip_id text, p_offer_id text)
returns text language plpgsql set search_path = public as $$
declare
  t trips;
  o offers;
begin
  select * into t from trips where id = p_trip_id for update;
  if not found then return 'trip_not_found'; end if;
  select * into o from offers where id = p_offer_id and trip_id = p_trip_id for update;
  if not found then return 'not_found'; end if;
  if o.status <> 'pending' then return 'wrong_status'; end if;
  if t.deleted_at is not null or t.status in ('cancelled', 'completed') then return 'closed'; end if;
  if t.available_seats < o.requested_seats or t.child_seats < o.requested_children
     or t.cargo_capacity < o.requested_cargo then
    return 'insufficient';
  end if;

  update trips set
    available_seats = available_seats - o.requested_seats,
    child_seats     = child_seats - o.requested_children,
    cargo_capacity  = cargo_capacity - o.requested_cargo,
    updated_at      = now()
  where id = p_trip_id;

  update offers set status = 'accepted', updated_at = now(),
    data = data || jsonb_build_object('acceptedAt', to_jsonb(now()))
  where id = p_offer_id;
  return 'ok';
end $$;

-- ── Сменить статус заявки (отказ, отмена) — места возвращаются, если заявка была принята ──
-- {"result": ok | not_found | wrong_status, "previous": <статус до смены>}
create or replace function public.ovora_change_trip_offer(
  p_trip_id text, p_offer_id text, p_to text, p_allowed_from text[], p_stamp text)
returns jsonb language plpgsql set search_path = public as $$
declare
  o offers;
begin
  perform 1 from trips where id = p_trip_id for update;
  select * into o from offers where id = p_offer_id and trip_id = p_trip_id for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if not (o.status = any (p_allowed_from)) then
    return jsonb_build_object('result', 'wrong_status', 'previous', o.status);
  end if;

  if o.status = 'accepted' and p_to in ('cancelled', 'declined', 'rejected', 'deleted') then
    update trips set
      available_seats = available_seats + o.requested_seats,
      child_seats     = child_seats + o.requested_children,
      cargo_capacity  = cargo_capacity + o.requested_cargo,
      updated_at      = now()
    where id = p_trip_id;
  end if;

  update offers set status = p_to, updated_at = now(),
    data = case when p_stamp is null then data else data || jsonb_build_object(p_stamp, to_jsonb(now())) end
  where id = p_offer_id;
  return jsonb_build_object('result', 'ok', 'previous', o.status);
end $$;

-- ── Отменить поездку со всеми живыми заявками ───────────────────────────────
-- Возвращает отменённые заявки (для уведомлений отправителям). p_soft_delete — ещё и скрыть поездку.
create or replace function public.ovora_cancel_trip(p_trip_id text, p_soft_delete boolean)
returns jsonb language plpgsql set search_path = public as $$
declare
  cancelled jsonb;
begin
  update trips set
    status = 'cancelled',
    deleted_at = case when p_soft_delete then coalesce(deleted_at, now()) else deleted_at end,
    updated_at = now()
  where id = p_trip_id;
  if not found then return null; end if;

  -- Места отменённой поездки возвращаем ради неизменного правила «принято = списано».
  update trips t set
    available_seats = t.available_seats + s.seats,
    child_seats     = t.child_seats + s.children,
    cargo_capacity  = t.cargo_capacity + s.cargo
  from (
    select coalesce(sum(requested_seats), 0) seats, coalesce(sum(requested_children), 0) children,
           coalesce(sum(requested_cargo), 0) cargo
    from offers where trip_id = p_trip_id and status = 'accepted'
  ) s
  where t.id = p_trip_id;

  with changed as (
    update offers o set status = 'cancelled', updated_at = now(),
      data = o.data || jsonb_build_object('cancelledAt', to_jsonb(now()))
    from (select id, status as previous from offers where trip_id = p_trip_id and status in ('pending', 'accepted')) prev
    where o.id = prev.id
    returning o.id, o.sender_email, o.driver_email, prev.previous
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'offerId', id, 'senderEmail', sender_email, 'driverEmail', driver_email, 'previous', previous)), '[]'::jsonb)
  into cancelled from changed;
  return cancelled;
end $$;

-- ── Принять отклик на груз: груз уходит в matched, второй отклик принять нельзя ──
-- ok | not_found | wrong_status | cargo_not_found | cargo_taken
create or replace function public.ovora_accept_cargo_offer(p_cargo_id text, p_offer_id text)
returns text language plpgsql set search_path = public as $$
declare
  cg cargos;
  co cargo_offers;
begin
  select * into cg from cargos where id = p_cargo_id for update;
  if not found then return 'cargo_not_found'; end if;
  select * into co from cargo_offers where id = p_offer_id and cargo_id = p_cargo_id for update;
  if not found then return 'not_found'; end if;
  if co.status <> 'pending' then return 'wrong_status'; end if;
  if cg.status <> 'active' or cg.deleted_at is not null then return 'cargo_taken'; end if;

  update cargos set status = 'matched', updated_at = now() where id = p_cargo_id;
  update cargo_offers set status = 'accepted', updated_at = now(),
    data = data || jsonb_build_object('acceptedAt', to_jsonb(now()))
  where id = p_offer_id;
  return 'ok';
end $$;

-- ── Сменить статус отклика — принятый груз возвращается в поиск ─────────────
create or replace function public.ovora_change_cargo_offer(
  p_cargo_id text, p_offer_id text, p_to text, p_allowed_from text[], p_stamp text)
returns jsonb language plpgsql set search_path = public as $$
declare
  co cargo_offers;
begin
  perform 1 from cargos where id = p_cargo_id for update;
  select * into co from cargo_offers where id = p_offer_id and cargo_id = p_cargo_id for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if not (co.status = any (p_allowed_from)) then
    return jsonb_build_object('result', 'wrong_status', 'previous', co.status);
  end if;

  if co.status = 'accepted' and p_to in ('cancelled', 'declined', 'rejected', 'deleted') then
    update cargos set status = 'active', updated_at = now()
    where id = p_cargo_id and status = 'matched' and deleted_at is null;
  end if;

  update cargo_offers set status = p_to, updated_at = now(),
    data = case when p_stamp is null then data else data || jsonb_build_object(p_stamp, to_jsonb(now())) end
  where id = p_offer_id;
  return jsonb_build_object('result', 'ok', 'previous', co.status);
end $$;

-- ── Снять груз со всеми живыми откликами ────────────────────────────────────
create or replace function public.ovora_cancel_cargo(p_cargo_id text)
returns jsonb language plpgsql set search_path = public as $$
declare
  cancelled jsonb;
begin
  update cargos set status = 'cancelled', deleted_at = coalesce(deleted_at, now()), updated_at = now()
  where id = p_cargo_id;
  if not found then return null; end if;

  with changed as (
    update cargo_offers co set status = 'cancelled', updated_at = now(),
      data = co.data || jsonb_build_object('cancelledAt', to_jsonb(now()))
    from (select id, status as previous from cargo_offers where cargo_id = p_cargo_id and status in ('pending', 'accepted')) prev
    where co.id = prev.id
    returning co.id, co.driver_email, co.sender_email, prev.previous
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'offerId', id, 'driverEmail', driver_email, 'senderEmail', sender_email, 'previous', previous)), '[]'::jsonb)
  into cancelled from changed;
  return cancelled;
end $$;

-- Функции вызывает только сервер (service_role). PostgREST иначе открыл бы их любому с anon key.
revoke execute on function
  public.ovora_accept_trip_offer(text, text),
  public.ovora_change_trip_offer(text, text, text, text[], text),
  public.ovora_cancel_trip(text, boolean),
  public.ovora_accept_cargo_offer(text, text),
  public.ovora_change_cargo_offer(text, text, text, text[], text),
  public.ovora_cancel_cargo(text)
from public, anon, authenticated;
