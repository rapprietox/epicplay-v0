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
