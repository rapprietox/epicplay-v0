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
