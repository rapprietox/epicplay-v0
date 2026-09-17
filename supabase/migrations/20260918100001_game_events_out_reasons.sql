-- Fix 2: a generic runner "Out" now requires picking a reason, each
-- logged to game_events as its own type. Includes 'stolen_base' per the
-- request's exact constraint even though nothing inserts that value yet
-- (a successful steal is still recorded in the separate stolen_bases
-- table, unchanged) -- harmless to allow in the constraint regardless.
alter table public.game_events drop constraint if exists game_events_event_type_check;
alter table public.game_events add constraint game_events_event_type_check
check (event_type in (
  'stolen_base', 'caught_stealing', 'pickoff_out', 'pickoff_attempt',
  'wild_pitch', 'passed_ball', 'balk', 'error', 'intentional_walk',
  'tag_up_violation', 'rundown_out', 'runner_passed', 'out_at_next_base'
));
