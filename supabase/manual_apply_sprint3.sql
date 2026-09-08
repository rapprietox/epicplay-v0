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
