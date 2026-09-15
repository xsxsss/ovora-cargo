-- MIGR-1, этап 4, шаг 0: схема отзывов и уведомлений CARGO. Код не меняется, данных не переносит.
--
-- На бою от июльской попытки осталась пустая заготовка reviews (reviewer_email, review_text, без ограничений) —
-- пересоздаётся; если в ней есть строки — отказ. Таблицы уведомлений не было.

do $$
declare
  has_rows boolean;
begin
  if to_regclass('public.reviews') is not null then
    execute 'select exists (select 1 from public.reviews)' into has_rows;
    if has_rows then
      raise exception 'MIGR-1 stage 4: reviews contains data, refusing to recreate';
    end if;
  end if;
end $$;

drop table if exists public.reviews;

-- ── Отзывы ─────────────────────────────────────────────────────────────────
-- Один отзыв автора о человеке за поездку — уникальным ключом: два одновременных запроса не создадут дубль
-- (раньше проверка «уже оставлял» читала индекс и могла пропустить параллельный запрос).
-- Отзыв остаётся после удаления поездки и пользователя: это история второй стороны, поэтому без связей.
create table public.reviews (
  id           text primary key check (id <> ''),
  author_email text not null check (author_email = lower(btrim(author_email)) and author_email <> ''),
  target_email text not null check (target_email = lower(btrim(target_email)) and target_email <> ''),
  trip_id      text not null,
  rating       integer not null check (rating between 1 and 5),
  created_at   timestamptz not null default now(),
  data         jsonb not null default '{}'::jsonb,
  check (author_email <> target_email),
  unique (author_email, target_email, trip_id)
);
create index reviews_target on public.reviews (target_email, created_at desc);
create index reviews_author on public.reviews (author_email, created_at desc);

-- ── Уведомления ────────────────────────────────────────────────────────────
create table public.notifications (
  user_email text not null check (user_email = lower(btrim(user_email)) and user_email <> ''),
  id         text not null,
  type       text not null,
  is_unread  boolean not null default true,
  created_at timestamptz not null default now(),
  data       jsonb not null default '{}'::jsonb,
  primary key (user_email, id)
);
create index notifications_user_created on public.notifications (user_email, created_at desc);

alter table public.reviews enable row level security;
alter table public.notifications enable row level security;
revoke all on public.reviews, public.notifications from anon, authenticated;
