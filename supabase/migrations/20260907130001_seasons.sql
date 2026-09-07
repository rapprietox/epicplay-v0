-- Seasons (one per year per team)
create table if not exists public.seasons (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  name text not null,
  year int not null,
  start_date date not null,
  end_date date not null,
  created_at timestamptz not null default now()
);

alter table public.seasons enable row level security;

create policy "seasons: team members select"
  on public.seasons for select
  using (team_id = public.my_team_id());

create policy "seasons: coach/operator write"
  on public.seasons for all
  using (public.my_role() in ('coach', 'operator') and team_id = public.my_team_id())
  with check (public.my_role() in ('coach', 'operator') and team_id = public.my_team_id());
