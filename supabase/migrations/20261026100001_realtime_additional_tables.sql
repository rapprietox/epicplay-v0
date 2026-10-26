-- Dashboard staleness fix: RealtimeRefresh only ever watched games/at_bats
-- (the original 20260908140006_realtime.sql publication), so an already-
-- open coach dashboard tab never auto-refreshed after a roster rename, a
-- stolen-base correction, or a lineup/substitution change -- not because
-- of any caching bug (the page is fully dynamic server-rendered, see
-- src/lib/supabase/server.ts's cookies() usage), but because Postgres
-- never emitted a change event for these tables in the first place; they
-- were never added to the publication. Wrapped in the same existence
-- checks as the original migration, for the same reason (ALTER
-- PUBLICATION ... ADD TABLE errors if the table is already a member).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'stolen_bases'
  ) then
    alter publication supabase_realtime add table public.stolen_bases;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'players'
  ) then
    alter publication supabase_realtime add table public.players;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'lineup'
  ) then
    alter publication supabase_realtime add table public.lineup;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'substitutions'
  ) then
    alter publication supabase_realtime add table public.substitutions;
  end if;
end $$;
