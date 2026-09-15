-- ОТКАТ MIGR-1 этапа 2: users и documents → KV. Не миграция: запускается вручную, только по решению владельца,
-- ПЕРЕД выкладкой прежней версии функции (коммит до перевода пользователей и документов на таблицы).
--
-- Записи KV перезаписываются версией из таблиц: после выпуска таблицы — источник правды.
-- Зашифрованный номер документа в KV не возвращается (старый код хранил его открытым — так делать больше нельзя).
-- Таблицы не трогаются, скрипт можно запускать повторно.

begin;

insert into public.kv_store_4e36197a (key, value)
select 'ovora:user:email:' || u.email,
  jsonb_strip_nulls(u.data || jsonb_build_object(
    'email', u.email, 'role', u.role, 'phone', coalesce(u.phone, ''),
    'status', case when u.status = 'blocked' then 'blocked' end,
    'isVerified', case when u.is_verified then true end,
    'createdAt', to_char(u.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'updatedAt', to_char(u.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
from public.users u
on conflict (key) do update set value = excluded.value;

insert into public.kv_store_4e36197a (key, value)
select 'ovora:document:' || d.user_email || ':' || d.id,
  jsonb_strip_nulls(d.data || jsonb_build_object(
    'id', d.id, 'userEmail', d.user_email, 'type', d.type, 'status', d.status,
    'photoPath', d.photo_path, 'expiryDate', d.expiry_date,
    'createdAt', to_char(d.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'updatedAt', to_char(d.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
from public.documents d
on conflict (key) do update set value = excluded.value;

commit;
