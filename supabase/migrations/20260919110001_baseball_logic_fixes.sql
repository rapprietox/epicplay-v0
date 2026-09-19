-- Baseball-logic-fixes batch (Fix 2 dropped third strike, Fix 3 foul tip,
-- Fix 9 ground rule double). The request's own migration draft also
-- included 'interference' and 'obstruction' game_events values -- dropped
-- here since neither is actually written anywhere in this batch:
-- interference is explicitly out of scope (too rare for V0, per the
-- request's own exclusion list) and obstruction was a deliberate no-event
-- decision in an earlier batch (a decreed advance, nobody's fault, so
-- nothing is logged -- see SCORE_METHOD_EVENT in lib/operator/types.ts).
-- Adding unused enum values now would just be dead schema surface with
-- nothing to point at it; either can be added for real the day something
-- actually logs them.

-- Fix 2: a strikeout where the catcher drops the third strike needs its
-- own at_bats.result so a safe reach-on-K is distinguishable from a
-- normal strikeout in every stat that reads `result` (a caught third
-- strike stays a plain 'strikeout', unchanged).
alter table public.at_bats drop constraint if exists at_bats_result_check;
alter table public.at_bats add constraint at_bats_result_check
  check (
    result is null or result in (
      'single', 'double', 'triple', 'hr', 'flyout', 'groundout',
      'lineout', 'strikeout', 'walk', 'hbp', 'error', 'fc', 'double_play',
      'intentional_walk', 'dropped_third_strike_safe', 'ground_rule_double'
    )
  );

-- Fix 2: event log entry for a dropped third strike (logged regardless of
-- whether the batter ends up safe or thrown out at first -- the at_bats
-- result already distinguishes the two outcomes; this event just records
-- that the drop itself happened).
alter table public.game_events drop constraint if exists game_events_event_type_check;
alter table public.game_events add constraint game_events_event_type_check
check (event_type in (
  'stolen_base', 'caught_stealing', 'pickoff_out', 'pickoff_attempt',
  'wild_pitch', 'passed_ball', 'balk', 'error', 'intentional_walk',
  'tag_up_violation', 'rundown_out', 'runner_passed', 'out_at_next_base',
  'squeeze_play', 'dropped_third_strike'
));

-- Fix 3: "foul tip (caught)" is its own pitch outcome, distinct from a
-- regular foul -- a foul tip counts toward strike three (ends the at-bat
-- as a strikeout), which a regular foul never does. The request claimed
-- no schema change was needed here ("already has room for this value"),
-- but pitches.outcome's check constraint only ever allowed
-- ('strike','ball','foul','hbp','inplay') -- 'foul_tip' was never a member,
-- so this migration is required despite that claim (the same
-- claimed-no-DB-change-but-actually-is pattern this project has hit
-- several times before, e.g. pickoff/intentional_walk/squeeze_play).
alter table public.pitches drop constraint if exists pitches_outcome_check;
alter table public.pitches add constraint pitches_outcome_check
  check (outcome in ('strike', 'ball', 'foul', 'foul_tip', 'hbp', 'inplay'));
