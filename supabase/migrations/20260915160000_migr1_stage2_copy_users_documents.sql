-- MIGR-1, этап 2, шаг 3: перенос пользователей CARGO и их документов из KV в таблицы.
--
-- Преобразование то же, что в profileRows.tsx (userToRow, documentToRow). Идемпотентно (on conflict do nothing),
-- со сверкой: пропущенный пользователь — ошибка и откат всего переноса. KV не меняется.
--
-- Номер документа: в KV он лежал открытым текстом в extractedData.documentNumber. SQL не знает ключа
-- шифрования (он только в секретах функции), поэтому номер при переносе НЕ сохраняется — ни открыто, ни шифром.
-- Админ видит его на скане. На бою документов 0 (проверено 2026-09-15), на staging — тестовые.
--
-- Порядок выпуска: этот скрипт → выкладка функции → этот скрипт ещё раз.

create or replace function pg_temp.migr2_ts(v text) returns timestamptz
language plpgsql stable as $$
begin
  if v is null or v = '' then return null; end if;
  return v::timestamptz;
exception when others then
  return null;
end $$;

do $$
declare
  kv_users int; missing_users int;
  kv_docs int; missing_docs int; skipped_docs int;
begin
  -- ── Пользователи ─────────────────────────────────────────────────────────
  insert into public.users (email, role, status, phone, is_verified, created_at, updated_at, data)
  select
    lower(btrim(v->>'email')),
    case when v->>'role' = 'driver' then 'driver' else 'sender' end,
    case when v->>'status' = 'blocked' then 'blocked' else 'active' end,
    nullif(v->>'phone', ''),
    coalesce(v->>'isVerified', '') = 'true',
    coalesce(pg_temp.migr2_ts(v->>'createdAt'), now()),
    coalesce(pg_temp.migr2_ts(v->>'updatedAt'), now()),
    v - array['email', 'role', 'status', 'phone', 'isVerified', 'createdAt', 'updatedAt',
              'codeHash', 'passportNumber', 'passportData']
  from (select value as v from public.kv_store_4e36197a
        where key like 'ovora:user:email:%' and jsonb_typeof(value) = 'object') s
  where coalesce(btrim(v->>'email'), '') <> ''
  on conflict do nothing;

  -- ── Документы ────────────────────────────────────────────────────────────
  -- Владелец — из ключа (у старых отклонённых записей нет поля userEmail).
  insert into public.documents (user_email, id, type, status, photo_path, expiry_date, document_number_enc,
    created_at, updated_at, data)
  select
    owner_email,
    coalesce(nullif(v->>'id', ''), doc_id),
    v->>'type',
    case when v->>'status' in ('pending', 'verified', 'approved', 'rejected') then v->>'status' else 'pending' end,
    nullif(v->>'photoPath', ''),
    nullif(v->>'expiryDate', ''),
    null,
    coalesce(pg_temp.migr2_ts(v->>'createdAt'), pg_temp.migr2_ts(v->>'uploadDate'), now()),
    coalesce(pg_temp.migr2_ts(v->>'updatedAt'), now()),
    (v - array['id', 'userEmail', 'type', 'status', 'photoPath', 'expiryDate', 'createdAt', 'updatedAt',
               'photoUrl', 'documentNumber', 'extractedData'])
      || case when jsonb_typeof(v->'extractedData') = 'object'
              then jsonb_build_object('extractedData', (v->'extractedData') - 'documentNumber')
              when v ? 'extractedData' then jsonb_build_object('extractedData', v->'extractedData')
              else '{}'::jsonb end
  from (
    select value as v, lower(btrim(split_part(key, ':', 3))) as owner_email, split_part(key, ':', 4) as doc_id
    from public.kv_store_4e36197a
    where key like 'ovora:document:%' and jsonb_typeof(value) = 'object'
  ) s
  where v->>'type' in ('passport', 'driver_license', 'vehicle_registration', 'insurance')
    and exists (select 1 from public.users u where u.email = s.owner_email)
  on conflict do nothing;

  -- ── Сверка ───────────────────────────────────────────────────────────────
  select count(*), count(*) filter (where not exists (
           select 1 from public.users u where u.email = lower(btrim(kv.value->>'email'))))
    into kv_users, missing_users
    from public.kv_store_4e36197a kv
    where key like 'ovora:user:email:%' and jsonb_typeof(value) = 'object' and coalesce(btrim(value->>'email'), '') <> '';

  select count(*),
         count(*) filter (where not exists (
           select 1 from public.documents d
           where d.user_email = lower(btrim(split_part(kv.key, ':', 3)))
             and d.id = coalesce(nullif(kv.value->>'id', ''), split_part(kv.key, ':', 4)))),
         count(*) filter (where kv.value->>'type' not in ('passport', 'driver_license', 'vehicle_registration', 'insurance')
           or kv.value->>'type' is null
           or not exists (select 1 from public.users u where u.email = lower(btrim(split_part(kv.key, ':', 3)))))
    into kv_docs, missing_docs, skipped_docs
    from public.kv_store_4e36197a kv
    where key like 'ovora:document:%' and jsonb_typeof(value) = 'object';

  raise notice 'MIGR-1 stage 2 copy: users kv=% missing=% | documents kv=% missing=% (skipped: unknown type or no owner %)',
    kv_users, missing_users, kv_docs, missing_docs, skipped_docs;

  if missing_users > 0 or missing_docs > skipped_docs then
    raise exception 'MIGR-1 stage 2 copy: records not transferred (see notice above), rolled back';
  end if;
end $$;
