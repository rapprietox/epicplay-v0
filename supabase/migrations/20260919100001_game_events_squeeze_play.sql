-- Addition 1 (two-additions batch): "logged as squeeze_play in
-- game_events" per the request, despite it also saying "no database
-- changes needed" -- 'squeeze_play' isn't in the existing constraint
-- (same contradiction this file has hit before for pickoff and
-- intentional_walk), so it's added here.
alter table public.game_events drop constraint if exists game_events_event_type_check;
alter table public.game_events add constraint game_events_event_type_check
check (event_type in (
  'stolen_base', 'caught_stealing', 'pickoff_out', 'pickoff_attempt',
  'wild_pitch', 'passed_ball', 'balk', 'error', 'intentional_walk',
  'tag_up_violation', 'rundown_out', 'runner_passed', 'out_at_next_base',
  'squeeze_play'
));
