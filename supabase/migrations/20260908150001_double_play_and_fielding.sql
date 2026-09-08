-- Double play support: a second at_bats row records the runner who was
-- also put out (in addition to the batter's own row) -- each row is one
-- distinct out, which is also what makes a double play while pitching
-- correctly count as 2/3 of an inning for the pitcher (is_out is already
-- unconditional on result in the pitching-stats computation). The known
-- wrinkle: the runner's row also counts as an AB in their own batting
-- line, which isn't how a traditional box score charges a DP (only the
-- batter is charged) -- documented in CLAUDE.md as a V0 simplification.
alter table public.at_bats drop constraint if exists at_bats_result_check;
alter table public.at_bats add constraint at_bats_result_check
  check (
    result is null or result in (
      'single', 'double', 'triple', 'hr', 'flyout', 'groundout',
      'lineout', 'strikeout', 'walk', 'hbp', 'error', 'fc', 'double_play'
    )
  );

alter table public.at_bats
  add column if not exists out_type text check (out_type is null or out_type in ('force', 'tag')),
  -- Fielding credit on outs. fielded_by_position is always the position
  -- code (P/C/1B/2B/3B/SS/LF/CF/RF); exactly one of the two player
  -- columns is set depending on who was fielding -- fielded_by_player_id
  -- when it's one of ours (mode = 'pitching'), fielded_by_opponent_player_id
  -- when it's the opponent's (mode = 'hitting'). A real FK to
  -- opponent_players here (unlike the batter-identity case in Sprint 3)
  -- because the whole point of this column is opponent fielding stats --
  -- "which of their fielders handles the most balls" needs real
  -- relational integrity, not a fragile name string.
  add column if not exists fielded_by_position text,
  add column if not exists fielded_by_player_id uuid references public.players (id) on delete set null,
  add column if not exists fielded_by_opponent_player_id uuid references public.opponent_players (id) on delete set null;
