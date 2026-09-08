-- Attribution for wild_pitch/passed_ball/balk/error events (Fix 4 -- "no
-- RBI, logged against pitcher/catcher/fielder"). Same dual-FK shape as
-- at_bats.fielded_by_* above, and resolved the same way: derived from
-- lineup/opponent_players by position (P for wild_pitch/balk, C for
-- passed_ball, whichever position was selected for error), not tracked as
-- separate live state.
alter table public.game_events
  add column if not exists player_id uuid references public.players (id) on delete set null,
  add column if not exists opponent_player_id uuid references public.opponent_players (id) on delete set null;
