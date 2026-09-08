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
