-- Lineup Intelligence 2.0 -- Parts 1/2/4 schema: player attributes,
-- lineup-placement override tracking, and stored AI game analyses.
--
-- RLS note: the request's own CREATE TABLE statements for
-- lineup_overrides/game_analyses have no RLS at all. Every other table
-- in this schema has RLS enabled with a coach/operator-write, team-
-- scoped policy (see CLAUDE.md's RLS design section) -- leaving these
-- two without it would make them readable/writable by anyone holding
-- just the anon key, a real gap, not a stylistic nitpick. Both are
-- added here, matching the same shape players/games already use.

alter table public.players add column if not exists speed_rating integer default 3 check (speed_rating between 1 and 5);
alter table public.players add column if not exists player_type text default 'all_rounder' check (player_type in ('power', 'contact', 'table_setter', 'speedster', 'all_rounder', 'pitcher_only'));

create table if not exists public.lineup_overrides (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references public.teams(id),
  game_id uuid references public.games(id),
  player_id uuid references public.players(id),
  slot integer,
  ai_rating text,
  override_reason text,
  created_at timestamptz default now()
);

alter table public.lineup_overrides enable row level security;

create policy "lineup_overrides: coach/operator select own team"
  on public.lineup_overrides for select
  using (public.my_role() in ('coach', 'operator') and team_id = public.my_team_id());

create policy "lineup_overrides: coach/operator write own team"
  on public.lineup_overrides for all
  using (public.my_role() in ('coach', 'operator') and team_id = public.my_team_id())
  with check (public.my_role() in ('coach', 'operator') and team_id = public.my_team_id());

create table if not exists public.game_analyses (
  id uuid primary key default gen_random_uuid(),
  game_id uuid references public.games(id) unique,
  team_id uuid references public.teams(id),
  analysis_type text check (analysis_type in ('post_game_loss', 'post_game_win', 'pre_game')),
  content text,
  reliability_pct integer,
  created_at timestamptz default now()
);

alter table public.game_analyses enable row level security;

create policy "game_analyses: coach/operator select own team"
  on public.game_analyses for select
  using (public.my_role() in ('coach', 'operator') and team_id = public.my_team_id());

create policy "game_analyses: coach/operator write own team"
  on public.game_analyses for all
  using (public.my_role() in ('coach', 'operator') and team_id = public.my_team_id())
  with check (public.my_role() in ('coach', 'operator') and team_id = public.my_team_id());
