-- ============================================================================
-- Game 2 pitching: Pedro Torres (innings 1-2) and Mike Casals (innings 3-5)
-- ============================================================================
-- Not a schema migration. Paste into the Supabase SQL Editor yourself --
-- no tool in this environment executes SQL against the live database.
--
-- Unlike Game 1's pitching file, there's no real batter-by-batter record
-- to reconstruct here -- only aggregate targets, with "3 H (estimate)"
-- and "distribute realistically" explicitly asking for a constructed
-- sequence rather than a real one. The two innings below are a plausible
-- standard distribution (strikeouts and the given hit/walk counts spread
-- across clean 3-out frames, runs folded onto whichever out/hit in that
-- frame is the natural place for a runner to score) built to land
-- exactly on your stated totals -- not a reconstruction of real at-bats.
--
-- RESULTING STAT LINES -- both land exactly on target:
--   Pedro Torres: 2.0 IP (6 outs), 3 H, 1 BB, 2 K, 4 R, 4 ER -- 10 batters faced
--     (target said "approximately 11"; the given hard numbers -- 6 outs
--     + 3 H + 1 BB -- only add up to 10. Not padded with an 11th
--     fabricated batter just to hit the soft estimate exactly.)
--   Mike Casals: 3.0 IP (9 outs), 3 H, 2 BB, 5 K, 4 R, 4 ER -- 14 batters faced
--     (matches "approximately 14" exactly: 9 outs + 3 H + 2 BB = 14).
--
-- player_id is null throughout (opponent batters aren't tracked in this
-- schema). inning_half = 'top' for all of it -- Piranhas were away,
-- Lions home, so Lions pitch during the top half (same logic as Game
-- 1's 'bottom', just flipped since Lions were away there).
-- ============================================================================

INSERT INTO at_bats (game_id, pitcher_id, inning, inning_half, mode, result, hit_type, rbi, runs_scored, is_out, confirmed_at)
VALUES
-- Pedro Torres, inning 1: single, single, walk, groundout (2 runs score), flyout (1 run scores), strikeout
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='6:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Pedro Torres'), 1, 'top', 'pitching', 'single', NULL, 0, 0, false, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='6:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Pedro Torres'), 1, 'top', 'pitching', 'single', NULL, 0, 0, false, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='6:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Pedro Torres'), 1, 'top', 'pitching', 'walk', NULL, 0, 0, false, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='6:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Pedro Torres'), 1, 'top', 'pitching', 'groundout', 'groundball', 0, 2, true, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='6:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Pedro Torres'), 1, 'top', 'pitching', 'flyout', 'flyball', 0, 1, true, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='6:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Pedro Torres'), 1, 'top', 'pitching', 'strikeout', NULL, 0, 0, true, now()),
-- Pedro Torres, inning 2: single, groundout (1 run scores), flyout, strikeout
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='6:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Pedro Torres'), 2, 'top', 'pitching', 'single', NULL, 0, 0, false, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='6:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Pedro Torres'), 2, 'top', 'pitching', 'groundout', 'groundball', 0, 1, true, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='6:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Pedro Torres'), 2, 'top', 'pitching', 'flyout', 'flyball', 0, 0, true, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='6:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Pedro Torres'), 2, 'top', 'pitching', 'strikeout', NULL, 0, 0, true, now()),
-- Mike Casals, inning 3: single, walk, strikeout, strikeout, groundout (2 runs score)
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='6:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Mike Casals'), 3, 'top', 'pitching', 'single', NULL, 0, 0, false, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='6:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Mike Casals'), 3, 'top', 'pitching', 'walk', NULL, 0, 0, false, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='6:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Mike Casals'), 3, 'top', 'pitching', 'strikeout', NULL, 0, 0, true, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='6:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Mike Casals'), 3, 'top', 'pitching', 'strikeout', NULL, 0, 0, true, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='6:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Mike Casals'), 3, 'top', 'pitching', 'groundout', 'groundball', 0, 2, true, now()),
-- Mike Casals, inning 4: single, walk, strikeout, strikeout, flyout (1 run scores)
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='6:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Mike Casals'), 4, 'top', 'pitching', 'single', NULL, 0, 0, false, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='6:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Mike Casals'), 4, 'top', 'pitching', 'walk', NULL, 0, 0, false, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='6:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Mike Casals'), 4, 'top', 'pitching', 'strikeout', NULL, 0, 0, true, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='6:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Mike Casals'), 4, 'top', 'pitching', 'strikeout', NULL, 0, 0, true, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='6:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Mike Casals'), 4, 'top', 'pitching', 'flyout', 'flyball', 0, 1, true, now()),
-- Mike Casals, inning 5: single, strikeout, groundout (1 run scores), flyout
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='6:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Mike Casals'), 5, 'top', 'pitching', 'single', NULL, 0, 0, false, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='6:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Mike Casals'), 5, 'top', 'pitching', 'strikeout', NULL, 0, 0, true, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='6:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Mike Casals'), 5, 'top', 'pitching', 'groundout', 'groundball', 0, 1, true, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='6:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Mike Casals'), 5, 'top', 'pitching', 'flyout', 'flyball', 0, 0, true, now());

-- ============================================================================
-- VERIFICATION
-- ============================================================================
SELECT p.name AS pitcher, count(*) FILTER (WHERE ab.is_out) AS outs, count(*) AS batters_faced,
  sum((ab.result IN ('single','double','triple','hr','ground_rule_double'))::int) AS h,
  sum((ab.result IN ('walk','intentional_walk'))::int) AS bb,
  sum((ab.result IN ('strikeout','dropped_third_strike_safe'))::int) AS k,
  sum(ab.runs_scored) AS runs_allowed
FROM at_bats ab JOIN players p ON p.id = ab.pitcher_id
WHERE ab.game_id = (SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='6:30 PM')
  AND ab.mode = 'pitching'
GROUP BY p.name;
