-- MIGR-1, этап 3, шаг 0: схема чатов CARGO. Код не меняется, данных не переносит.
--
-- На бою от июльской попытки остались пустые заготовки chats и messages (participants массивом, без
-- счётчика непрочитанных и без ограничений). Пересоздаются; если в них вдруг есть строки — отказ.

do $$
declare
  t text;
  has_rows boolean;
begin
  foreach t in array array['public.messages', 'public.chats'] loop
    if to_regclass(t) is not null then
      execute format('select exists (select 1 from %s)', t) into has_rows;
      if has_rows then
        raise exception 'MIGR-1 stage 3: % contains data, refusing to recreate', t;
      end if;
    end if;
  end loop;
end $$;

drop table if exists public.messages;
drop table if exists public.chats;

-- ── Чаты ───────────────────────────────────────────────────────────────────
-- Один чат на пару водитель↔отправитель (pair_…), в нём могут обсуждаться несколько поездок (trip_ids).
-- Карточки собеседников (contactInfo, senderInfo), маршрут и данные поездки — в data.
create table public.chats (
  id              text primary key check (id <> ''),
  participants    text[] not null check (cardinality(participants) >= 2),
  trip_ids        text[] not null default '{}',
  last_message    text,
  last_message_at timestamptz,
  last_sender_id  text,
  has_proposal    boolean not null default false,
  proposal_status text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  data            jsonb not null default '{}'::jsonb
);
-- Список чатов пользователя: participants @> array[email] — без перебора всех чатов.
create index chats_participants on public.chats using gin (participants);
create index chats_trip_ids on public.chats using gin (trip_ids);

-- Непрочитанное — отдельной строкой на участника: прибавление атомарно, два одновременных сообщения
-- не затирают друг друга (раньше счётчики лежали в карточке чата и переписывались целиком).
create table public.chat_unread (
  chat_id text not null references public.chats (id) on delete cascade,
  email   text not null,
  count   integer not null default 0 check (count >= 0),
  primary key (chat_id, email)
);

-- ── Сообщения ──────────────────────────────────────────────────────────────
create table public.messages (
  chat_id    text not null references public.chats (id) on delete cascade,
  id         text not null,
  sender_id  text not null,
  type       text not null default 'text' check (type in ('text', 'proposal', 'system')),
  text       text,
  proposal   jsonb,
  ts         bigint not null,
  created_at timestamptz not null default now(),
  data       jsonb not null default '{}'::jsonb,
  primary key (chat_id, id)
);
create index messages_chat_ts on public.messages (chat_id, ts);
create index messages_proposal_id on public.messages ((proposal->>'id')) where proposal is not null;

-- ── Новое сообщение: запись, карточка чата и непрочитанное у остальных — одной транзакцией ──
create or replace function public.ovora_chat_add_message(
  p_chat_id text, p_id text, p_sender_id text, p_type text, p_text text, p_proposal jsonb,
  p_ts bigint, p_created_at timestamptz, p_data jsonb, p_preview text)
returns boolean language plpgsql set search_path = public as $$
begin
  perform 1 from chats where id = p_chat_id for update;
  if not found then return false; end if;

  insert into messages (chat_id, id, sender_id, type, text, proposal, ts, created_at, data)
  values (p_chat_id, p_id, p_sender_id, p_type, p_text, p_proposal, p_ts, p_created_at, coalesce(p_data, '{}'::jsonb));

  update chats set
    last_message    = p_preview,
    last_message_at = p_created_at,
    last_sender_id  = p_sender_id,
    has_proposal    = has_proposal or p_type = 'proposal',
    proposal_status = case when p_type = 'proposal' then 'pending' else proposal_status end,
    updated_at      = now()
  where id = p_chat_id;

  insert into chat_unread (chat_id, email, count)
  select p_chat_id, e, 1 from chats c, unnest(c.participants) e where c.id = p_chat_id and e <> p_sender_id
  on conflict (chat_id, email) do update set count = chat_unread.count + 1;
  return true;
end $$;

alter table public.chats enable row level security;
alter table public.chat_unread enable row level security;
alter table public.messages enable row level security;
revoke all on public.chats, public.chat_unread, public.messages from anon, authenticated;
revoke execute on function public.ovora_chat_add_message(text, text, text, text, text, jsonb, bigint, timestamptz, jsonb, text)
  from public, anon, authenticated;
