-- Feature 2 (game-rules batch): per-season game rules (max innings, time
-- limit, new-inning threshold), applied to every game in that season
-- unless a per-game override is set. Exactly the three columns given in
-- the request, on `seasons`.
alter table public.seasons add column if not exists max_innings integer default null;
alter table public.seasons add column if not exists time_limit_minutes integer default null;
alter table public.seasons add column if not exists new_inning_threshold_minutes integer default 10;

-- Required beyond the literal request: "Per-game override... shows the
-- same three fields to set game-specific rules" has nowhere to be
-- stored -- the request's own migration only touched `seasons`. Mirrors
-- the same three columns onto `games`, plus a boolean flag
-- (override_season_rules) to distinguish "never overridden, inherit
-- from the season" from "overridden, and this particular field is
-- intentionally blank/no-limit" -- both would otherwise be
-- indistinguishable as a plain null on the game row. new_inning_threshold_minutes
-- defaults to null here (not 10, unlike the season column) -- the "10"
-- default is applied once, in the resolution helper
-- (src/lib/game-rules.ts), rather than duplicated in two places.
alter table public.games add column if not exists override_season_rules boolean not null default false;
alter table public.games add column if not exists max_innings integer default null;
alter table public.games add column if not exists time_limit_minutes integer default null;
alter table public.games add column if not exists new_inning_threshold_minutes integer default null;

-- Feature 2: anchors the operator's game timer. Set once, the moment
-- game_state is first created for a game (getOrCreateGameState in
-- src/app/operator/actions.ts) -- which happens the instant the
-- operator screen first loads after Start Game, i.e. "when the operator
-- taps Start Game" in practice. Elapsed/remaining time is computed
-- client-side from this single timestamp rather than persisting a
-- ticking counter, so it reads correctly across reloads and devices
-- with no continuous writes needed.
alter table public.game_state add column if not exists game_started_at timestamptz default null;
