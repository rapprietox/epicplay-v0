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
