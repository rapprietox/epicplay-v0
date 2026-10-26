-- ============================================================================
-- Corrections to 2026_lions_season_setup.sql -- round 2
-- ============================================================================
-- Not a schema migration. Paste into the Supabase SQL Editor yourself --
-- no tool in this environment can execute SQL against the live database.
--
-- Only 2 of the 3 requested items are here:
--   1. Christian Cris -> Christian Ramos (name fix, no conflicts).
--   2. Alex Cardenas's missing Game 2 at-bat (he was a real Game 2
--      starter, slot 5, with no at-bat on record -- this just fills
--      that gap). game_time corrected to '6:30 PM' (stored as text,
--      not '18:30:00') and confirmed_at added (missing from the
--      original request -- without it this row is an unconfirmed
--      draft, invisible to every stats query in the app).
--
-- SKIPPED -- Roberto Cruz and Christian Ramos's new at-bat, on hold:
--   Neither was in Game 2's starting lineup. The requested
--   batting_order_position values (9, 10) are Enrique Rendon's and
--   Pedro Torres's slots, and both already have a confirmed at-bat at
--   inning 2 in those exact slots (Enrique: walk, scored; Pedro:
--   walk) -- inserting these two there with no substitution on record
--   would mean two different players credited for the same lineup
--   spot at the same moment. Separately, Ruben Prieto's own inning-2
--   at-bat is already a flyout (he's out) -- he can't also be a
--   baserunner scoring on a later hit that same inning. You confirmed
--   you don't remember the actual substitution timing, so nothing was
--   inserted for Roberto Cruz or this new Christian at-bat -- revisit
--   once the real sequence (who subbed in for whom, which inning) is
--   known, so it can be placed without colliding with what's already
--   on record for Enrique and Pedro.
-- ============================================================================

-- 1. Rename
UPDATE players
SET name = 'Christian Ramos'
WHERE name = 'Christian Cris' AND team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75';

-- 2. Alex Cardenas's missing Game 2 at-bat
INSERT INTO at_bats (game_id, player_id, inning, inning_half, result, hit_type, field_x, field_y, rbi, runs_scored, batting_order_position, confirmed_at)
VALUES (
  (SELECT id FROM games WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date = '2026-10-24' AND game_time = '6:30 PM'),
  (SELECT id FROM players WHERE name = 'Alex Cardenas' AND team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75'),
  2, 'bottom', 'single', 'linedrive', 85, 35, 0, 0, 5, now()
);

-- ============================================================================
-- VERIFICATION
-- ============================================================================
SELECT name FROM players WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name IN ('Christian Cris', 'Christian Ramos');

SELECT inning, result, hit_type, field_x, field_y, rbi, batting_order_position, confirmed_at
FROM at_bats
WHERE game_id = (SELECT id FROM games WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date = '2026-10-24' AND game_time = '6:30 PM')
  AND player_id = (SELECT id FROM players WHERE name = 'Alex Cardenas' AND team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75');
