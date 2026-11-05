-- Run-attribution batch: game_events gains who scored and how many runs,
-- so an ad-hoc run (wild pitch, passed ball, balk, steal, or a direct
-- "Scored" tap on the diamond -- none of which are tied to any at_bats
-- row) can still be credited to the specific player who crossed the
-- plate. Previously the only effect of one of these events was a flat
-- games.our_score/opponent_score bump with no record of who it was for;
-- computeBattingLines's own "R" stat had nowhere to read that from.
--
-- scorer_player_id is nullable and references players(id) (our own
-- roster only -- an opposing player scoring has no FK target in this
-- schema, same reasoning already applied to pitches/at_bats elsewhere,
-- so an opponent run stays attribution-less here, exactly as before).
-- runs_scored defaults to 0 (not 1) so every pre-existing row, which
-- never populated it, reads as "credits no individual run" rather than
-- silently appearing to credit one -- backward compatible with every
-- event already in the table.
alter table public.game_events add column if not exists scorer_player_id uuid references public.players(id);
alter table public.game_events add column if not exists runs_scored integer not null default 0;

-- event_type's check constraint (public.game_events_event_type_check) is
-- re-asserted on every migration that touches it, not actually
-- idempotent-per-se, but safe to re-run: dropping a constraint that
-- doesn't exist is a no-op (`if exists`), and re-adding the exact same
-- definition twice is harmless. 'runner_scored' is the new value here --
-- for a runner who scores via a generic ad-hoc "Scored" tap with no
-- more specific cause already covered by an existing type (wild_pitch,
-- passed_ball, balk, squeeze_play, stolen_base all already describe
-- their own distinct cause and keep using those).
alter table public.game_events drop constraint if exists game_events_event_type_check;
alter table public.game_events add constraint game_events_event_type_check
check (event_type in (
  'stolen_base', 'caught_stealing', 'pickoff_out', 'pickoff_attempt',
  'wild_pitch', 'passed_ball', 'balk', 'error', 'intentional_walk',
  'tag_up_violation', 'rundown_out', 'runner_passed', 'out_at_next_base',
  'squeeze_play', 'dropped_third_strike', 'late_arrival', 'substitution',
  'runner_scored'
));
