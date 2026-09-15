-- ОТКАТ MIGR-1 этапа 4: reviews и notifications → KV (с индексами отзывов старого кода). Не миграция: вручную,
-- только по решению владельца, ПЕРЕД выкладкой прежней версии функции. Таблицы не трогаются, можно повторять.

begin;

insert into public.kv_store_4e36197a (key, value)
select 'ovora:review:' || r.id,
  r.data || jsonb_build_object('reviewId', r.id, 'authorEmail', r.author_email, 'targetEmail', r.target_email,
    'tripId', r.trip_id, 'rating', r.rating,
    'createdAt', to_char(r.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
from public.reviews r
on conflict (key) do update set value = excluded.value;

insert into public.kv_store_4e36197a (key, value)
select k.key, k.value from (
  select 'ovora:userreviews:target:' || r.target_email || ':' || r.id as key, jsonb_build_object('reviewId', r.id) as value from public.reviews r
  union all
  select 'ovora:userreviews:author:' || r.author_email || ':' || r.id, jsonb_build_object('reviewId', r.id) from public.reviews r
) k
on conflict (key) do update set value = excluded.value;

insert into public.kv_store_4e36197a (key, value)
select 'ovora:notification:' || n.user_email || ':' || n.id,
  n.data || jsonb_build_object('id', n.id, 'userEmail', n.user_email, 'type', n.type, 'isUnread', n.is_unread,
    'createdAt', to_char(n.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
from public.notifications n
on conflict (key) do update set value = excluded.value;

commit;
