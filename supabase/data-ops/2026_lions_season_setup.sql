-- ============================================================================
-- 2026 DLL Season setup for the Lions (team_id 63111c5c-4af6-40af-91ad-671ff3ae8d75)
-- ============================================================================
-- NOT a schema migration -- do not add this file to supabase/manual_apply.sql
-- or supabase/migrations/. It's a one-time DATA operation (DELETE/INSERT),
-- written out as a reviewable script because this session has no tool that
-- can execute SQL directly against the live database -- paste this into the
-- Supabase SQL Editor yourself after reading the judgment-call notes below.
--
-- Run it as ONE script / ONE transaction (wrap in BEGIN; ... COMMIT; if you
-- want an easy single rollback point) -- later sections look up ids from
-- earlier sections by name/date, assuming they ran moments before in the
-- same session.
--
-- ============================================================================
-- JUDGMENT CALLS AND DATA PROBLEMS FOUND -- READ BEFORE RUNNING
-- ============================================================================
-- Schema corrections (your original SQL used values that don't exist in
-- this schema and would have been REJECTED outright by a check constraint):
--   1. at_bats.result has no 'sacrifice_fly' or 'infield_hit' value. Per
--      this codebase's own established convention (see CLAUDE.md), a
--      sac fly is just 'flyout' (hit_type 'flyball') and an infield hit is
--      just 'single' (hit_type 'groundball'). Applied throughout below.
--   2. games.game_type has no 'BU'/'DLL' value (real enum: friendly/
--      preseason/season/playoff/tournament/championship). Per your choice,
--      every game below is 'season'; the BU/DLL label is preserved in each
--      game's `notes` column instead ("League: BU" / "League: DLL") so it
--      isn't lost outright.
--   3. jersey_number is a plain int with no leading-zero support --
--      Osmani ('0') and Oswaldo ('00') both become jersey_number = 0, per
--      your explicit choice. They WILL look identical ("#0") everywhere in
--      the app until one of them gets a real distinct number.
--   4. game_events has no 'catcher_interference' type (real enum: stolen_base/
--      caught_stealing/pickoff_out/pickoff_attempt/wild_pitch/passed_ball/
--      balk/error/intentional_walk/tag_up_violation/rundown_out/
--      runner_passed/out_at_next_base/squeeze_play/dropped_third_strike/
--      late_arrival/substitution). Game 1's "catcher interference noted" on
--      Mike's inning-5 infield hit has nowhere to go in this schema and is
--      DROPPED -- the at-bat itself (now a 'single') is still logged.
--
-- How runs/RBI were mapped (confirmed by reading src/lib/stats.ts +
-- src/lib/operator/reducer.ts, not guessed): at_bats.runs_scored is summed
-- per `player_id` by computeBattingLines -- i.e. it credits the BATTER OF
-- THAT ROW, not whoever physically touched home plate. This app's real
-- operator screen already works this way (a runner scoring on another
-- batter's hit gets folded into THAT BATTER's runs_scored, per
-- CONFIRM_LOCAL's `runsScored = state.scoredThisAtBat.length`). So: every
-- "rbi: N (X scored)" in your narrative maps rbi AND runs_scored onto that
-- SAME row (the driving batter's row) -- this already matches almost all
-- of your own data as given. Where a runner scores with NO at-bat driving
-- them in (a straight steal, a passed ball during an out), the run is
-- folded onto whichever at-bat was in progress at the time (matching the
-- real app's adjustScore/scoredThisAtBat mechanism), never onto the
-- scoring runner's own, already-concluded row.
--
-- GAME 1 -- specific contradictions found in the narrative, and how they're
-- resolved below (flagged, not silently guessed):
--   A. "Inning 5: Marcos Fuenmayor replaces Jose Acosta at 3B" vs. Jose
--      batting again in inning 7 ("9. Jose -- walk, then SB 2nd"). Resolved
--      as: the substitution is DEFENSE-ONLY (Marcos takes over 3B in the
--      field); Jose stays in the batting order the whole game, exactly as
--      the at-bat log shows. The `substitutions` row is still logged for
--      the record, it just isn't treated as removing Jose from the lineup.
--   B. "Aít -- result: infield_hit" in inning 8 -- no player named "Aít" is
--      anywhere in Game 1's lineup or subs (Aíd Martínez, the real player
--      with a similar name, is only in Game 2's lineup and was never
--      substituted into Game 1). Batting order continuity says slot 6
--      (Pedro Torres) was due up at that point in the inning. Resolved as:
--      this hit is credited to PEDRO TORRES. If this is wrong, the fix is
--      a one-line UPDATE after this script runs (see the bottom of the
--      Game 1 at_bats section).
--   C. "Inning 6 ... Jose scored ... on Francisco's hit -- log Francisco
--      RBI" -- but inning 6's own batter list is only Pedro/Ruben/Bryan
--      (no Francisco at-bat that inning), and inning 7 explicitly says
--      "Jose stranded." There is no hit anywhere in the literal data that
--      can mechanically produce this run. Since your final reconciliation
--      insists on 5 total runs and the 5-5 final score is given directly
--      (not derived), I preserved the RUN COUNT by crediting it onto
--      Pedro's inning-6 walk row (runs_scored=1) rather than inventing a
--      Francisco at-bat that doesn't exist in your batting order. Francisco
--      does NOT get the literal RBI instruction applied, since no
--      qualifying Francisco at-bat exists this inning -- flagged here
--      rather than silently fabricated.
--
-- GAME 2 -- the per-player "AB1/AB2/AB3..." format doesn't say which
-- real inning each at-bat happened in (unlike Game 1's inning-by-inning
-- format), and the game is only 3 innings. Resolved as: AB1->inning 1,
-- AB2->inning 2, AB3 and AB4->inning 3 (a long 3rd inning is very plausible
-- in an 18-8 run-rule game where the lineup turns over more than once).
-- This has NO effect on any player's season/career totals (computeBattingLines
-- sums across the whole game regardless of inning) -- it only affects which
-- inning a given at-bat displays under, if that's ever surfaced.
--   - Alex Cardenas and Marcos Fuenmayor are in Game 2's starting lineup but
--     have no at-bats in your data at all. No at_bats rows are created for
--     them (no data to enter) -- they still get `lineup` rows as starters.
--   - Several rows have an rbi that isn't tied to a named scoring runner
--     (e.g. Francisco's AB4 groundout "rbi:1", Mike's AB3 HBP "rbi:1", Jose's
--     AB2 single "rbi:1"). The RBI is recorded faithfully on that batter's
--     row; the individual runner who scored isn't named anywhere in your
--     data, so no OTHER player's runs_scored is incremented for these 3
--     runs. The team score (our_score=18, set directly below) is correct
--     regardless; only the sum of individual players' own "R" stat will
--     under-count by these 3 (plus a 4th/5th from rounding -- see the two
--     cross-check mismatches immediately below) relative to 18. This is an
--     inherent gap of the per-player-sequence format, not a bug in the SQL.
--   - Carlos's own itemized steals (AB1: SB2nd+SB3rd, AB2: SB2nd, AB3:
--     SB2nd, AB4: SB3rd) total 5, but your team-totals cross-check says
--     "Carlos had 4". Entered as 5 (the itemized detail is more specific
--     than the summary total) -- flagged, not silently reconciled down.
--   - Itemized hits total 9 (1+1+1+2+2+2 across players), vs. the
--     cross-check's "Hits: 8". Entered as itemized (9) for the same reason.
--
-- Expected row counts once this whole script has run (verify with the
-- COUNT queries at the very bottom, since nothing here executes itself):
--   players: 20 | games: 11 | at_bats: 58 (33 Game 1 + 25 Game 2) |
--   stolen_bases: 9 (4 Game 1 + 5 Game 2) | substitutions: 2 | game_events: 2
-- ============================================================================


