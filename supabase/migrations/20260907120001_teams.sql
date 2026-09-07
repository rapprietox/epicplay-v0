-- Teams
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

alter table public.teams enable row level security;
-- Policies added in 20260907120003_teams_policies.sql, after profiles/helper
-- functions exist (avoids a circular table dependency at migration time).
