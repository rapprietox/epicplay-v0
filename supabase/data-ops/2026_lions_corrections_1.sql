-- ============================================================================
-- Corrections to 2026_lions_season_setup.sql -- round 1
-- ============================================================================
-- Not a schema migration. Paste into the Supabase SQL Editor yourself --
-- no tool in this environment can execute SQL against the live database.
--
-- Fixes applied vs. the corrections as originally drafted:
--   1. game_time is stored as text '3:30 PM' (matching every other game's
--      display format), not '15:30:00' -- the original WHERE clause would
--      have matched zero rows and silently done nothing.
--   2. The new Francisco at-bat needs confirmed_at set, or it's an
--      unconfirmed draft row and invisible to every stats query in this
--      app (computeBattingLines, the leaders board, the player page all
--      filter confirmed_at is not null). Also: Jose's run needs to move
--      OFF Pedro's row (runs_scored 1 -> 0), not just Pedro's rbi (which
--      was already 0, never 1) -- otherwise Jose's run would be anchored
--      to both rows at once (Pedro's existing runs_scored=1 AND a new,
--      unmatched rbi=1 on Francisco's row with no run of its own).
--   3. Confirmed with you: Game 1's Carlos steal count is already correct
--      (1 row, inning 1) -- nothing to change there. Game 2 trims from 5
--      down to 2, keeping the earliest 2 (inning 1's SB-2nd and SB-3rd).
-- ============================================================================

-- Correction 1 -- Game 1, inning 8: "Aít" was Pedro Torres by batting-order
-- inference; you've confirmed it should be Aíd Martínez instead.
UPDATE at_bats
SET player_id = (SELECT id FROM players WHERE name = 'Aíd Martínez' AND team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75')
WHERE game_id = (SELECT id FROM games WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date = '2026-10-24' AND game_time = '3:30 PM')
  AND inning = 8
  AND player_id = (SELECT id FROM players WHERE name = 'Pedro Torres' AND team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75')
  AND result = 'single';

-- Correction 2 -- Game 1, inning 6: Francisco actually had a hit that drove
-- Jose in; add that row and move the run credit off Pedro's walk.
INSERT INTO at_bats (game_id, player_id, inning, inning_half, batting_order_position, mode, result, rbi, runs_scored, is_out, confirmed_at)
VALUES (
  (SELECT id FROM games WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date = '2026-10-24' AND game_time = '3:30 PM'),
  (SELECT id FROM players WHERE name = 'Francisco Perez' AND team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75'),
  6, 'top', 2, 'hitting', 'single', 1, 1, false, now()
);

UPDATE at_bats
SET runs_scored = 0
WHERE game_id = (SELECT id FROM games WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date = '2026-10-24' AND game_time = '3:30 PM')
  AND inning = 6
  AND player_id = (SELECT id FROM players WHERE name = 'Pedro Torres' AND team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75')
  AND result = 'walk';

-- Correction 3 -- Game 2 only: trim Carlos's steals from 5 down to 2,
-- keeping the earliest 2 (Game 1's single Carlos steal is untouched).
DELETE FROM stolen_bases
WHERE game_id = (SELECT id FROM games WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date = '2026-10-24' AND game_time = '6:30 PM')
  AND player_id = (SELECT id FROM players WHERE name = 'Carlos De León' AND team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75')
  AND id NOT IN (
    SELECT id FROM stolen_bases
    WHERE game_id = (SELECT id FROM games WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date = '2026-10-24' AND game_time = '6:30 PM')
      AND player_id = (SELECT id FROM players WHERE name = 'Carlos De León' AND team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75')
    ORDER BY created_at ASC
    LIMIT 2
  );

-- ============================================================================
-- VERIFICATION -- run after the above
-- ============================================================================
SELECT inning, player_id, result, rbi, runs_scored FROM at_bats
WHERE game_id = (SELECT id FROM games WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date = '2026-10-24' AND game_time = '3:30 PM')
  AND inning IN (6, 8)
ORDER BY inning;

SELECT g.game_time, count(*) AS carlos_steals
FROM stolen_bases sb JOIN games g ON g.id = sb.game_id
WHERE g.team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75'
  AND sb.player_id = (SELECT id FROM players WHERE name = 'Carlos De León' AND team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75')
GROUP BY g.game_time;
