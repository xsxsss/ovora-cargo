-- MIGR-1, этап 3, шаг 3: перенос чатов CARGO, сообщений и непрочитанного из KV в таблицы.
--
-- Преобразование то же, что в chatRows.tsx. Идемпотентно (on conflict do nothing), со сверкой: чат с двумя
-- и более участниками или сообщение такого чата, не попавшие в таблицы, — ошибка и откат всего переноса.
-- Чаты с одним участником (схема такие запрещает) и сообщения без чата пропускаются и выводятся в notice.
-- KV не меняется. Порядок выпуска: этот скрипт → выкладка функции → этот скрипт ещё раз.

create or replace function pg_temp.migr3_ts(v text) returns timestamptz
language plpgsql stable as $$
begin
  if v is null or v = '' then return null; end if;
  return v::timestamptz;
exception when others then
  return null;
end $$;

create or replace function pg_temp.migr3_text_array(v jsonb) returns text[]
language sql immutable as $$
  select coalesce(array(select distinct x from jsonb_array_elements_text(
    case when jsonb_typeof(v) = 'array' then v else '[]'::jsonb end) x where x <> ''), '{}')
$$;

do $$
declare
  kv_chats int; missing_chats int; skipped_chats int;
  kv_msgs int; missing_msgs int; skipped_msgs int;
begin
  -- ── Чаты ─────────────────────────────────────────────────────────────────
  insert into public.chats (id, participants, trip_ids, last_message, last_message_at, last_sender_id,
    has_proposal, proposal_status, created_at, updated_at, data)
  select
    chat_id,
    pg_temp.migr3_text_array(v->'participants'),
    case when jsonb_typeof(v->'tripIds') = 'array' then pg_temp.migr3_text_array(v->'tripIds')
         when coalesce(v->>'tripId', '') <> '' then array[v->>'tripId'] else '{}' end,
    v->>'lastMessage',
    pg_temp.migr3_ts(v->>'lastMessageAt'),
    v->>'lastSenderId',
    coalesce(v->>'hasProposal', '') = 'true',
    v->>'proposalStatus',
    coalesce(pg_temp.migr3_ts(v->>'createdAt'), now()),
    now(),
    v - array['chatId', 'participants', 'tripIds', 'lastMessage', 'lastMessageAt', 'lastSenderId',
              'hasProposal', 'proposalStatus', 'createdAt', 'updatedAt', 'unreadByEmail', 'unread']
  from (
    select value as v, coalesce(nullif(value->>'chatId', ''), substr(key, length('ovora:chatmeta:') + 1)) as chat_id
    from public.kv_store_4e36197a
    where key like 'ovora:chatmeta:%' and jsonb_typeof(value) = 'object'
  ) s
  where cardinality(pg_temp.migr3_text_array(v->'participants')) >= 2
  on conflict do nothing;

  -- ── Непрочитанное ────────────────────────────────────────────────────────
  insert into public.chat_unread (chat_id, email, count)
  select s.chat_id, u.key, greatest(0, case when u.value ~ '^\d+$' then u.value::int else 0 end)
  from (
    select value as v, coalesce(nullif(value->>'chatId', ''), substr(key, length('ovora:chatmeta:') + 1)) as chat_id
    from public.kv_store_4e36197a
    where key like 'ovora:chatmeta:%' and jsonb_typeof(value) = 'object' and jsonb_typeof(value->'unreadByEmail') = 'object'
  ) s
  cross join lateral jsonb_each_text(s.v->'unreadByEmail') u
  where exists (select 1 from public.chats c where c.id = s.chat_id)
  on conflict do nothing;

  -- ── Сообщения ────────────────────────────────────────────────────────────
  -- Ключ ovora:chat:{chatId}:{msgId}; id чата берём из ключа (у старых записей поля chatId может не быть).
  insert into public.messages (chat_id, id, sender_id, type, text, proposal, ts, created_at, data)
  select
    chat_id,
    msg_id,
    coalesce(v->>'senderId', ''),
    case when v->>'type' in ('text', 'proposal', 'system') then v->>'type' else 'text' end,
    v->>'text',
    case when jsonb_typeof(v->'proposal') = 'object' then v->'proposal' end,
    coalesce(case when jsonb_typeof(v->'ts') = 'number' then (v->>'ts')::numeric::bigint end,
             (extract(epoch from coalesce(pg_temp.migr3_ts(v->>'createdAt'), now())) * 1000)::bigint),
    coalesce(pg_temp.migr3_ts(v->>'createdAt'),
             case when jsonb_typeof(v->'ts') = 'number' then to_timestamp((v->>'ts')::numeric / 1000) end, now()),
    v - array['chatId', 'msgId', 'senderId', 'type', 'text', 'proposal', 'ts', 'createdAt']
  from (
    select value as v, split_part(key, ':', 3) as chat_id,
           coalesce(nullif(value->>'msgId', ''), substr(key, length('ovora:chat:' || split_part(key, ':', 3) || ':') + 1)) as msg_id
    from public.kv_store_4e36197a
    where key like 'ovora:chat:%' and jsonb_typeof(value) = 'object'
  ) s
  where exists (select 1 from public.chats c where c.id = s.chat_id)
  on conflict do nothing;

  -- ── Сверка ───────────────────────────────────────────────────────────────
  select count(*),
         count(*) filter (where not exists (select 1 from public.chats c
           where c.id = coalesce(nullif(kv.value->>'chatId', ''), substr(kv.key, length('ovora:chatmeta:') + 1)))),
         count(*) filter (where cardinality(pg_temp.migr3_text_array(kv.value->'participants')) < 2)
    into kv_chats, missing_chats, skipped_chats
    from public.kv_store_4e36197a kv where key like 'ovora:chatmeta:%' and jsonb_typeof(value) = 'object';

  select count(*),
         count(*) filter (where not exists (select 1 from public.messages m
           where m.chat_id = split_part(kv.key, ':', 3)
             and m.id = coalesce(nullif(kv.value->>'msgId', ''), substr(kv.key, length('ovora:chat:' || split_part(kv.key, ':', 3) || ':') + 1)))),
         count(*) filter (where not exists (select 1 from public.chats c where c.id = split_part(kv.key, ':', 3)))
    into kv_msgs, missing_msgs, skipped_msgs
    from public.kv_store_4e36197a kv where key like 'ovora:chat:%' and jsonb_typeof(value) = 'object';

  raise notice 'MIGR-1 stage 3 copy: chats kv=% missing=% (skipped, <2 participants: %) | messages kv=% missing=% (skipped, no chat: %)',
    kv_chats, missing_chats, skipped_chats, kv_msgs, missing_msgs, skipped_msgs;

  if missing_chats > skipped_chats or missing_msgs > skipped_msgs then
    raise exception 'MIGR-1 stage 3 copy: records not transferred (see notice above), rolled back';
  end if;
end $$;
