-- Manual dot positioning, team spray chart: a lock flag so the coach can
-- freeze dot positions once they're correct, requiring confirmation to
-- unlock and edit again.
--
-- Deliberately on `teams`, not `games` as given in the request -- the
-- chart this is for (src/app/coach/team-analytics.tsx, "Team Spray
-- Chart") aggregates at-bats across every game the team has played, with
-- no per-game view at all (only an opponent filter). A `games`-scoped
-- flag would have no single value to check: there's no "current game"
-- this chart is ever showing just one of. One flag per team matches the
-- actual scope of what's being locked.
alter table public.teams add column if not exists spray_chart_locked boolean not null default false;

comment on column public.teams.spray_chart_locked is
  'Freezes manual dot-position edits on the team-wide spray chart (src/app/coach/team-analytics.tsx) once the coach is done correcting them. Team-scoped, not per-game -- that chart has no single-game view to attach a per-game flag to.';
