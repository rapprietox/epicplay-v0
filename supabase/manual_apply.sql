-- Teams
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

alter table public.teams enable row level security;
-- Policies added in 20260907120003_teams_policies.sql, after profiles/helper
-- functions exist (avoids a circular table dependency at migration time).
-- Profiles: bridges auth.users to a role (operator/player/coach), a team,
-- and (for players) the players row that owns their stats.
-- Not part of the schema the user dictated verbatim, but required for
-- role-based access control -- there is otherwise nowhere to store "role".
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  role text not null default 'player' check (role in ('operator', 'player', 'coach')),
  team_id uuid references public.teams (id) on delete set null,
  -- players doesn't exist yet at this point in the migration order; the FK
  -- for this column is added in 20260907120004_players.sql once it does.
  player_id uuid,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Auto-create a profile row on first Google sign-in. Defaults to role
-- 'player' with no team/player link -- a coach must assign team_id, role,
-- and (for players) player_id manually via SQL/dashboard for V0, since
-- there is no admin UI yet.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Security-definer helpers so RLS policies elsewhere can read the caller's
-- role/team/player without re-triggering RLS on profiles (which would
-- recurse).
create or replace function public.my_role()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.my_team_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select team_id from public.profiles where id = auth.uid();
$$;

create or replace function public.my_player_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select player_id from public.profiles where id = auth.uid();
$$;

-- Profiles policies
create policy "profiles: self select"
  on public.profiles for select
  using (id = auth.uid());

create policy "profiles: coach selects team"
  on public.profiles for select
  using (public.my_role() = 'coach' and team_id = public.my_team_id());

create policy "profiles: coach updates team"
  on public.profiles for update
  using (public.my_role() = 'coach' and team_id = public.my_team_id())
  with check (public.my_role() = 'coach' and team_id = public.my_team_id());
-- Teams policies (split from the table creation because they depend on the
-- my_role()/my_team_id() helpers defined in the profiles migration).
create policy "teams: members select"
  on public.teams for select
  using (id = public.my_team_id());

create policy "teams: coach updates own team"
  on public.teams for update
  using (public.my_role() = 'coach' and id = public.my_team_id())
  with check (public.my_role() = 'coach' and id = public.my_team_id());

-- Team creation and player/coach/operator onboarding for V0 is done via the
-- Supabase SQL editor / service role, not through client-side policies.
-- Players
create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  name text not null,
  jersey_number int,
  position text,
  user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- Now that players exists, wire up the FK deferred from the profiles migration.
alter table public.profiles
  add constraint profiles_player_id_fkey
  foreign key (player_id) references public.players (id) on delete set null;

alter table public.players enable row level security;

create policy "players: team members select"
  on public.players for select
  using (team_id = public.my_team_id());

create policy "players: coach/operator write"
  on public.players for all
  using (public.my_role() in ('coach', 'operator') and team_id = public.my_team_id())
  with check (public.my_role() in ('coach', 'operator') and team_id = public.my_team_id());
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
-- Lineup
create table if not exists public.lineup (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  batting_order int not null,
  position text,
  created_at timestamptz not null default now(),
  unique (game_id, batting_order)
);

alter table public.lineup enable row level security;

create policy "lineup: team members select"
  on public.lineup for select
  using (
    exists (
      select 1 from public.games g
      where g.id = lineup.game_id and g.team_id = public.my_team_id()
    )
  );

create policy "lineup: coach/operator write"
  on public.lineup for all
  using (
    public.my_role() in ('coach', 'operator')
    and exists (
      select 1 from public.games g
      where g.id = lineup.game_id and g.team_id = public.my_team_id()
    )
  )
  with check (
    public.my_role() in ('coach', 'operator')
    and exists (
      select 1 from public.games g
      where g.id = lineup.game_id and g.team_id = public.my_team_id()
    )
  );
