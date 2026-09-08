-- Enable Realtime so the coach dashboard can subscribe to live updates as
-- the operator logs plays. Wrapped in existence checks so this migration
-- is safe to re-run (ALTER PUBLICATION ... ADD TABLE errors if the table
-- is already a member).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'games'
  ) then
    alter publication supabase_realtime add table public.games;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'at_bats'
  ) then
    alter publication supabase_realtime add table public.at_bats;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'game_state'
  ) then
    alter publication supabase_realtime add table public.game_state;
  end if;
end $$;
