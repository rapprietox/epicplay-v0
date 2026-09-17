-- Fixes 2 and 4: pickoff attempts and tag-up (left-base-early) violations
-- get their own game_events rows, distinct from the existing wild_pitch/
-- passed_ball/balk/error set. Note: the request that asked for this
-- assumed pickoff already had a game_events type -- it didn't (only a
-- UI-only "Picked Off" runner quick-action existed, which never wrote to
-- game_events; see CLAUDE.md). Widening the existing check constraint
-- rather than a new column/table, same shape as every other event type.
alter table public.game_events drop constraint if exists game_events_event_type_check;
alter table public.game_events add constraint game_events_event_type_check
  check (event_type in ('wild_pitch', 'passed_ball', 'balk', 'error', 'pickoff_out', 'pickoff_attempt', 'tag_up_violation'));