-- ============================================================================
-- STEP 1 -- clean existing games/seasons/opponents for this team
-- ============================================================================
-- Verified safe in an earlier conversation this session: games -> lineup/
-- at_bats/game_state/stolen_bases/substitutions/game_events all cascade on
-- delete, and opponents -> opponent_players cascades too. teams, players,
-- profiles, field_calibration, promo_codes, and the /public batter images
-- are untouched by any of this.
DELETE FROM games WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75';
DELETE FROM seasons WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75';
DELETE FROM opponents WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75';


-- ============================================================================
-- STEP 2 -- real 20-player roster
-- ============================================================================
DELETE FROM players WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75';

INSERT INTO players (team_id, name, jersey_number, position, batting_hand) VALUES
('63111c5c-4af6-40af-91ad-671ff3ae8d75', 'Carlos De León', 16, 'SS', 'R'),
('63111c5c-4af6-40af-91ad-671ff3ae8d75', 'Francisco Perez', 23, 'C', 'R'),
('63111c5c-4af6-40af-91ad-671ff3ae8d75', 'Alex Cardenas', 44, '1B', 'R'),
('63111c5c-4af6-40af-91ad-671ff3ae8d75', 'Mike Casals', 13, 'CF', 'R'),
('63111c5c-4af6-40af-91ad-671ff3ae8d75', 'Cesar Godoy', 19, 'LF', 'R'),
('63111c5c-4af6-40af-91ad-671ff3ae8d75', 'Pedro Torres', 14, 'P', 'R'),
('63111c5c-4af6-40af-91ad-671ff3ae8d75', 'Christian Cris', 2, '2B', 'R'),
('63111c5c-4af6-40af-91ad-671ff3ae8d75', 'Bryan Bryan', 69, 'RF', 'R'),
('63111c5c-4af6-40af-91ad-671ff3ae8d75', 'Jose Acosta', 55, '3B', 'R'),
('63111c5c-4af6-40af-91ad-671ff3ae8d75', 'Ruben Prieto', 43, '2B', 'R'),
('63111c5c-4af6-40af-91ad-671ff3ae8d75', 'Marcos Fuenmayor', 24, 'CF', 'R'),
('63111c5c-4af6-40af-91ad-671ff3ae8d75', 'Paolo Rossil', 45, 'OF', 'R'),
('63111c5c-4af6-40af-91ad-671ff3ae8d75', 'Enrique Rendon', 7, 'IF', 'R'),
('63111c5c-4af6-40af-91ad-671ff3ae8d75', 'Max Fang', 9, 'OF', 'R'),
('63111c5c-4af6-40af-91ad-671ff3ae8d75', 'Roberto Cruz', 79, 'OF', 'R'),
('63111c5c-4af6-40af-91ad-671ff3ae8d75', 'Albie Robinson', 6, 'OF', 'R'),
('63111c5c-4af6-40af-91ad-671ff3ae8d75', 'Eduardo Eduardo', 86, 'IF', 'R'),
('63111c5c-4af6-40af-91ad-671ff3ae8d75', 'Aíd Martínez', 34, 'IF', 'R'),
('63111c5c-4af6-40af-91ad-671ff3ae8d75', 'Osmani', 0, 'IF', 'R'),
('63111c5c-4af6-40af-91ad-671ff3ae8d75', 'Oswaldo', 0, 'IF', 'R');


