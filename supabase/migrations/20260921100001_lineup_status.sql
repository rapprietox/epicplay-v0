-- Feature 1 (lineup-status batch): per-game player status (starting /
-- reserve / absent / late_arrival), stored on the lineup table as given.
--
-- One necessary addition beyond the literal request: lineup.batting_order
-- is NOT NULL (from the original lineup migration) -- but a reserve or
-- absent player has no batting order at all, so a lineup row for them
-- needs batting_order to be nullable. Without this, "store player status
-- per game in the lineup table" for anyone who isn't placed on the field
-- is simply not possible; this is a required consequence of the request,
-- not an optional extra. Postgres treats each NULL as distinct for
-- uniqueness, so multiple reserve/absent rows with batting_order null
-- don't conflict with the existing unique(game_id, batting_order).
alter table public.lineup alter column batting_order drop not null;

alter table public.lineup add column if not exists status text default 'reserve'
  check (status in ('starting', 'reserve', 'absent', 'late_arrival'));

-- Feature 1: the operator's new "Late Arrival" flow logs a game_events
-- row when a previously-absent player checks in.
alter table public.game_events drop constraint if exists game_events_event_type_check;
alter table public.game_events add constraint game_events_event_type_check
check (event_type in (
  'stolen_base', 'caught_stealing', 'pickoff_out', 'pickoff_attempt',
  'wild_pitch', 'passed_ball', 'balk', 'error', 'intentional_walk',
  'tag_up_violation', 'rundown_out', 'runner_passed', 'out_at_next_base',
  'squeeze_play', 'dropped_third_strike', 'late_arrival', 'substitution'
));

-- Feature 2: unrelated to the request itself, but discovered while
-- wiring the chain-substitution diagram to field_calibration's
-- "positions" row (already read/written by the app's own calibration
-- tool and operator/coach code, committed in an earlier session) -- the
-- original field_calibration migration's check constraint only ever
-- allowed field_type in ('2d', '3d'), never 'positions'. That means any
-- attempt to actually save a "Player Positions" calibration has been
-- failing against a real Postgres check-constraint violation this whole
-- time, independent of anything in this batch. Fixed here since Feature
-- 2 is the first feature that actually depends on that data existing.
alter table public.field_calibration drop constraint if exists field_calibration_field_type_check;
alter table public.field_calibration add constraint field_calibration_field_type_check
check (field_type in ('2d', '3d', 'positions'));
