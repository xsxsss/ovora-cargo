-- ОТКАТ MIGR-1 этапа 3: chats, chat_unread, messages → KV. Не миграция: запускается вручную, только по решению
-- владельца, ПЕРЕД выкладкой прежней версии функции (коммит до перевода чатов на таблицы).
-- Записи KV перезаписываются версией из таблиц. Таблицы не трогаются, скрипт можно запускать повторно.

begin;

insert into public.kv_store_4e36197a (key, value)
select 'ovora:chatmeta:' || c.id,
  c.data || jsonb_build_object(
    'chatId', c.id,
    'participants', to_jsonb(c.participants),
    'tripIds', to_jsonb(c.trip_ids),
    'lastMessage', c.last_message,
    'lastMessageAt', to_char(c.last_message_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'lastSenderId', c.last_sender_id,
    'hasProposal', c.has_proposal,
    'proposalStatus', c.proposal_status,
    'unreadByEmail', coalesce((select jsonb_object_agg(u.email, u.count) from public.chat_unread u where u.chat_id = c.id), '{}'::jsonb),
    'createdAt', to_char(c.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
from public.chats c
on conflict (key) do update set value = excluded.value;

insert into public.kv_store_4e36197a (key, value)
select 'ovora:chat:' || m.chat_id || ':' || m.id,
  m.data || jsonb_build_object(
    'chatId', m.chat_id, 'msgId', m.id, 'senderId', m.sender_id, 'type', m.type,
    'text', m.text, 'proposal', m.proposal, 'ts', m.ts,
    'createdAt', to_char(m.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
from public.messages m
on conflict (key) do update set value = excluded.value;

commit;