-- ============================================================================
-- STEP 3 -- 2026 season, 4 opponents, 11-game Lions schedule
-- ============================================================================
INSERT INTO seasons (team_id, name, year, start_date, end_date, max_innings, time_limit_minutes, new_inning_threshold_minutes)
VALUES ('63111c5c-4af6-40af-91ad-671ff3ae8d75', '2026 DLL Season', 2026, '2026-10-24', '2026-12-19', 7, 150, 10);

INSERT INTO opponents (team_id, name) VALUES
('63111c5c-4af6-40af-91ad-671ff3ae8d75', 'Bananas'),
('63111c5c-4af6-40af-91ad-671ff3ae8d75', 'Piranhas'),
('63111c5c-4af6-40af-91ad-671ff3ae8d75', 'Phoenix'),
('63111c5c-4af6-40af-91ad-671ff3ae8d75', 'Camels');

-- game_type = 'season' for all 11 (per your choice -- BU/DLL isn't a real
-- game_type value); the league label is kept in `notes` instead.
INSERT INTO games (team_id, opponent_id, opponent_name, season_id, game_date, game_time, game_type, home_away, status, our_score, opponent_score, logging_mode, notes)
VALUES
-- Game 1 and Game 2 (completed, detailed in Steps 4-5 below)
('63111c5c-4af6-40af-91ad-671ff3ae8d75',
  (SELECT id FROM opponents WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name = 'Bananas'),
  'Bananas',
  (SELECT id FROM seasons WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name = '2026 DLL Season'),
  '2026-10-24', '3:30 PM', 'season', 'away', 'completed', 5, 5, 'quick', 'League: BU'),
