-- Opponent pitcher intelligence batch.
--
-- Required beyond the literal request ("no new database tables needed --
-- data already exists in pitches, at_bats, and opponent_players"): that's
-- true for tables, but there is no existing COLUMN linking a hitting-mode
-- at-bat (or the pitches logged during it) to which specific opposing
-- player was pitching. The operator screen's opponentPitcherInfo
-- (operator-console.tsx) is only ever a static best-effort guess
-- (opponentPlayers.find(p => p.position === "P")) for the top-bar
-- display -- it was never persisted onto at_bats, and there's no live
-- tracking of an opposing pitching change at all. Without a real column,
-- "their pitch arsenal," "zone tendencies," and "our performance against
-- them" can't be attributed to a specific opposing pitcher from historical
-- data -- this is the minimum schema addition that makes the rest of the
-- feature possible.
alter table public.at_bats add column if not exists opponent_pitcher_id uuid references public.opponent_players (id) on delete set null;

-- Mirrors current_pitcher_id (our own pitcher, already tracked) for the
-- opposing side -- lets the operator set/correct "who's pitching for
-- them right now" once, at the moment we're hitting, rather than having
-- to pick it on every single at-bat.
alter table public.game_state add column if not exists current_opponent_pitcher_id uuid references public.opponent_players (id) on delete set null;
