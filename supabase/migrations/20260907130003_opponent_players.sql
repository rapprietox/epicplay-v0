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