('63111c5c-4af6-40af-91ad-671ff3ae8d75',
  (SELECT id FROM opponents WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name = 'Piranhas'),
  'Piranhas',
  (SELECT id FROM seasons WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name = '2026 DLL Season'),
  '2026-10-24', '6:30 PM', 'season', 'home', 'completed', 18, 8, 'quick', 'League: BU'),
-- Remaining 9 scheduled games -- not yet played
('63111c5c-4af6-40af-91ad-671ff3ae8d75',
  (SELECT id FROM opponents WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name = 'Phoenix'),
  'Phoenix',
  (SELECT id FROM seasons WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name = '2026 DLL Season'),
  '2026-10-31', '12:30 PM', 'season', 'away', 'setup', 0, 0, 'full', 'League: DLL'),
('63111c5c-4af6-40af-91ad-671ff3ae8d75',
  (SELECT id FROM opponents WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name = 'Phoenix'),
  'Phoenix',
  (SELECT id FROM seasons WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name = '2026 DLL Season'),
  '2026-11-07', '3:30 PM', 'season', 'home', 'setup', 0, 0, 'full', 'League: BU'),
('63111c5c-4af6-40af-91ad-671ff3ae8d75',
  (SELECT id FROM opponents WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name = 'Camels'),
  'Camels',
  (SELECT id FROM seasons WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name = '2026 DLL Season'),
  '2026-11-14', '12:30 PM', 'season', 'home', 'setup', 0, 0, 'full', 'League: DLL'),
('63111c5c-4af6-40af-91ad-671ff3ae8d75',
  (SELECT id FROM opponents WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name = 'Phoenix'),
  'Phoenix',
  (SELECT id FROM seasons WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name = '2026 DLL Season'),
  '2026-11-14', '3:30 PM', 'season', 'away', 'setup', 0, 0, 'full', 'League: DLL'),
('63111c5c-4af6-40af-91ad-671ff3ae8d75',
  (SELECT id FROM opponents WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name = 'Bananas'),
  'Bananas',
  (SELECT id FROM seasons WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name = '2026 DLL Season'),
  '2026-11-21', '12:30 PM', 'season', 'away', 'setup', 0, 0, 'full', 'League: DLL'),
('63111c5c-4af6-40af-91ad-671ff3ae8d75',
  (SELECT id FROM opponents WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name = 'Bananas'),
  'Bananas',
  (SELECT id FROM seasons WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name = '2026 DLL Season'),
  '2026-11-28', '3:30 PM', 'season', 'away', 'setup', 0, 0, 'full', 'League: BU'),
('63111c5c-4af6-40af-91ad-671ff3ae8d75',
  (SELECT id FROM opponents WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name = 'Bananas'),
  'Bananas',
  (SELECT id FROM seasons WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name = '2026 DLL Season'),
  '2026-12-05', '3:30 PM', 'season', 'away', 'setup', 0, 0, 'full', 'League: BU'),
('63111c5c-4af6-40af-91ad-671ff3ae8d75',
  (SELECT id FROM opponents WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name = 'Bananas'),
  'Bananas',
  (SELECT id FROM seasons WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name = '2026 DLL Season'),
  '2026-12-05', '6:30 PM', 'season', 'home', 'setup', 0, 0, 'full', 'League: BU'),
