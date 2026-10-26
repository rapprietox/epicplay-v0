-- ============================================================================
-- Corrections to 2026_lions_season_setup.sql -- round 4
-- Full Game 2 lineup/slot reconciliation
-- ============================================================================
-- Not a schema migration. Paste into the Supabase SQL Editor yourself --
-- no tool in this environment can execute SQL against the live database.
--
-- Notes on what changed vs. the request as given:
--   - game_time corrected to '6:30 PM' (stored as text), not '18:30:00'.
--   - The requested `UPDATE games SET our_score=18, opponent_score=8` is
--     skipped: it would set both columns to the exact values already
--     stored (a pure no-op), and `games` has no "innings played" column
--     to correct in the first place -- the scorebook already derives
--     inning count from the max `inning` value across at_bats, so this
--     will reflect 5 innings on its own once Bryan/Roberto/Christian's
--     at-bats (inning 4-5) are entered later.
--   - Of the 13 players listed under "fix batting_order_position," only
--     Pedro (10 -> 5) and Aíd (7 -> 10) actually have existing at_bats
--     rows that need updating. Carlos/Francisco/Jose/Mike/Ruben/Enrique/
--     Alex were already correct. Bryan, Marcos, Roberto, and Christian
--     have no at_bats rows in this game yet (Bryan's are explicitly
--     pending; Roberto/Christian never had any given) -- nothing to
--     update for any of them.
--   - Alex Cardenas's one existing at-bat was logged at inning 2, but he
--     only enters the game in inning 4 as Pedro's substitute -- an
--     at-bat before his own substitution-in point is a direct
--     contradiction, so its inning is corrected to 4 (its slot, 5, was
--     already right).
--   - No `lineup` row is added for Alex, Roberto, or Christian --
--     substitutes don't get their own lineup row in this schema, only
--     starters do (matching how Game 1's real subs, Marcos and Ruben,
--     were handled: substitutions is the only record of them entering).
--   - Substitution inning_half is 'top': Lions are the HOME team in this
--     game, so their own defense (and defensive substitutions) are on
--     the field during the top half.
-- ============================================================================

-- 1. Fix the lineup table: delete the old (wrong) Game 2 lineup, reinsert
--    with the correct slots/positions.
DELETE FROM lineup
WHERE game_id = (SELECT id FROM games WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date = '2026-10-24' AND game_time = '6:30 PM');

INSERT INTO lineup (game_id, player_id, batting_order, position, status)
SELECT
  (SELECT id FROM games WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date = '2026-10-24' AND game_time = '6:30 PM'),
  p.id, v.batting_order, v.position, 'starting'
FROM (VALUES
  (1, 'Carlos De León', 'SS'),
  (2, 'Francisco Perez', 'C'),
  (3, 'Jose Acosta', '3B'),
  (4, 'Mike Casals', 'CF'),
  (5, 'Pedro Torres', 'P'),
  (6, 'Ruben Prieto', 'LF'),
  (7, 'Bryan Bryan', 'RF'),
  (8, 'Marcos Fuenmayor', '1B'),
  (9, 'Enrique Rendon', 'EH'),
  (10, 'Aíd Martínez', '2B')
) AS v(batting_order, name, position)
JOIN players p ON p.team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND p.name = v.name;

-- 2. Fix existing at_bats.batting_order_position (only Pedro and Aíd
--    actually need to move).
UPDATE at_bats
SET batting_order_position = 5
WHERE game_id = (SELECT id FROM games WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date = '2026-10-24' AND game_time = '6:30 PM')
  AND player_id = (SELECT id FROM players WHERE name = 'Pedro Torres' AND team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75');

UPDATE at_bats
SET batting_order_position = 10
WHERE game_id = (SELECT id FROM games WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date = '2026-10-24' AND game_time = '6:30 PM')
  AND player_id = (SELECT id FROM players WHERE name = 'Aíd Martínez' AND team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75');

-- Alex Cardenas: slot already correct (5); move his at-bat's inning from
-- 2 to 4 so it doesn't predate his own substitution.
UPDATE at_bats
SET inning = 4
WHERE game_id = (SELECT id FROM games WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date = '2026-10-24' AND game_time = '6:30 PM')
  AND player_id = (SELECT id FROM players WHERE name = 'Alex Cardenas' AND team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75');

-- 3. Substitutions, inning 4
INSERT INTO substitutions (game_id, player_out_id, player_in_id, inning, inning_half, reason)
VALUES
  ((SELECT id FROM games WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date = '2026-10-24' AND game_time = '6:30 PM'),
   (SELECT id FROM players WHERE name = 'Pedro Torres' AND team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75'),
   (SELECT id FROM players WHERE name = 'Alex Cardenas' AND team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75'),
   4, 'top', 'tactical'),
  ((SELECT id FROM games WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date = '2026-10-24' AND game_time = '6:30 PM'),
   (SELECT id FROM players WHERE name = 'Bryan Bryan' AND team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75'),
   (SELECT id FROM players WHERE name = 'Roberto Cruz' AND team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75'),
   4, 'top', 'tactical'),
  ((SELECT id FROM games WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date = '2026-10-24' AND game_time = '6:30 PM'),
   (SELECT id FROM players WHERE name = 'Aíd Martínez' AND team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75'),
   (SELECT id FROM players WHERE name = 'Christian Ramos' AND team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75'),
   4, 'top', 'tactical');

-- ============================================================================
-- VERIFICATION
-- ============================================================================
SELECT l.batting_order, p.name, l.position
FROM lineup l JOIN players p ON p.id = l.player_id
WHERE l.game_id = (SELECT id FROM games WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date = '2026-10-24' AND game_time = '6:30 PM')
ORDER BY l.batting_order;

SELECT p.name, ab.inning, ab.batting_order_position, ab.result
FROM at_bats ab JOIN players p ON p.id = ab.player_id
WHERE ab.game_id = (SELECT id FROM games WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date = '2026-10-24' AND game_time = '6:30 PM')
ORDER BY ab.batting_order_position, ab.inning;

SELECT po.name AS out_player, pi.name AS in_player, s.inning, s.reason
FROM substitutions s
JOIN players po ON po.id = s.player_out_id
JOIN players pi ON pi.id = s.player_in_id
WHERE s.game_id = (SELECT id FROM games WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date = '2026-10-24' AND game_time = '6:30 PM');
