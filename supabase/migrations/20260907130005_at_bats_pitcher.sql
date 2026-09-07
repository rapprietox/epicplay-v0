-- Who was pitching during this at-bat. Nullable and unpopulated until the
-- operator game-logging screen captures it (future sprint) -- lets the
-- Team Leaders board query K / IP / H-and-BB-allowed / WHIP once that data
-- exists, without blocking Sprint 2 on building live game logging first.
alter table public.at_bats
  add column if not exists pitcher_id uuid references public.players (id) on delete set null;

create index if not exists at_bats_pitcher_id_idx on public.at_bats (pitcher_id);
