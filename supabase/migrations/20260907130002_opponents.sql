-- Opponents master list -- auto-created from schedule import, or free-text
-- fallback entries for unscheduled/friendly games. Deduped by (team_id, name).
create table if not exists public.opponents (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (team_id, name)
);

alter table public.opponents enable row level security;

create policy "opponents: team members select"
  on public.opponents for select
  using (team_id = public.my_team_id());

create policy "opponents: coach/operator write"
  on public.opponents for all
  using (public.my_role() in ('coach', 'operator') and team_id = public.my_team_id())
  with check (public.my_role() in ('coach', 'operator') and team_id = public.my_team_id());
