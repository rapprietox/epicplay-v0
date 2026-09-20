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
-- At-bats now have a draft/confirmed lifecycle: a row is created the
-- moment a new batter steps up (before any pitch), so pitches always have
-- a valid at_bat_id to attach to immediately. "Confirm At-Bat" updates the
-- same row (result, hit_type, etc.) and stamps confirmed_at. Anything
-- reading at_bats for stats must filter `confirmed_at is not null` --
-- draft rows are logging-in-progress noise, not real plate appearances yet.
alter table public.at_bats
  alter column player_id drop not null,
  alter column result drop not null,
  add column if not exists confirmed_at timestamptz,
  -- 'hitting': player_id is our batter (pitcher_id null -- we don't track
  -- opposing pitchers). 'pitching': player_id is null (the batter is an
  -- opposing player -- tracked for on-screen display only, never
  -- persisted, since no stat we compute needs it), pitcher_id is our
  -- pitcher.
  add column if not exists mode text not null default 'hitting' check (mode in ('hitting', 'pitching'));

alter table public.at_bats drop constraint if exists at_bats_result_check;
alter table public.at_bats add constraint at_bats_result_check
  check (
    result is null or result in (
      'single', 'double', 'triple', 'hr', 'flyout', 'groundout',
      'lineout', 'strikeout', 'walk', 'hbp', 'error', 'fc'
    )
  );

create index if not exists at_bats_confirmed_at_idx on public.at_bats (game_id, confirmed_at);
-- Live, mutable scratch state for an active game -- one row per game,
-- upserted continuously while the operator logs. Distinct from at_bats/
-- pitches (the permanent, append-only history): this table is what makes
-- "resume an active game on a different device" possible, since runner
-- positions are operator-adjustable at any moment and aren't purely
-- derivable from history once that's allowed.
create table if not exists public.game_state (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null unique references public.games (id) on delete cascade,
  inning int not null default 1,
  inning_half text not null default 'top' check (inning_half in ('top', 'bottom')),
  outs int not null default 0 check (outs >= 0 and outs <= 3),
  mode text not null default 'hitting' check (mode in ('hitting', 'pitching')),
  batting_order_position int,
  current_at_bat_id uuid references public.at_bats (id) on delete set null,
  current_pitcher_id uuid references public.players (id) on delete set null,
  -- Display-only opposing batter name while in 'pitching' mode -- never
  -- persisted onto at_bats (see 20260908140001_at_bats_lifecycle.sql).
  opponent_batter_name text,
  -- {"first": {"type": "player"|"opponent", "id": uuid|null, "name": text}, "second": ..., "third": ...}
  -- Scratch UI state, not queried relationally -- JSONB over six FK
  -- columns because "our runner" is a real player FK but "their runner"
  -- (pitching mode) is display-only, and normalizing both shapes into
  -- one column would need the FK to be nullable anyway.
  runners jsonb not null default '{}'::jsonb,
  pitch_count_for_current_pitcher int not null default 0,
  pitch_count_ack_75 boolean not null default false,
  pitch_count_ack_85 boolean not null default false,
  pitch_count_ack_100 boolean not null default false,
  consecutive_low_accuracy_at_bats int not null default 0,
  logging_accuracy_score numeric,
  updated_at timestamptz not null default now()
);

alter table public.game_state enable row level security;

create policy "game_state: coach/operator select"
  on public.game_state for select
  using (
    public.my_role() in ('coach', 'operator')
    and exists (
      select 1 from public.games g
      where g.id = game_state.game_id and g.team_id = public.my_team_id()
    )
  );

create policy "game_state: coach/operator write"
  on public.game_state for all
  using (
    public.my_role() in ('coach', 'operator')
    and exists (
      select 1 from public.games g
      where g.id = game_state.game_id and g.team_id = public.my_team_id()
    )
  )
  with check (
    public.my_role() in ('coach', 'operator')
    and exists (
      select 1 from public.games g
      where g.id = game_state.game_id and g.team_id = public.my_team_id()
    )
  );
create table if not exists public.substitutions (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games (id) on delete cascade,
  player_out_id uuid not null references public.players (id) on delete cascade,
  player_in_id uuid not null references public.players (id) on delete cascade,
  reason text not null check (
    reason in ('tactical', 'injury', 'ejection', 'defensive', 'pinch_hit', 'pinch_run')
  ),
  inning int not null,
  inning_half text not null check (inning_half in ('top', 'bottom')),
  created_at timestamptz not null default now()
);

create index if not exists substitutions_game_id_idx on public.substitutions (game_id);

alter table public.substitutions enable row level security;

