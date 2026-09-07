-- games.our_score / games.opponent_score already exist from Sprint 1
-- (20260907120005_games.sql) -- nothing to add there.
alter table public.games
  add column if not exists season_id uuid references public.seasons (id) on delete set null,
  add column if not exists opponent_id uuid references public.opponents (id) on delete set null,
  add column if not exists game_time text,
  add column if not exists umpire_name text,
  -- Manually set by the coach; deriving a "winning pitcher" automatically
  -- from play-by-play is genuinely hard (who was pitching when the team
  -- took a lead it never gave up) and not worth building for V0.
  add column if not exists winning_pitcher_id uuid references public.players (id) on delete set null;

create index if not exists games_season_id_idx on public.games (season_id);
create index if not exists games_opponent_id_idx on public.games (opponent_id);

-- The schedule table needs to show cancelled games with a badge, which
-- 'setup'/'active'/'completed' can't represent.
alter table public.games drop constraint if exists games_status_check;
alter table public.games add constraint games_status_check
  check (status in ('setup', 'active', 'completed', 'cancelled'));
