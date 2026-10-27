-- ============================================================================
-- Game 1 pitching: Pedro Torres (innings 1-5) and Jose Acosta (innings 6-8)
-- ============================================================================
-- Not a schema migration. Paste into the Supabase SQL Editor yourself --
-- no tool in this environment executes SQL against the live database.
--
-- Confirmed before writing any of this: this schema has no separate
-- pitching-stats table. computePitchingLines (src/lib/stats.ts) derives
-- everything from at_bats rows where mode='pitching' and pitcher_id is
-- set -- IP from counting is_out=true rows /3, H/BB/K from `result`, runs
-- allowed from summing runs_scored. So "insert opponent at_bats in
-- pitching mode" is exactly the right mechanism, not a workaround.
--
-- RESULTING STAT LINES vs. the targets given -- read before running:
--
--   Pedro Torres: 5.0 IP, 6 H, 0 R, 0 ER, 1 BB, 2 K
--     (target was 5.0 IP, 5 H, 3 R, 3 ER, 1 BB, 2 K)
--   - IP, BB, K all match exactly -- his 5 innings are each a clean 3-out
--     frame (15 outs total), confirmed by the batter sequence itself.
--   - H is 6, not 5: inning 2's three singles + inning 3's double and
--     single + inning 5's single = 6, and nothing in the inning-by-inning
--     detail suggests dropping one. Entered as given (6), not force-fit
--     to 5.
--   - R/ER are 0, not 3: not one of Pedro's 23 batters-faced entries
--     mentions a run scoring, across all 5 innings. Rather than guess
--     which hit (if any) drove a run in, no runs_scored was set on any
--     of his rows. If you can say which specific at-bat(s) let a run
--     score, this is a one-line UPDATE away (see the bottom of this
--     file) -- recomputing this honestly needs that detail, not a guess.
--
--   Jose Acosta: 1.2 IP, 0 H, 1 R, 1 ER, 0 BB, 2 K
--     (target was 3.0 IP, 1 H, 3 R, 3 ER, 0 BB, 2 K)
--   - BB and K both match exactly.
--   - Inning 6 ("unknown details -- 1 run scored") is skipped entirely --
--     not inserted as 3 generic placeholder outs, since you told me the
--     real sequence isn't known. This is almost certainly the entire
--     shortfall: inning 6 alone would plausibly account for the missing
--     ~1.1 IP, the missing hit, and most of the missing runs. Once the
--     real inning-6 sequence is known, add it the same way innings 7-8
--     are added below and the totals should land close to the target on
--     their own.
--   - The inning-8 passed-ball run is folded onto the first of the two
--     strikeouts that follow it (same convention used throughout this
--     thread for a run that scores between at-bats, not off one): there's
--     no at_bats row for the passed ball itself, only a game_events
--     record, and computePitchingLines only ever sums runs_scored off
--     at_bats rows -- a free-standing game_event is invisible to it.
--
-- Mechanical note: "out at 2nd" (Pedro, inning 5) isn't a result value in
-- this schema -- it's logged as 'fc' (fielder's choice) with is_out=true,
-- which is what actually produces the 3rd out of that inning and is what
-- keeps Pedro's IP at a clean 5.0.
--
-- player_id is null throughout (opponent batters aren't tracked in this
-- schema, per its own existing design -- see CLAUDE.md's note on
-- mode='pitching' at-bats). batting_order_position, field_x/field_y are
-- also null -- no batting order or spray data exists for Bananas batters.
-- ============================================================================