create policy "substitutions: coach/operator select"
  on public.substitutions for select
  using (
    public.my_role() in ('coach', 'operator')
    and exists (
      select 1 from public.games g
      where g.id = substitutions.game_id and g.team_id = public.my_team_id()
    )
  );

create policy "substitutions: coach/operator write"
  on public.substitutions for all
  using (
    public.my_role() in ('coach', 'operator')
    and exists (
      select 1 from public.games g
      where g.id = substitutions.game_id and g.team_id = public.my_team_id()
    )
  )
  with check (
    public.my_role() in ('coach', 'operator')
    and exists (
      select 1 from public.games g
      where g.id = substitutions.game_id and g.team_id = public.my_team_id()
    )
  );
-- Runner-advancing events that aren't their own at-bat: wild pitch, balk,
-- passed ball, and an error that advances runners without being tied to a
-- new plate appearance (a batter reaching base on an error IS an at_bats
-- result already -- this table is for errors that happen independent of
-- a current at-bat, e.g. on a pickoff throw).
create table if not exists public.game_events (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games (id) on delete cascade,
  inning int not null,
  inning_half text not null check (inning_half in ('top', 'bottom')),
  event_type text not null check (event_type in ('wild_pitch', 'passed_ball', 'balk', 'error')),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists game_events_game_id_idx on public.game_events (game_id);

alter table public.game_events enable row level security;

create policy "game_events: coach/operator select"
  on public.game_events for select
  using (
    public.my_role() in ('coach', 'operator')
    and exists (
      select 1 from public.games g
      where g.id = game_events.game_id and g.team_id = public.my_team_id()
    )
  );

create policy "game_events: coach/operator write"
  on public.game_events for all
  using (
    public.my_role() in ('coach', 'operator')
    and exists (
      select 1 from public.games g
      where g.id = game_events.game_id and g.team_id = public.my_team_id()
    )
  )
  with check (
    public.my_role() in ('coach', 'operator')
    and exists (
      select 1 from public.games g
      where g.id = game_events.game_id and g.team_id = public.my_team_id()
    )
  );
alter table public.games
  add column if not exists logging_accuracy_score numeric(5, 2),
  add column if not exists notes text;
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
-- Double play support: a second at_bats row records the runner who was
-- also put out (in addition to the batter's own row) -- each row is one
-- distinct out, which is also what makes a double play while pitching
-- correctly count as 2/3 of an inning for the pitcher (is_out is already
-- unconditional on result in the pitching-stats computation). The known
-- wrinkle: the runner's row also counts as an AB in their own batting
-- line, which isn't how a traditional box score charges a DP (only the
-- batter is charged) -- documented in CLAUDE.md as a V0 simplification.
alter table public.at_bats drop constraint if exists at_bats_result_check;
alter table public.at_bats add constraint at_bats_result_check
  check (
    result is null or result in (
      'single', 'double', 'triple', 'hr', 'flyout', 'groundout',
      'lineout', 'strikeout', 'walk', 'hbp', 'error', 'fc', 'double_play'
    )
  );

alter table public.at_bats
  add column if not exists out_type text check (out_type is null or out_type in ('force', 'tag')),
  -- Fielding credit on outs. fielded_by_position is always the position
  -- code (P/C/1B/2B/3B/SS/LF/CF/RF); exactly one of the two player
  -- columns is set depending on who was fielding -- fielded_by_player_id
  -- when it's one of ours (mode = 'pitching'), fielded_by_opponent_player_id
  -- when it's the opponent's (mode = 'hitting'). A real FK to
  -- opponent_players here (unlike the batter-identity case in Sprint 3)
  -- because the whole point of this column is opponent fielding stats --
  -- "which of their fielders handles the most balls" needs real
  -- relational integrity, not a fragile name string.
  add column if not exists fielded_by_position text,
  add column if not exists fielded_by_player_id uuid references public.players (id) on delete set null,
  add column if not exists fielded_by_opponent_player_id uuid references public.opponent_players (id) on delete set null;
-- Attribution for wild_pitch/passed_ball/balk/error events (Fix 4 -- "no
-- RBI, logged against pitcher/catcher/fielder"). Same dual-FK shape as
-- at_bats.fielded_by_* above, and resolved the same way: derived from
-- lineup/opponent_players by position (P for wild_pitch/balk, C for
-- passed_ball, whichever position was selected for error), not tracked as
-- separate live state.
alter table public.game_events
  add column if not exists player_id uuid references public.players (id) on delete set null,
  add column if not exists opponent_player_id uuid references public.opponent_players (id) on delete set null;

-- Whether the batter swung at this pitch. Nullable/additive: existing rows
-- stay null (unknown), only pitches logged by the new sequential operator
-- flow populate it. Lets a future Chase Rate / Contact Rate / real Whiff
-- Rate be computed, unlike the outcome column alone (see CLAUDE.md).
alter table public.pitches add column if not exists swing boolean;

-- Fix 2: the strike zone grid grew a 16-cell outer "ball zone" ring
-- around the original 9-cell strike zone (see strike-zone-grid.tsx). A
-- tap in the ring stores a coordinate outside the original 0-100 range,
-- rather than remapping 0-100 to mean something new -- that would corrupt
-- every zone_x/zone_y value already on disk, all of which mean "position
-- within the strike zone." -50/150 comfortably covers the ring's actual
-- span (-16.67 to 116.67) with headroom.
alter table public.pitches drop constraint if exists pitches_zone_x_check;
alter table public.pitches add constraint pitches_zone_x_check
  check (zone_x is null or (zone_x >= -50 and zone_x <= 150));

alter table public.pitches drop constraint if exists pitches_zone_y_check;
alter table public.pitches add constraint pitches_zone_y_check
  check (zone_y is null or (zone_y >= -50 and zone_y <= 150));

-- Fix 3: batter/pitcher stance, so the operator screen can show a
-- quick L/R indicator without the operator having to remember or ask.
alter table public.players add column if not exists batting_hand char(1) default 'R';
alter table public.players add column if not exists throwing_hand char(1) default 'R';

alter table public.players drop constraint if exists players_batting_hand_check;
alter table public.players add constraint players_batting_hand_check
  check (batting_hand is null or batting_hand in ('L', 'R', 'S'));

alter table public.players drop constraint if exists players_throwing_hand_check;
alter table public.players add constraint players_throwing_hand_check
  check (throwing_hand is null or throwing_hand in ('L', 'R'));

-- Fixes 2 and 4: pickoff attempts and tag-up (left-base-early) violations
-- get their own game_events rows, distinct from the existing wild_pitch/
-- passed_ball/balk/error set. Note: the request that asked for this
-- assumed pickoff already had a game_events type -- it didn't (only a
-- UI-only "Picked Off" runner quick-action existed, which never wrote to
-- game_events; see CLAUDE.md). Widening the existing check constraint
-- rather than a new column/table, same shape as every other event type.
alter table public.game_events drop constraint if exists game_events_event_type_check;
alter table public.game_events add constraint game_events_event_type_check
  check (event_type in ('wild_pitch', 'passed_ball', 'balk', 'error', 'pickoff_out', 'pickoff_attempt', 'tag_up_violation'));

-- Fix 4: Intentional Walk gets its own at_bats.result and game_events
-- type, distinct from a regular 'walk'. Note: the request framing said
-- "no database changes needed" but also explicitly asked for
-- "at-bat result logged as 'intentional_walk' in at_bats" -- that value
-- didn't exist in either check constraint, so this migration is required
-- despite the framing (same situation as the earlier pickoff/tag-up fix).
alter table public.at_bats drop constraint if exists at_bats_result_check;
alter table public.at_bats add constraint at_bats_result_check
  check (
    result is null or result in (
      'single', 'double', 'triple', 'hr', 'flyout', 'groundout',
      'lineout', 'strikeout', 'walk', 'hbp', 'error', 'fc', 'double_play',
      'intentional_walk'
    )
  );

alter table public.game_events drop constraint if exists game_events_event_type_check;
alter table public.game_events add constraint game_events_event_type_check
  check (event_type in ('wild_pitch', 'passed_ball', 'balk', 'error', 'pickoff_out', 'pickoff_attempt', 'tag_up_violation', 'intentional_walk'));

-- Fix 2: a generic runner "Out" now requires picking a reason, each
-- logged to game_events as its own type. Includes 'stolen_base' per the
-- request's exact constraint even though nothing inserts that value yet
-- (a successful steal is still recorded in the separate stolen_bases
-- table, unchanged) -- harmless to allow in the constraint regardless.
alter table public.game_events drop constraint if exists game_events_event_type_check;
alter table public.game_events add constraint game_events_event_type_check
check (event_type in (
  'stolen_base', 'caught_stealing', 'pickoff_out', 'pickoff_attempt',
  'wild_pitch', 'passed_ball', 'balk', 'error', 'intentional_walk',
  'tag_up_violation', 'rundown_out', 'runner_passed', 'out_at_next_base'
));

-- Addition 1 (two-additions batch): "logged as squeeze_play in
-- game_events" per the request, despite it also saying "no database
-- changes needed" -- 'squeeze_play' isn't in the existing constraint
-- (same contradiction this file has hit before for pickoff and
-- intentional_walk), so it's added here.
alter table public.game_events drop constraint if exists game_events_event_type_check;
alter table public.game_events add constraint game_events_event_type_check
check (event_type in (
  'stolen_base', 'caught_stealing', 'pickoff_out', 'pickoff_attempt',
  'wild_pitch', 'passed_ball', 'balk', 'error', 'intentional_walk',
  'tag_up_violation', 'rundown_out', 'runner_passed', 'out_at_next_base',
  'squeeze_play'
));

-- Baseball-logic-fixes batch (Fix 2 dropped third strike, Fix 3 foul tip,
-- Fix 9 ground rule double). The request's own migration draft also
-- included 'interference' and 'obstruction' game_events values -- dropped
-- here since neither is actually written anywhere in this batch:
-- interference is explicitly out of scope (too rare for V0, per the
-- request's own exclusion list) and obstruction was a deliberate no-event
-- decision in an earlier batch (a decreed advance, nobody's fault, so
-- nothing is logged -- see SCORE_METHOD_EVENT in lib/operator/types.ts).
-- Adding unused enum values now would just be dead schema surface with
-- nothing to point at it; either can be added for real the day something
-- actually logs them.

-- Fix 2: a strikeout where the catcher drops the third strike needs its
-- own at_bats.result so a safe reach-on-K is distinguishable from a
-- normal strikeout in every stat that reads `result` (a caught third
-- strike stays a plain 'strikeout', unchanged).
alter table public.at_bats drop constraint if exists at_bats_result_check;
alter table public.at_bats add constraint at_bats_result_check
  check (
    result is null or result in (
      'single', 'double', 'triple', 'hr', 'flyout', 'groundout',
      'lineout', 'strikeout', 'walk', 'hbp', 'error', 'fc', 'double_play',
      'intentional_walk', 'dropped_third_strike_safe', 'ground_rule_double'
    )
  );

-- Fix 2: event log entry for a dropped third strike (logged regardless of
-- whether the batter ends up safe or thrown out at first -- the at_bats
-- result already distinguishes the two outcomes; this event just records
-- that the drop itself happened).
alter table public.game_events drop constraint if exists game_events_event_type_check;
alter table public.game_events add constraint game_events_event_type_check
check (event_type in (
  'stolen_base', 'caught_stealing', 'pickoff_out', 'pickoff_attempt',
  'wild_pitch', 'passed_ball', 'balk', 'error', 'intentional_walk',
  'tag_up_violation', 'rundown_out', 'runner_passed', 'out_at_next_base',
  'squeeze_play', 'dropped_third_strike'
));

-- Fix 3: "foul tip (caught)" is its own pitch outcome, distinct from a
-- regular foul -- a foul tip counts toward strike three (ends the at-bat
-- as a strikeout), which a regular foul never does. The request claimed
-- no schema change was needed here ("already has room for this value"),
-- but pitches.outcome's check constraint only ever allowed
-- ('strike','ball','foul','hbp','inplay') -- 'foul_tip' was never a member,
-- so this migration is required despite that claim (the same
-- claimed-no-DB-change-but-actually-is pattern this project has hit
-- several times before, e.g. pickoff/intentional_walk/squeeze_play).
alter table public.pitches drop constraint if exists pitches_outcome_check;
alter table public.pitches add constraint pitches_outcome_check
  check (outcome in ('strike', 'ball', 'foul', 'foul_tip', 'hbp', 'inplay'));

-- Field calibration tool: one-time mapping of the two field images
-- (field-2d.png, field-3d.png) to the 0-100 at_bats.field_x/field_y
-- coordinate system, so a future spray chart can place a ball on the
-- actual image via interpolation between these 7 anchor points instead
-- of guessing. This migration only creates the table -- the spray chart
-- itself is a separate, later piece of work.
create table if not exists public.field_calibration (
  id uuid default gen_random_uuid() primary key,
  team_id uuid references public.teams(id) on delete cascade,
  field_type text check (field_type in ('2d', '3d')),
  calibration_points jsonb,
  created_at timestamptz default now(),
  unique(team_id, field_type)
);

alter table public.field_calibration enable row level security;

-- Coach-only, same condition for read and write -- this is explicitly a
-- coach setup tool (unlike players/games/lineup, which any team member
-- can at least read), and nothing else reads from this table yet, so one
-- "for all" policy covers select too rather than needing a second policy
-- with an identical condition.
create policy "field_calibration: coach only"
  on public.field_calibration for all
  using (public.my_role() = 'coach' and team_id = public.my_team_id())
  with check (public.my_role() = 'coach' and team_id = public.my_team_id());