('63111c5c-4af6-40af-91ad-671ff3ae8d75',
  (SELECT id FROM opponents WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name = 'Phoenix'),
  'Phoenix',
  (SELECT id FROM seasons WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name = '2026 DLL Season'),
  '2026-12-12', '12:30 PM', 'season', 'home', 'setup', 0, 0, 'full', 'League: DLL');


-- ============================================================================
-- STEP 4 -- Game 1: Lions (away) vs Bananas, 2026-10-24 3:30 PM, final 5-5 (8 inn)
-- ============================================================================
-- Lions are the away team -> they bat in the TOP of every inning.

-- Starting lineup
INSERT INTO lineup (game_id, player_id, batting_order, position, status)
SELECT
  (SELECT id FROM games WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date = '2026-10-24' AND game_time = '3:30 PM'),
  p.id, v.batting_order, v.position, 'starting'
FROM (VALUES
  (1, 'Carlos De León', 'SS'),
  (2, 'Francisco Perez', 'C'),
  (3, 'Alex Cardenas', '1B'),
  (4, 'Mike Casals', 'CF'),
  (5, 'Cesar Godoy', 'LF'),
  (6, 'Pedro Torres', 'P'),
  (7, 'Christian Cris', '2B'),
  (8, 'Bryan Bryan', 'RF'),
  (9, 'Jose Acosta', '3B')
) AS v(batting_order, name, position)
JOIN players p ON p.team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND p.name = v.name;

-- Substitutions (both logged as defensive-only records -- see judgment
-- call A above: Jose keeps batting all game despite this sub)
INSERT INTO substitutions (game_id, player_out_id, player_in_id, reason, inning, inning_half)
VALUES
((SELECT id FROM games WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date = '2026-10-24' AND game_time = '3:30 PM'),
  (SELECT id FROM players WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name = 'Jose Acosta'),
  (SELECT id FROM players WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name = 'Marcos Fuenmayor'),
  'tactical', 5, 'bottom'),
((SELECT id FROM games WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date = '2026-10-24' AND game_time = '3:30 PM'),
  (SELECT id FROM players WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name = 'Christian Cris'),
  (SELECT id FROM players WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name = 'Ruben Prieto'),
  'tactical', 6, 'bottom');

