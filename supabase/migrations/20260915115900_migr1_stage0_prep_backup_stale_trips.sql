-- Заготовленная таблица trips содержала устаревшую копию поездки от брошенной попытки переезда
-- (июль 2026, мест 3 вместо актуальных 2 в KV). Источник правды — KV. Копия сохранена в backup
-- и удаляется, только если такая поездка есть в KV. Применено на бою 2026-09-15; на staging
-- таблицы trips не было — миграция там не нужна.
create table if not exists backup.trips_pre_migr1_20260915 as select * from public.trips;
revoke all on backup.trips_pre_migr1_20260915 from public, anon, authenticated;

do $$
declare orphan int;
begin
  select count(*) into orphan from public.trips t
  where not exists (select 1 from public.kv_store_4e36197a k where k.key = 'ovora:trip:' || t.id);
  if orphan > 0 then
    raise exception 'MIGR-1 prep: % trips rows have no KV counterpart, not deleting', orphan;
  end if;
end $$;

delete from public.trips t
where exists (select 1 from public.kv_store_4e36197a k where k.key = 'ovora:trip:' || t.id);
