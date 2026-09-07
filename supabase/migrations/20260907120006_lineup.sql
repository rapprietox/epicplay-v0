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