-- At-bats (mode='hitting' throughout -- only Lions' own batting is logged;
-- no opponent-pitching at-bats were given, so none are inserted)
INSERT INTO at_bats (game_id, player_id, inning, inning_half, batting_order_position, mode, result, hit_type, field_x, field_y, rbi, runs_scored, is_out, confirmed_at)
VALUES
-- Inning 1
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Carlos De León'), 1, 'top', 1, 'hitting', 'error', NULL, NULL, NULL, 0, 0, false, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Francisco Perez'), 1, 'top', 2, 'hitting', 'single', NULL, 52, 45, 0, 0, false, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Alex Cardenas'), 1, 'top', 3, 'hitting', 'groundout', NULL, NULL, NULL, 1, 1, true, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Mike Casals'), 1, 'top', 4, 'hitting', 'flyout', 'flyball', 20, 25, 1, 1, true, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Cesar Godoy'), 1, 'top', 5, 'hitting', 'flyout', NULL, 50, 20, 0, 0, true, now()),
-- Inning 2
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Pedro Torres'), 2, 'top', 6, 'hitting', 'strikeout', NULL, NULL, NULL, 0, 0, true, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Christian Cris'), 2, 'top', 7, 'hitting', 'strikeout', NULL, NULL, NULL, 0, 0, true, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Bryan Bryan'), 2, 'top', 8, 'hitting', 'strikeout', NULL, NULL, NULL, 0, 0, true, now()),
-- Inning 3
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Jose Acosta'), 3, 'top', 9, 'hitting', 'single', 'linedrive', 50, 20, 0, 0, false, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Carlos De León'), 3, 'top', 1, 'hitting', 'error', NULL, NULL, NULL, 0, 0, false, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Francisco Perez'), 3, 'top', 2, 'hitting', 'single', 'linedrive', 15, 35, 1, 1, false, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Alex Cardenas'), 3, 'top', 3, 'hitting', 'groundout', NULL, NULL, NULL, 0, 0, true, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Mike Casals'), 3, 'top', 4, 'hitting', 'strikeout', NULL, NULL, NULL, 0, 0, true, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Cesar Godoy'), 3, 'top', 5, 'hitting', 'flyout', NULL, NULL, NULL, 0, 0, true, now()),
-- Inning 4
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Pedro Torres'), 4, 'top', 6, 'hitting', 'single', 'groundball', 35, 65, 0, 0, false, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Christian Cris'), 4, 'top', 7, 'hitting', 'groundout', NULL, NULL, NULL, 0, 0, true, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Bryan Bryan'), 4, 'top', 8, 'hitting', 'strikeout', NULL, NULL, NULL, 0, 0, true, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Jose Acosta'), 4, 'top', 9, 'hitting', 'walk', NULL, NULL, NULL, 0, 0, false, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Carlos De León'), 4, 'top', 1, 'hitting', 'flyout', NULL, NULL, NULL, 0, 0, true, now()),
-- Inning 5 (Jose/Marcos defensive sub happens this inning -- see note A)
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Francisco Perez'), 5, 'top', 2, 'hitting', 'strikeout', NULL, NULL, NULL, 0, 0, true, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Alex Cardenas'), 5, 'top', 3, 'hitting', 'strikeout', NULL, NULL, NULL, 0, 0, true, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Mike Casals'), 5, 'top', 4, 'hitting', 'single', 'groundball', 45, 70, 0, 0, false, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Cesar Godoy'), 5, 'top', 5, 'hitting', 'groundout', NULL, NULL, NULL, 0, 0, true, now()),
-- Inning 6 (Christian/Ruben sub takes effect; runs_scored=1 here is Jose's
-- 2nd run, per judgment call C -- NOT a literal Pedro RBI, see note above)
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Pedro Torres'), 6, 'top', 6, 'hitting', 'walk', NULL, NULL, NULL, 0, 1, false, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Ruben Prieto'), 6, 'top', 7, 'hitting', 'strikeout', NULL, NULL, NULL, 0, 0, true, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Bryan Bryan'), 6, 'top', 8, 'hitting', 'strikeout', NULL, NULL, NULL, 0, 0, true, now()),
-- Inning 7
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Jose Acosta'), 7, 'top', 9, 'hitting', 'walk', NULL, NULL, NULL, 0, 0, false, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Carlos De León'), 7, 'top', 1, 'hitting', 'strikeout', NULL, NULL, NULL, 0, 0, true, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Francisco Perez'), 7, 'top', 2, 'hitting', 'groundout', NULL, NULL, NULL, 0, 0, true, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Alex Cardenas'), 7, 'top', 3, 'hitting', 'groundout', NULL, NULL, NULL, 0, 0, true, now()),
-- Inning 8 (extras; Alex started this inning on 2nd per your note -- no
-- mechanism in this schema to record a "placed" runner with no at-bat, so
-- his run is folded onto Cesar's at-bat below, same convention as judgment
-- call C). "Aít" -> Pedro Torres per judgment call B.
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Mike Casals'), 8, 'top', 4, 'hitting', 'single', 'groundball', NULL, NULL, 0, 0, false, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Cesar Godoy'), 8, 'top', 5, 'hitting', 'strikeout', NULL, NULL, NULL, 0, 1, true, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Pedro Torres'), 8, 'top', 6, 'hitting', 'single', 'groundball', NULL, NULL, 0, 0, false, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Ruben Prieto'), 8, 'top', 7, 'hitting', 'strikeout', NULL, NULL, NULL, 0, 0, true, now());

