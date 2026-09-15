-- MIGR-1, этап 2, шаг 0: схема пользователей CARGO и их документов. Код не меняется, данных не переносит.
--
-- На бою от июльской попытки переезда остались заготовленные users (2 устаревшие копии) и пустая
-- user_documents (одна строка на человека — а документов у водителя четыре типа). Копии сохраняются
-- в backup.users_pre_migr1_stage2, таблицы пересоздаются. На staging заготовок нет — просто создаются.

do $$
declare
  has_rows boolean;
begin
  if to_regclass('public.user_documents') is not null then
    execute 'select exists (select 1 from public.user_documents)' into has_rows;
    if has_rows then
      raise exception 'MIGR-1 stage 2: user_documents contains data, refusing to recreate';
    end if;
  end if;

  if to_regclass('public.users') is not null then
    execute 'select exists (select 1 from public.users)' into has_rows;
    if has_rows then
      create schema if not exists backup;
      if to_regclass('backup.users_pre_migr1_stage2') is null then
        execute 'create table backup.users_pre_migr1_stage2 as select * from public.users';
      end if;
    end if;
  end if;
end $$;

drop table if exists public.user_documents;
drop table if exists public.users;

-- ── Пользователи CARGO ─────────────────────────────────────────────────────
-- Ключ — почта в нижнем регистре, как ключ KV: ничего не перенумеровывается, заявки и поездки
-- ссылаются на пользователя по почте. Поля карточки (имя, машина, аватар) — в data.
create table public.users (
  email       text primary key check (email = lower(btrim(email)) and email <> ''),
  role        text not null check (role in ('driver', 'sender')),
  status      text not null default 'active' check (status in ('active', 'blocked')),
  phone       text,
  is_verified boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  data        jsonb not null default '{}'::jsonb
);
-- Поиск в админке и сверка с чёрным списком. Не уникальный: сервер не ищет человека по телефону,
-- а запрет повтора заблокировал бы настоящего владельца номера, если его раньше ввёл кто-то другой.
create index users_phone on public.users (phone) where phone is not null and phone <> '';

-- ── Документы ──────────────────────────────────────────────────────────────
-- Персональные данные: при удалении пользователя стираются вместе с ним (cascade), в отличие от
-- броней. Скан — в Storage, здесь только путь. Номер документа — только шифром (AES-GCM, ключ
-- DOCUMENTS_ENC_KEY в секретах функции; база ключа не знает).
create table public.documents (
  user_email          text not null references public.users (email) on delete cascade,
  id                  text not null,
  type                text not null check (type in ('passport', 'driver_license', 'vehicle_registration', 'insurance')),
  status              text not null default 'pending' check (status in ('pending', 'verified', 'approved', 'rejected')),
  photo_path          text,
  expiry_date         text,
  document_number_enc text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  data                jsonb not null default '{}'::jsonb,
  primary key (user_email, id)
);
create index documents_status on public.documents (status, created_at desc);

alter table public.users enable row level security;
alter table public.documents enable row level security;
revoke all on public.users, public.documents from anon, authenticated;