INSERT INTO at_bats (game_id, pitcher_id, inning, inning_half, mode, result, hit_type, rbi, runs_scored, is_out, confirmed_at)
VALUES
-- Pedro Torres, inning 1: FO, FO, K
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Pedro Torres'), 1, 'bottom', 'pitching', 'flyout', 'flyball', 0, 0, true, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Pedro Torres'), 1, 'bottom', 'pitching', 'flyout', 'flyball', 0, 0, true, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Pedro Torres'), 1, 'bottom', 'pitching', 'strikeout', NULL, 0, 0, true, now()),
-- Pedro Torres, inning 2: GO, GO, single, single, single, GO
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Pedro Torres'), 2, 'bottom', 'pitching', 'groundout', 'groundball', 0, 0, true, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Pedro Torres'), 2, 'bottom', 'pitching', 'groundout', 'groundball', 0, 0, true, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Pedro Torres'), 2, 'bottom', 'pitching', 'single', NULL, 0, 0, false, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Pedro Torres'), 2, 'bottom', 'pitching', 'single', NULL, 0, 0, false, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Pedro Torres'), 2, 'bottom', 'pitching', 'single', NULL, 0, 0, false, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Pedro Torres'), 2, 'bottom', 'pitching', 'groundout', 'groundball', 0, 0, true, now()),
-- Pedro Torres, inning 3: GO, BB, FO, double, single, GO
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Pedro Torres'), 3, 'bottom', 'pitching', 'groundout', 'groundball', 0, 0, true, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Pedro Torres'), 3, 'bottom', 'pitching', 'walk', NULL, 0, 0, false, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Pedro Torres'), 3, 'bottom', 'pitching', 'flyout', 'flyball', 0, 0, true, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Pedro Torres'), 3, 'bottom', 'pitching', 'double', NULL, 0, 0, false, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Pedro Torres'), 3, 'bottom', 'pitching', 'single', NULL, 0, 0, false, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Pedro Torres'), 3, 'bottom', 'pitching', 'groundout', 'groundball', 0, 0, true, now()),
-- Pedro Torres, inning 4: GO, GO, GO
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Pedro Torres'), 4, 'bottom', 'pitching', 'groundout', 'groundball', 0, 0, true, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Pedro Torres'), 4, 'bottom', 'pitching', 'groundout', 'groundball', 0, 0, true, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Pedro Torres'), 4, 'bottom', 'pitching', 'groundout', 'groundball', 0, 0, true, now()),
-- Pedro Torres, inning 5: K, FO, error, single, out at 2nd (-> fc, is_out=true)
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Pedro Torres'), 5, 'bottom', 'pitching', 'strikeout', NULL, 0, 0, true, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Pedro Torres'), 5, 'bottom', 'pitching', 'flyout', 'flyball', 0, 0, true, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Pedro Torres'), 5, 'bottom', 'pitching', 'error', NULL, 0, 0, false, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Pedro Torres'), 5, 'bottom', 'pitching', 'single', NULL, 0, 0, false, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Pedro Torres'), 5, 'bottom', 'pitching', 'fc', NULL, 0, 0, true, now()),
-- Jose Acosta, inning 6 skipped entirely -- "unknown details" per the request, not fabricated
-- Jose Acosta, inning 7: GO, GO, GO
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Jose Acosta'), 7, 'bottom', 'pitching', 'groundout', 'groundball', 0, 0, true, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Jose Acosta'), 7, 'bottom', 'pitching', 'groundout', 'groundball', 0, 0, true, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Jose Acosta'), 7, 'bottom', 'pitching', 'groundout', 'groundball', 0, 0, true, now()),
-- Jose Acosta, inning 8: runner placed on 2nd (extra-inning rule -- see
-- game_events below), wild pitch, passed ball (run scores, folded onto
-- the next at-bat below since there's no row for the passed ball itself), K, K
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Jose Acosta'), 8, 'bottom', 'pitching', 'strikeout', NULL, 0, 1, true, now()),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Jose Acosta'), 8, 'bottom', 'pitching', 'strikeout', NULL, 0, 0, true, now());

-- Game events, inning 8 (wild pitch attributed to Jose as pitcher, passed
-- ball to Francisco Perez as our starting/only catcher of record this game)
INSERT INTO game_events (game_id, inning, inning_half, event_type, player_id, note)
VALUES
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), 8, 'bottom', 'wild_pitch', (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Jose Acosta'), 'Bananas extra-inning placed runner (started on 2nd) advances'),
((SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM'), 8, 'bottom', 'passed_ball', (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Francisco Perez'), 'Bananas runner scores from the extra-inning placed position');

-- ============================================================================
-- If you can later identify which specific Pedro Torres at-bat(s) allowed
-- a run (3 total needed), update that row directly, e.g.:
--   UPDATE at_bats SET runs_scored = 1
--   WHERE game_id = (SELECT id FROM games WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND game_date='2026-10-24' AND game_time='3:30 PM')
--     AND pitcher_id = (SELECT id FROM players WHERE team_id='63111c5c-4af6-40af-91ad-671ff3ae8d75' AND name='Pedro Torres')
--     AND inning = <inning> AND result = '<result>';
--
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
