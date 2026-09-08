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
