-- Seasons (one per year per team)
create table if not exists public.seasons (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  name text not null,
  year int not null,
  start_date date not null,
  end_date date not null,
  created_at timestamptz not null default now()
);

alter table public.seasons enable row level security;

create policy "seasons: team members select"
  on public.seasons for select
  using (team_id = public.my_team_id());

create policy "seasons: coach/operator write"
  on public.seasons for all
  using (public.my_role() in ('coach', 'operator') and team_id = public.my_team_id())
  with check (public.my_role() in ('coach', 'operator') and team_id = public.my_team_id());
-- Opponents master list -- auto-created from schedule import, or free-text
-- fallback entries for unscheduled/friendly games. Deduped by (team_id, name).
create table if not exists public.opponents (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (team_id, name)
);

alter table public.opponents enable row level security;

create policy "opponents: team members select"
  on public.opponents for select
  using (team_id = public.my_team_id());

create policy "opponents: coach/operator write"
  on public.opponents for all
  using (public.my_role() in ('coach', 'operator') and team_id = public.my_team_id())
  with check (public.my_role() in ('coach', 'operator') and team_id = public.my_team_id());
-- Opponent players -- built up over the season from lineup photo imports.
create table if not exists public.opponent_players (
  id uuid primary key default gen_random_uuid(),
  opponent_id uuid not null references public.opponents (id) on delete cascade,
  name text not null,
  jersey_number text not null default '—',
  position text,
  created_at timestamptz not null default now()
);

alter table public.opponent_players enable row level security;

create policy "opponent_players: team members select"
  on public.opponent_players for select
  using (
    exists (
      select 1 from public.opponents o
      where o.id = opponent_players.opponent_id and o.team_id = public.my_team_id()
    )
  );

create policy "opponent_players: coach/operator write"
  on public.opponent_players for all
  using (
    public.my_role() in ('coach', 'operator')
    and exists (
      select 1 from public.opponents o
      where o.id = opponent_players.opponent_id and o.team_id = public.my_team_id()
    )
  )
  with check (
    public.my_role() in ('coach', 'operator')
    and exists (
      select 1 from public.opponents o
      where o.id = opponent_players.opponent_id and o.team_id = public.my_team_id()
    )
  );
-- games.our_score / games.opponent_score already exist from Sprint 1
-- (20260907120005_games.sql) -- nothing to add there.
alter table public.games
  add column if not exists season_id uuid references public.seasons (id) on delete set null,
  add column if not exists opponent_id uuid references public.opponents (id) on delete set null,
  add column if not exists game_time text,
  add column if not exists umpire_name text,
  -- Manually set by the coach; deriving a "winning pitcher" automatically
  -- from play-by-play is genuinely hard (who was pitching when the team
  -- took a lead it never gave up) and not worth building for V0.
  add column if not exists winning_pitcher_id uuid references public.players (id) on delete set null;

create index if not exists games_season_id_idx on public.games (season_id);
create index if not exists games_opponent_id_idx on public.games (opponent_id);

-- The schedule table needs to show cancelled games with a badge, which
-- 'setup'/'active'/'completed' can't represent.
alter table public.games drop constraint if exists games_status_check;
alter table public.games add constraint games_status_check
  check (status in ('setup', 'active', 'completed', 'cancelled'));
-- Who was pitching during this at-bat. Nullable and unpopulated until the
-- operator game-logging screen captures it (future sprint) -- lets the
-- Team Leaders board query K / IP / H-and-BB-allowed / WHIP once that data
-- exists, without blocking Sprint 2 on building live game logging first.
alter table public.at_bats
  add column if not exists pitcher_id uuid references public.players (id) on delete set null;

create index if not exists at_bats_pitcher_id_idx on public.at_bats (pitcher_id);
-- Stolen bases -- a standalone event, not tied to an at_bat, since a steal
-- happens between pitches rather than as its own plate appearance.
create table if not exists public.stolen_bases (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  inning int not null,
  created_at timestamptz not null default now()
);

create index if not exists stolen_bases_game_id_idx on public.stolen_bases (game_id);
create index if not exists stolen_bases_player_id_idx on public.stolen_bases (player_id);

alter table public.stolen_bases enable row level security;

create policy "stolen_bases: coach/operator select team"
  on public.stolen_bases for select
  using (
    public.my_role() in ('coach', 'operator')
    and exists (
      select 1 from public.games g
      where g.id = stolen_bases.game_id and g.team_id = public.my_team_id()
    )
  );

create policy "stolen_bases: player selects own"
  on public.stolen_bases for select
  using (public.my_role() = 'player' and player_id = public.my_player_id());

create policy "stolen_bases: coach/operator write"
  on public.stolen_bases for all
  using (
    public.my_role() in ('coach', 'operator')
    and exists (
      select 1 from public.games g
      where g.id = stolen_bases.game_id and g.team_id = public.my_team_id()
    )
  )
  with check (
    public.my_role() in ('coach', 'operator')
    and exists (
      select 1 from public.games g
      where g.id = stolen_bases.game_id and g.team_id = public.my_team_id()
    )
  );
-- Private buckets for season schedule PDFs and opponent lineup photos.
-- Objects are stored under a `${team_id}/...` path, and RLS checks that
-- first path segment against the caller's own team -- so uploads/reads
-- stay scoped per team the same way every other table does.
insert into storage.buckets (id, name, public)
values ('season-schedules', 'season-schedules', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('opponent-photos', 'opponent-photos', false)
on conflict (id) do nothing;

create policy "season-schedules: coach/operator read/write own team"
  on storage.objects for all
  using (
    bucket_id = 'season-schedules'
    and public.my_role() in ('coach', 'operator')
    and (storage.foldername(name))[1] = public.my_team_id()::text
  )
  with check (
    bucket_id = 'season-schedules'
    and public.my_role() in ('coach', 'operator')
    and (storage.foldername(name))[1] = public.my_team_id()::text
  );

create policy "opponent-photos: coach/operator read/write own team"
  on storage.objects for all
  using (
    bucket_id = 'opponent-photos'
    and public.my_role() in ('coach', 'operator')
    and (storage.foldername(name))[1] = public.my_team_id()::text
  )
  with check (
    bucket_id = 'opponent-photos'
    and public.my_role() in ('coach', 'operator')
    and (storage.foldername(name))[1] = public.my_team_id()::text
  );
