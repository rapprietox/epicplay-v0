-- ============================================================================
-- Game 1 pitching corrections, v2 -- assumes 2026_lions_game1_pitching.sql
-- already ran. These are targeted UPDATEs/INSERTs against those existing
-- rows, not a fresh re-insert (running the v1 file again after this would
-- duplicate everything).
-- ============================================================================
-- Not a schema migration. Paste into the Supabase SQL Editor yourself.
--
-- This was never a bug in computePitchingLines -- it still sums
-- runs_scored exactly as before. v1 deliberately left Pedro's runs at 0
-- and skipped Jose's inning 6 entirely because no batter detail existed
-- for either at the time (inning 6 was explicitly "unknown"). This file
-- applies the detail you've now given.
--
-- RESULTING STAT LINES after this file -- read before running:
--
--   Pedro Torres: 5.0 IP, 5 H, 1 BB, 2 K, 3 R, 3 ER  -- matches your target.
--   - R placement: 2 in inning 3 (the double, then the single right
--     after it), 1 in inning 5 (the single, scoring the runner who'd
--     reached on the error) -- a plausible read of "innings 3 and 5"
--     against the hit sequence already on record.
--   - H: 6 -> 5 by deleting one of inning 2's three identical singles
--     (they're interchangeable -- removing one doesn't change the out
--     count, or anything else). This is my own call, not something you
--     specified; tell me if a different at-bat should go instead.
--
--   Jose Acosta: 3.0 IP (9 outs), 0 H, 0 BB, 3 K, 3 R, 3 ER
--     (target was 3.0 IP, 1 H, 0 BB, 2 K, 3 R)
--   - IP now correct: inning 6 (1K + 2 GO, per your answer) + inning 7
--     (3 GO, unchanged) + inning 8 (K, K, now + the FO you gave for the
--     3rd out) = 9 outs exactly.
--   - K is 3, not 2: your inning-6 answer ("1k 2 go") adds a strikeout
--     on top of the 2 already in inning 8. Entered as you gave it, not
--     silently trimmed back to 2 -- flag this if that strikeout should
--     actually be a different out type.
--   - H stays 0, not 1: no hit appears anywhere in innings 6, 7, or 8 as
--     described. Still an open gap -- say which at-bat was actually a
--     hit and I'll convert it.
--   - R placement: inning 8 keeps the 1 run it already had (the passed-
--     ball run, folded onto the first K -- a clear mechanism). The
--     other 2 of the 3 total are placed in inning 6, split across the
--     two groundouts (1 each) -- there's no described mechanism for a
--     run scoring off a plain groundout with nobody established on
--     base, so this is the weakest attribution in this whole file,
--     flagged accordingly. If you know how those runs actually scored
--     in inning 6 (a walk/error that put someone on, a wild pitch,
--     etc.), that's worth a follow-up correction.
-- ============================================================================

-- Pedro Torres, inning 3: double and single each drive in a run.
UPDATE at_bats SET runs_scored = 1
WHERE game_id = (SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM')
  AND pitcher_id = (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Pedro Torres')
  AND inning = 3 AND result IN ('double', 'single');

-- Pedro Torres, inning 5: the single drives in the runner who reached on the error.
UPDATE at_bats SET runs_scored = 1
WHERE game_id = (SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM')
  AND pitcher_id = (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Pedro Torres')
  AND inning = 5 AND result = 'single';

-- Pedro Torres, inning 2: drop one of the three identical singles (H: 6 -> 5).
DELETE FROM at_bats
WHERE id = (
  SELECT id FROM at_bats
  WHERE game_id = (SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM')
    AND pitcher_id = (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Pedro Torres')
    AND inning = 2 AND result = 'single'
  LIMIT 1
);

-- Jose Acosta, inning 6 (new -- 1K, 2 GO; 1 run folded onto each groundout, see note above)
INSERT INTO at_bats (game_id, pitcher_id, inning, inning_half, mode, result, hit_type, rbi, runs_scored, is_out, confirmed_at)
VALUES
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Jose Acosta'), 6, 'bottom', 'pitching', 'strikeout', NULL, 0, 0, true, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Jose Acosta'), 6, 'bottom', 'pitching', 'groundout', 'groundball', 0, 1, true, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Jose Acosta'), 6, 'bottom', 'pitching', 'groundout', 'groundball', 0, 1, true, now());

-- Jose Acosta, inning 8: the missing 3rd out (flyout)
INSERT INTO at_bats (game_id, pitcher_id, inning, inning_half, mode, result, hit_type, rbi, runs_scored, is_out, confirmed_at)
VALUES
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Jose Acosta'), 8, 'bottom', 'pitching', 'flyout', 'flyball', 0, 0, true, now());

-- ============================================================================
-- VERIFICATION
-- ============================================================================
SELECT p.name AS pitcher, count(*) FILTER (WHERE ab.is_out) AS outs, count(*) AS batters_faced,
  sum((ab.result IN ('single','double','triple','hr','ground_rule_double'))::int) AS h,
  sum((ab.result IN ('walk','intentional_walk'))::int) AS bb,
  sum((ab.result IN ('strikeout','dropped_third_strike_safe'))::int) AS k,
  sum(ab.runs_scored) AS runs_allowed
FROM at_bats ab JOIN players p ON p.id = ab.pitcher_id
WHERE ab.game_id = (SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM')
  AND ab.mode = 'pitching'
GROUP BY p.name;
