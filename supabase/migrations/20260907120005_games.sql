-- Games
create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  opponent_name text not null,
  game_date date not null,
  game_type text not null check (
    game_type in ('friendly', 'preseason', 'season', 'playoff', 'tournament', 'championship')
  ),
  home_away text not null check (home_away in ('home', 'away')),
  our_score int not null default 0,
  opponent_score int not null default 0,
  status text not null default 'setup' check (status in ('setup', 'active', 'completed')),
  created_at timestamptz not null default now()
);

alter table public.games enable row level security;

create policy "games: team members select"
  on public.games for select
  using (team_id = public.my_team_id());

create policy "games: coach/operator write"
  on public.games for all
  using (public.my_role() in ('coach', 'operator') and team_id = public.my_team_id())
  with check (public.my_role() in ('coach', 'operator') and team_id = public.my_team_id());
