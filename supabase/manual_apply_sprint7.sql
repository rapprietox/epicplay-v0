-- Clubhouse Pro enhancement, Part 3: personal KAIROS credits + cached
-- initial assessment.
alter table public.players add column if not exists kairos_messages_used integer not null default 0;
alter table public.players add column if not exists kairos_messages_reset_date date not null default current_date;
alter table public.players add column if not exists kairos_initial_assessment text default null;

comment on column public.players.kairos_messages_used is
  'Messages sent to personal KAIROS this calendar month. Reset to 0 whenever kairos_messages_reset_date falls before the current month start -- see src/lib/kairos-credits.ts.';
comment on column public.players.kairos_messages_reset_date is
  'The date kairos_messages_used last reset. Compared against the current month start on every KAIROS send -- see src/lib/kairos-credits.ts.';
comment on column public.players.kairos_initial_assessment is
  'One-time generated welcome assessment (weakness/strength zone + 4-week plan), cached here on first Clubhouse Pro unlock. Regenerated only via the explicit "Regenerate" action, never automatically.';

-- Part 4: situational-stat snapshot, captured at the moment each at-bat
-- starts (ensureDraftAtBat / startDraftAtBat), not derivable after the
-- fact -- game_state.runners/outs are live-only and overwritten every
-- pitch, so this is the only point where "outs and baserunners before
-- this at-bat" can ever be recorded. Nullable: every at-bat logged
-- before this ships stays null, and the situational-stats panel treats
-- null as "not tracked for this row" rather than "zero runners on."
alter table public.at_bats add column if not exists outs_before smallint;
alter table public.at_bats add column if not exists risp_before boolean;

alter table public.at_bats drop constraint if exists at_bats_outs_before_check;
alter table public.at_bats add constraint at_bats_outs_before_check
  check (outs_before is null or outs_before in (0, 1, 2));

comment on column public.at_bats.outs_before is
  'Outs recorded in the half-inning at the moment this at-bat began (0-2). Null for at-bats logged before this column existed.';
comment on column public.at_bats.risp_before is
  'True if a runner occupied 2nd or 3rd base at the moment this at-bat began. Null for at-bats logged before this column existed.';
