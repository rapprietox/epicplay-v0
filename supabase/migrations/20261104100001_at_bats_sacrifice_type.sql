-- Sacrifice-rules batch: a sacrifice is now determined from what actually
-- happened to the runners on a fly/line/foul out or a bunt, not from
-- which button the operator tapped -- see operator-console.tsx's
-- runnerOutcomeQueue. 'fly' = a flyout/lineout/foul out where at least
-- one runner scored on the play (outs below 2 beforehand, since the catch
-- itself is the out that would otherwise end the inning first). 'bunt' =
-- a bunted groundout, out at first, where no runner was put out and at
-- least one runner advanced or scored. Null for every other at-bat,
-- including a bunt that reached safely/on an error/fielder's choice
-- (never a sacrifice) and a fly/bunt out with nobody on or 2 outs already
-- (no sacrifice is possible). Drives computeBattingLines (a sacrifice
-- counts as a plate appearance but not an at-bat; only 'fly' also widens
-- OBP's denominator, matching official scoring) and the scorebook's SF/SH
-- notation. Not applied yet -- see supabase/README.md for how to apply a
-- migration, and run the backfill candidate list past the coach first
-- since this column starts null on every existing row.
alter table public.at_bats add column if not exists sacrifice_type text default null;
alter table public.at_bats drop constraint if exists at_bats_sacrifice_type_check;
alter table public.at_bats add constraint at_bats_sacrifice_type_check
  check (sacrifice_type is null or sacrifice_type in ('fly', 'bunt'));
