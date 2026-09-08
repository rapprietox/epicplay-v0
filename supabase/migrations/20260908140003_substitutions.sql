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
