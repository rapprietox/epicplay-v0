-- Sport-choice batch: a lead on the launch page, and a team at
-- self-serve onboarding, can now say whether they play baseball,
-- softball, or both. Softball itself isn't supported yet (see the
-- app's own FAQ) -- this only records the choice; it doesn't change
-- any stats/positions/ERA/innings logic, which still assumes baseball
-- rules regardless of what's stored here.

-- Nullable: a lead is a loose, one-off capture, and every row inserted
-- before this column existed correctly has no sport on record (not a
-- false "baseball" default). The launch-page form itself makes the
-- choice required at the UI/validation layer, not here.
alter table public.leads add column if not exists sport text
  check (sport in ('baseball', 'softball', 'both'));

comment on column public.leads.sport is
  'Self-reported sport from the launch-page lead form -- baseball, softball, or both. Null for every lead captured before this column existed, and for any other caller that never asks for one.';

-- Not null, defaulted: unlike a lead, every team IS a real team that
-- has to be something -- "no sport on record" isn't a meaningful state
-- for an existing roster/schedule to be in. The default backfills
-- every team created before this column existed (the Lions included)
-- to 'baseball', which is what they already were in practice.
alter table public.teams add column if not exists sport text not null default 'baseball'
  check (sport in ('baseball', 'softball', 'both'));

comment on column public.teams.sport is
  'Self-reported sport, chosen at self-serve onboarding -- baseball, softball, or both. Defaults to baseball for every team, including ones created before this column existed. Softball support is not built yet; stats/positions/ERA/innings logic is unaffected by this column and still assumes baseball rules regardless of its value.';