-- Stolen bases, Game 1
INSERT INTO stolen_bases (game_id, player_id, inning) VALUES
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Carlos De León'), 1),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Francisco Perez'), 3),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Jose Acosta'), 7),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Mike Casals'), 8);

-- Game events, Game 1 (wild pitch in inning 3, passed ball in inning 8 --
-- no pitcher/catcher identity given for the opponent, so player_id is left
-- unset on both)
INSERT INTO game_events (game_id, inning, inning_half, event_type, note) VALUES
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), 3, 'top', 'wild_pitch', 'Jose Acosta advances to 3rd during Carlos De León''s at-bat'),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), 8, 'top', 'passed_ball', 'Alex Cardenas scores from 3rd (started the inning on 2nd), Mike Casals advances to 3rd');

-- If judgment call B is wrong and this hit really belongs to Aíd Martínez,
-- not Pedro Torres, run this fix after the script completes:
--   UPDATE at_bats SET player_id = (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Aíd Martínez')
--   WHERE game_id = (SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM')
--     AND inning = 8 AND batting_order_position = 6 AND result = 'single';


-- ============================================================================
-- STEP 5 -- Game 2: Lions (home) vs Piranhas, 2026-10-24 6:30 PM, final 18-8 (3 inn)
-- ============================================================================
-- Lions are the home team -> they bat in the BOTTOM of every inning.
-- Alex Cardenas and Marcos Fuenmayor are starters with no at-bat data given
-- (see note above) -- lineup rows only, no at_bats rows for either.

INSERT INTO lineup (game_id, player_id, batting_order, position, status)
SELECT
  (SELECT id FROM games WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date = '2026-10-24' AND game_time = '6:30 PM'),
  p.id, v.batting_order, v.position, 'starting'
FROM (VALUES
  (1, 'Carlos De León', 'SS'),
  (2, 'Francisco Perez', 'C'),
  (3, 'Jose Acosta', '3B'),
  (4, 'Mike Casals', 'CF'),
  (5, 'Alex Cardenas', '1B'),
  (6, 'Ruben Prieto', '2B'),
  (7, 'Aíd Martínez', 'LF'),
  (8, 'Marcos Fuenmayor', 'OF'),
  (9, 'Enrique Rendon', 'IF'),
  (10, 'Pedro Torres', 'P')
) AS v(batting_order, name, position)
JOIN players p ON p.team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND p.name = v.name;

INSERT INTO at_bats (game_id, player_id, inning, inning_half, batting_order_position, mode, result, hit_type, field_x, field_y, rbi, runs_scored, is_out, confirmed_at)
VALUES
-- Carlos De León (slot 1) -- AB1 run credited to himself (self-contained
-- walk->steal->steal->scored sequence, no other batter named as driving him in)
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='6:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Carlos De León'), 1, 'bottom', 1, 'hitting', 'walk', NULL, NULL, NULL, 0, 1, false, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='6:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Carlos De León'), 2, 'bottom', 1, 'hitting', 'single', 'groundball', 50, 55, 0, 0, false, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='6:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Carlos De León'), 3, 'bottom', 1, 'hitting', 'walk', NULL, NULL, NULL, 0, 0, false, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='6:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Carlos De León'), 3, 'bottom', 1, 'hitting', 'walk', NULL, NULL, NULL, 0, 0, false, now()),
-- Francisco Perez (slot 2)
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='6:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Francisco Perez'), 1, 'bottom', 2, 'hitting', 'flyout', 'flyball', 50, 20, 0, 0, true, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='6:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Francisco Perez'), 2, 'bottom', 2, 'hitting', 'double', NULL, 15, 30, 2, 1, false, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='6:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Francisco Perez'), 3, 'bottom', 2, 'hitting', 'walk', NULL, NULL, NULL, 0, 1, false, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='6:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Francisco Perez'), 3, 'bottom', 2, 'hitting', 'groundout', NULL, NULL, NULL, 1, 0, true, now()),
-- Jose Acosta (slot 3)
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='6:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Jose Acosta'), 1, 'bottom', 3, 'hitting', 'flyout', 'flyball', NULL, NULL, 0, 0, true, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='6:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Jose Acosta'), 2, 'bottom', 3, 'hitting', 'single', NULL, 50, 35, 1, 0, false, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='6:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Jose Acosta'), 3, 'bottom', 3, 'hitting', 'single', 'linedrive', 52, 30, 0, 0, false, now()),
-- Mike Casals (slot 4)
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='6:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Mike Casals'), 1, 'bottom', 4, 'hitting', 'triple', NULL, 50, 15, 2, 1, false, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='6:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Mike Casals'), 2, 'bottom', 4, 'hitting', 'triple', NULL, 48, 12, 2, 1, false, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='6:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Mike Casals'), 3, 'bottom', 4, 'hitting', 'hbp', NULL, NULL, NULL, 1, 0, false, now()),
-- Ruben Prieto (slot 6)
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='6:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Ruben Prieto'), 1, 'bottom', 6, 'hitting', 'triple', 'linedrive', 52, 18, 2, 1, false, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='6:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Ruben Prieto'), 2, 'bottom', 6, 'hitting', 'flyout', 'flyball', NULL, NULL, 0, 0, true, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='6:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Ruben Prieto'), 3, 'bottom', 6, 'hitting', 'ground_rule_double', NULL, 35, 12, 0, 1, false, now()),
-- Enrique Rendon (slot 9)
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='6:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Enrique Rendon'), 1, 'bottom', 9, 'hitting', 'groundout', NULL, NULL, NULL, 0, 0, true, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='6:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Enrique Rendon'), 2, 'bottom', 9, 'hitting', 'walk', NULL, NULL, NULL, 0, 1, false, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='6:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Enrique Rendon'), 3, 'bottom', 9, 'hitting', 'strikeout', NULL, NULL, NULL, 0, 0, true, now()),
-- Aíd Martínez (slot 7)
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='6:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Aíd Martínez'), 1, 'bottom', 7, 'hitting', 'walk', NULL, NULL, NULL, 0, 0, false, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='6:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Aíd Martínez'), 2, 'bottom', 7, 'hitting', 'groundout', NULL, NULL, NULL, 0, 0, true, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='6:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Aíd Martínez'), 3, 'bottom', 7, 'hitting', 'walk', NULL, NULL, NULL, 1, 1, false, now()),
-- Pedro Torres (slot 10)
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='6:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Pedro Torres'), 1, 'bottom', 10, 'hitting', 'single', NULL, NULL, NULL, 1, 1, false, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='6:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Pedro Torres'), 2, 'bottom', 10, 'hitting', 'walk', NULL, NULL, NULL, 0, 0, false, now());

