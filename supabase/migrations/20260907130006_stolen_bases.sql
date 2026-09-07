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
