-- Fix 4: Intentional Walk gets its own at_bats.result and game_events
-- type, distinct from a regular 'walk'. Note: the request framing said
-- "no database changes needed" but also explicitly asked for
-- "at-bat result logged as 'intentional_walk' in at_bats" -- that value
-- didn't exist in either check constraint, so this migration is required
-- despite the framing (same situation as the earlier pickoff/tag-up fix).
alter table public.at_bats drop constraint if exists at_bats_result_check;
alter table public.at_bats add constraint at_bats_result_check
  check (
    result is null or result in (
      'single', 'double', 'triple', 'hr', 'flyout', 'groundout',
      'lineout', 'strikeout', 'walk', 'hbp', 'error', 'fc', 'double_play',
      'intentional_walk'
    )
  );

alter table public.game_events drop constraint if exists game_events_event_type_check;
alter table public.game_events add constraint game_events_event_type_check
  check (event_type in ('wild_pitch', 'passed_ball', 'balk', 'error', 'pickoff_out', 'pickoff_attempt', 'tag_up_violation', 'intentional_walk'));
