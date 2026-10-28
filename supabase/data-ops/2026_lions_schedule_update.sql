-- ============================================================================
-- Updated 2026 Lions schedule (team_id 63111c5c-4af6-40af-91ad-671ff3ae8d75)
-- ============================================================================
-- NOT a schema migration -- do not add this file to supabase/manual_apply.sql
-- or supabase/migrations/. It's a one-time DATA operation (INSERT only --
-- the DELETE of future unplayed games was already run separately, per your
-- message). Paste into the Supabase SQL Editor and run as one script.
--
-- ============================================================================
-- VERIFIED AGAINST THE LIVE DATABASE BEFORE WRITING THIS (read-only query,
-- no writes) -- confirmed via a one-off script, not guessed:
-- ============================================================================
--   - season_id for '2026 DLL Season': b632a96c-a1bf-4223-8e22-f72b52f3fdb2
--   - opponents already exist for this team -- Bananas, Piranhas, Camels,
--     and Foxes are all already rows in `opponents` (Foxes in particular --
--     confirmed present, so nothing needs creating here):
--       Bananas  3a9d5624-c128-4345-b1b2-54ea37f72768
--       Piranhas f9a12968-be12-4a7e-af17-3d635c672e64
--       Camels   7ec42eb6-e8fe-4ba6-a370-f629d2548814
--       Foxes    03dfd19b-7697-4692-9266-2f585412709b
--     The INSERT below still looks these up by name via subquery (matching
--     this repo's existing data-ops convention) rather than hardcoding the
--     ids above, so it stays correct even if an id were ever to change.
--   - the prior "delete all future unplayed games" already ran: only the
--     2 completed games (Bananas 10/24 3:30pm, Piranhas 10/24 6:30pm) exist
--     for this team right now. The 8 rows below are added on top of those,
--     not a replacement for them.
--
-- ============================================================================
-- ONE CORRECTION TO YOUR REQUEST -- READ BEFORE RUNNING
-- ============================================================================
-- games.status has no 'scheduled' value. The real check constraint (see
-- supabase/migrations/20260907130004_games_additions.sql) only allows
-- 'setup' | 'active' | 'completed' | 'cancelled' -- 'scheduled' would be
-- REJECTED outright. 'setup' is this schema's actual "not yet played" state
-- (what every future game already uses, including the 9 that were just
-- deleted) -- used below instead of the literal 'scheduled' you gave.
--
-- The league label (DLL/BU) from your Location column isn't a real
-- game_type value either (enum: friendly/preseason/season/playoff/
-- tournament/championship) -- same as the original season-setup script,
-- game_type is 'season' for all 8 and the league is kept in `notes`.
-- ============================================================================

INSERT INTO games (team_id, opponent_id, opponent_name, season_id, game_date, game_time, game_type, home_away, status, our_score, opponent_score, logging_mode, notes)
VALUES
-- Oct 31, 3:30 PM -- Lions (away) @ Foxes -- DLL
('63111c5c-4af6-40af-91ad-671ff3ae8d75',
  (SELECT id FROM opponents WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name = 'Foxes'),
  'Foxes',
  (SELECT id FROM seasons WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name = '2026 DLL Season'),
  '2026-10-31', '3:30 PM', 'season', 'away', 'setup', 0, 0, 'full', 'League: DLL'),
-- Nov 7, 12:30 PM -- Lions (away) @ Camels -- BU
('63111c5c-4af6-40af-91ad-671ff3ae8d75',
  (SELECT id FROM opponents WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name = 'Camels'),
  'Camels',
  (SELECT id FROM seasons WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name = '2026 DLL Season'),
  '2026-11-07', '12:30 PM', 'season', 'away', 'setup', 0, 0, 'full', 'League: BU'),
-- Nov 14, 3:30 PM -- Piranhas (away) @ Lions -- BU
('63111c5c-4af6-40af-91ad-671ff3ae8d75',
  (SELECT id FROM opponents WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name = 'Piranhas'),
  'Piranhas',
  (SELECT id FROM seasons WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name = '2026 DLL Season'),
  '2026-11-14', '3:30 PM', 'season', 'home', 'setup', 0, 0, 'full', 'League: BU'),
-- Nov 21, 6:30 PM -- Lions (away) @ Foxes -- BU
('63111c5c-4af6-40af-91ad-671ff3ae8d75',
  (SELECT id FROM opponents WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name = 'Foxes'),
  'Foxes',
  (SELECT id FROM seasons WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name = '2026 DLL Season'),
  '2026-11-21', '6:30 PM', 'season', 'away', 'setup', 0, 0, 'full', 'League: BU'),
-- Nov 28, 3:30 PM -- Bananas (away) @ Lions -- BU
('63111c5c-4af6-40af-91ad-671ff3ae8d75',
  (SELECT id FROM opponents WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name = 'Bananas'),
  'Bananas',
  (SELECT id FROM seasons WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name = '2026 DLL Season'),
  '2026-11-28', '3:30 PM', 'season', 'home', 'setup', 0, 0, 'full', 'League: BU'),
-- Dec 5, 6:30 PM -- Camels (away) @ Lions -- BU
('63111c5c-4af6-40af-91ad-671ff3ae8d75',
  (SELECT id FROM opponents WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name = 'Camels'),
  'Camels',
  (SELECT id FROM seasons WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name = '2026 DLL Season'),
  '2026-12-05', '6:30 PM', 'season', 'home', 'setup', 0, 0, 'full', 'League: BU'),
-- Dec 12, 12:30 PM -- Foxes (away) @ Lions -- DLL
('63111c5c-4af6-40af-91ad-671ff3ae8d75',
  (SELECT id FROM opponents WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name = 'Foxes'),
  'Foxes',
  (SELECT id FROM seasons WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name = '2026 DLL Season'),
  '2026-12-12', '12:30 PM', 'season', 'home', 'setup', 0, 0, 'full', 'League: DLL'),
-- Dec 12, 3:30 PM -- Lions (away) @ Foxes -- DLL (same day, 2nd game, reversed home/away)
('63111c5c-4af6-40af-91ad-671ff3ae8d75',
  (SELECT id FROM opponents WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name = 'Foxes'),
  'Foxes',
  (SELECT id FROM seasons WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name = '2026 DLL Season'),
  '2026-12-12', '3:30 PM', 'season', 'away', 'setup', 0, 0, 'full', 'League: DLL');


-- ============================================================================
-- VERIFICATION -- run after the insert above
-- ============================================================================
-- Expect 10 total (2 already-completed + 8 new), 8 of them 'setup'.
SELECT count(*) AS total_games_for_team FROM games WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75';

SELECT g.game_date, g.game_time, o.name AS opponent, g.home_away, g.status, g.logging_mode, g.notes
FROM games g
LEFT JOIN opponents o ON o.id = g.opponent_id
WHERE g.team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75'
ORDER BY g.game_date, g.game_time;