-- At-bats
create table if not exists public.at_bats (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  inning int not null,
  inning_half text not null check (inning_half in ('top', 'bottom')),
  batting_order_position int,
  result text not null check (
    result in (
      'single', 'double', 'triple', 'hr', 'flyout', 'groundout',
      'lineout', 'strikeout', 'walk', 'hbp', 'error', 'fc'
    )
  ),
  hit_type text check (
    hit_type is null or hit_type in ('groundball', 'linedrive', 'flyball', 'bunt', 'popup', 'hr')
  ),
  field_x numeric check (field_x is null or (field_x >= 0 and field_x <= 100)),
  field_y numeric check (field_y is null or (field_y >= 0 and field_y <= 100)),
  rbi int not null default 0,
  runs_scored int not null default 0,
  is_out boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists at_bats_game_id_idx on public.at_bats (game_id);
create index if not exists at_bats_player_id_idx on public.at_bats (player_id);

alter table public.at_bats enable row level security;

create policy "at_bats: coach/operator select team"
  on public.at_bats for select
  using (
    public.my_role() in ('coach', 'operator')
    and exists (
      select 1 from public.games g
      where g.id = at_bats.game_id and g.team_id = public.my_team_id()
    )
  );

create policy "at_bats: player selects own"
  on public.at_bats for select
  using (public.my_role() = 'player' and player_id = public.my_player_id());

create policy "at_bats: coach/operator write"
  on public.at_bats for insert
  with check (
    public.my_role() in ('coach', 'operator')
    and exists (
      select 1 from public.games g
      where g.id = at_bats.game_id and g.team_id = public.my_team_id()
    )
  );

create policy "at_bats: coach/operator update"
  on public.at_bats for update
  using (
    public.my_role() in ('coach', 'operator')
    and exists (
      select 1 from public.games g
      where g.id = at_bats.game_id and g.team_id = public.my_team_id()
    )
  )
  with check (
    public.my_role() in ('coach', 'operator')
    and exists (
      select 1 from public.games g
      where g.id = at_bats.game_id and g.team_id = public.my_team_id()
    )
  );

create policy "at_bats: coach/operator delete"
  on public.at_bats for delete
  using (
    public.my_role() in ('coach', 'operator')
    and exists (
      select 1 from public.games g
      where g.id = at_bats.game_id and g.team_id = public.my_team_id()
    )
  );
-- Pitches
create table if not exists public.pitches (
  id uuid primary key default gen_random_uuid(),
  at_bat_id uuid not null references public.at_bats (id) on delete cascade,
  pitch_number int not null,
  pitch_type text check (
    pitch_type is null or pitch_type in ('fastball', 'curveball', 'changeup', 'slider', '2seam', 'other')
  ),
  zone_x numeric check (zone_x is null or (zone_x >= 0 and zone_x <= 100)),
  zone_y numeric check (zone_y is null or (zone_y >= 0 and zone_y <= 100)),
  outcome text not null check (outcome in ('strike', 'ball', 'foul', 'hbp', 'inplay')),
  created_at timestamptz not null default now()
);

create index if not exists pitches_at_bat_id_idx on public.pitches (at_bat_id);

alter table public.pitches enable row level security;

create policy "pitches: coach/operator select team"
  on public.pitches for select
  using (
    public.my_role() in ('coach', 'operator')
    and exists (
      select 1 from public.at_bats ab
      join public.games g on g.id = ab.game_id
      where ab.id = pitches.at_bat_id and g.team_id = public.my_team_id()
    )
  );

create policy "pitches: player selects own"
  on public.pitches for select
  using (
    public.my_role() = 'player'
    and exists (
      select 1 from public.at_bats ab
      where ab.id = pitches.at_bat_id and ab.player_id = public.my_player_id()
    )
  );

create policy "pitches: coach/operator insert"
  on public.pitches for insert
  with check (
    public.my_role() in ('coach', 'operator')
    and exists (
      select 1 from public.at_bats ab
      join public.games g on g.id = ab.game_id
      where ab.id = pitches.at_bat_id and g.team_id = public.my_team_id()
    )
  );

create policy "pitches: coach/operator update"
  on public.pitches for update
  using (
    public.my_role() in ('coach', 'operator')
    and exists (
      select 1 from public.at_bats ab
      join public.games g on g.id = ab.game_id
      where ab.id = pitches.at_bat_id and g.team_id = public.my_team_id()
    )
  )
  with check (
    public.my_role() in ('coach', 'operator')
    and exists (
      select 1 from public.at_bats ab
      join public.games g on g.id = ab.game_id
      where ab.id = pitches.at_bat_id and g.team_id = public.my_team_id()
    )
  );

create policy "pitches: coach/operator delete"
  on public.pitches for delete
  using (
    public.my_role() in ('coach', 'operator')
    and exists (
      select 1 from public.at_bats ab
      join public.games g on g.id = ab.game_id
      where ab.id = pitches.at_bat_id and g.team_id = public.my_team_id()
    )
  );
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
