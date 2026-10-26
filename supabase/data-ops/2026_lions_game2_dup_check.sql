-- ============================================================================
-- Game 2 duplicate check -- corrected game_time format
-- ============================================================================
-- Not a schema migration. Paste into the Supabase SQL Editor yourself.
--
-- game_time is stored as text '6:30 PM' (matching every other game's
-- display format), not '18:30:00' -- the original query would have
-- matched zero rows regardless of what's actually in the table.
--
-- Expect exactly one group with count=2: Carlos De León / inning 3 / walk /
-- slot 1 -- that's his AB3 and AB4 from the original per-player data, both
-- bucketed into inning 3 by a documented approximation (Game 2's source
-- data has no real inning numbers, only "AB1/AB2/AB3/AB4" per player), not
-- a duplicate insert. If this query returns anything else, that's a real
-- finding worth a follow-up correction -- this one group on its own is not.
SELECT p.name, ab.inning, ab.result, ab.batting_order_position, COUNT(*) as count
FROM at_bats ab
JOIN players p ON p.id = ab.player_id
WHERE ab.game_id = (
  SELECT id FROM games
  WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75'
  AND game_date = '2026-10-24'
  AND game_time = '6:30 PM'
)
GROUP BY p.name, ab.inning, ab.result, ab.batting_order_position
HAVING COUNT(*) > 1
ORDER BY ab.inning, p.name;
