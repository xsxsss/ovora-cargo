-- MIGR-1, этап 4, шаг 3: перенос отзывов и уведомлений CARGO из KV в таблицы.
--
-- Преобразование то же, что в feedRows.tsx. Идемпотентно (on conflict do nothing), со сверкой.
-- Отзывы, которые схема не принимает (оценка вне 1..5, отзыв самому себе, без автора/адресата/поездки, второй
-- отзыв за ту же поездку), пропускаются и выводятся в notice; всё остальное не перенесённое — откат переноса.
-- KV не меняется. Порядок выпуска: этот скрипт → выкладка функции → этот скрипт ещё раз.

create or replace function pg_temp.migr4_ts(v text) returns timestamptz
language plpgsql stable as $$
begin
  if v is null or v = '' then return null; end if;
  return v::timestamptz;
exception when others then
  return null;
end $$;

do $$
declare
  kv_reviews int; missing_reviews int; invalid_reviews int;
  kv_notifs int; missing_notifs int;
begin
  -- ── Отзывы ───────────────────────────────────────────────────────────────
  insert into public.reviews (id, author_email, target_email, trip_id, rating, created_at, data)
  select
    review_id,
    lower(btrim(v->>'authorEmail')),
    lower(btrim(v->>'targetEmail')),
    v->>'tripId',
    (v->>'rating')::int,
    coalesce(pg_temp.migr4_ts(v->>'createdAt'), now()),
    v - array['reviewId', 'authorEmail', 'targetEmail', 'tripId', 'rating', 'createdAt']
  from (
    select value as v, coalesce(nullif(value->>'reviewId', ''), substr(key, length('ovora:review:') + 1)) as review_id
    from public.kv_store_4e36197a
    where key like 'ovora:review:%' and jsonb_typeof(value) = 'object'
  ) s
  where coalesce(v->>'rating', '') ~ '^[1-5]$'
    and coalesce(btrim(v->>'authorEmail'), '') <> '' and coalesce(btrim(v->>'targetEmail'), '') <> ''
    and lower(btrim(v->>'authorEmail')) <> lower(btrim(v->>'targetEmail'))
    and coalesce(v->>'tripId', '') <> ''
  order by coalesce(pg_temp.migr4_ts(v->>'createdAt'), now())  -- при дубле за поездку остаётся первый отзыв
  on conflict do nothing;

  -- ── Уведомления ──────────────────────────────────────────────────────────
  -- Владелец — из ключа ovora:notification:{email}:{id}.
  insert into public.notifications (user_email, id, type, is_unread, created_at, data)
  select
    lower(btrim(split_part(key, ':', 3))),
    coalesce(nullif(value->>'id', ''), split_part(key, ':', 4)),
    coalesce(nullif(value->>'type', ''), 'info'),
    coalesce(value->>'isUnread', 'true') <> 'false',
    coalesce(pg_temp.migr4_ts(value->>'createdAt'), now()),
    value - array['id', 'userEmail', 'type', 'isUnread', 'createdAt']
  from public.kv_store_4e36197a
  where key like 'ovora:notification:%' and jsonb_typeof(value) = 'object'
    and btrim(split_part(key, ':', 3)) <> ''
  on conflict do nothing;

  -- ── Сверка ───────────────────────────────────────────────────────────────
  select count(*),
         count(*) filter (where not exists (select 1 from public.reviews r
           where r.id = coalesce(nullif(kv.value->>'reviewId', ''), substr(kv.key, length('ovora:review:') + 1)))),
         count(*) filter (where not (coalesce(kv.value->>'rating', '') ~ '^[1-5]$'
           and coalesce(btrim(kv.value->>'authorEmail'), '') <> '' and coalesce(btrim(kv.value->>'targetEmail'), '') <> ''
           and lower(btrim(kv.value->>'authorEmail')) <> lower(btrim(kv.value->>'targetEmail'))
           and coalesce(kv.value->>'tripId', '') <> '')
           or exists (select 1 from public.reviews r
             where r.author_email = lower(btrim(kv.value->>'authorEmail')) and r.target_email = lower(btrim(kv.value->>'targetEmail'))
               and r.trip_id = kv.value->>'tripId'
               and r.id <> coalesce(nullif(kv.value->>'reviewId', ''), substr(kv.key, length('ovora:review:') + 1))))
    into kv_reviews, missing_reviews, invalid_reviews
    from public.kv_store_4e36197a kv where key like 'ovora:review:%' and jsonb_typeof(value) = 'object';

  select count(*),
         count(*) filter (where not exists (select 1 from public.notifications n
           where n.user_email = lower(btrim(split_part(kv.key, ':', 3)))
             and n.id = coalesce(nullif(kv.value->>'id', ''), split_part(kv.key, ':', 4))))
    into kv_notifs, missing_notifs
    from public.kv_store_4e36197a kv where key like 'ovora:notification:%' and jsonb_typeof(value) = 'object';

  raise notice 'MIGR-1 stage 4 copy: reviews kv=% missing=% (skipped as invalid or duplicate: %) | notifications kv=% missing=%',
    kv_reviews, missing_reviews, invalid_reviews, kv_notifs, missing_notifs;

  if missing_reviews > invalid_reviews or missing_notifs > 0 then
    raise exception 'MIGR-1 stage 4 copy: records not transferred (see notice above), rolled back';
  end if;
end $$;