-- Stolen bases, Game 2 -- all Carlos De León (itemized total is 5, not the
-- "4" in your team-totals cross-check -- see note above)
INSERT INTO stolen_bases (game_id, player_id, inning) VALUES
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='6:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Carlos De León'), 1),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='6:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Carlos De León'), 1),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='6:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Carlos De León'), 2),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='6:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Carlos De León'), 3),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='6:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Carlos De León'), 3);


-- ============================================================================
-- VERIFICATION -- run these after the inserts above to get your real counts
-- ============================================================================
SELECT count(*) AS players_for_team FROM players WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75';
SELECT count(*) AS games_for_team FROM games WHERE team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75';
SELECT g.game_date, g.game_time, count(ab.*) AS at_bats
FROM games g LEFT JOIN at_bats ab ON ab.game_id = g.id
WHERE g.team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND g.status = 'completed'
GROUP BY g.id, g.game_date, g.game_time ORDER BY g.game_date, g.game_time;
SELECT g.game_date, g.game_time, count(sb.*) AS stolen_bases
FROM games g LEFT JOIN stolen_bases sb ON sb.game_id = g.id
WHERE g.team_id = '63111c5c-4af6-40af-91ad-671ff3ae8d75' AND g.status = 'completed'
GROUP BY g.id, g.game_date, g.game_time ORDER BY g.game_date, g.game_time;
