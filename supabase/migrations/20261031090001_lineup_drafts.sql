-- Lineup drafts (feature/lineup-drafts branch). A coach can keep
-- several named lineup plans per game ("Plan A"/"Plan B") before
-- locking one in as the official lineup. NOT applied to the live
-- project yet -- written for review only, per the request.
--
-- Written idempotently so it's safe to re-run: drop policy if exists
-- before each create policy, and the one existing-table change
-- (games.lineup_confirmed_at) uses add column if not exists.

create table if not exists public.lineup_drafts (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id),
  team_id uuid not null references public.teams(id),
  name text not null,
  slots jsonb not null default '[]'::jsonb,
  analysis jsonb,
  reliability integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.lineup_drafts is
  'Named, in-progress lineup plans for a game (e.g. "Plan A"/"Plan B"). Never read by the operator screen, Start Game, or the printout -- those read only public.lineup, which a draft only reaches via Lock Lineup (see lockLineup in draft-actions.ts and games.lineup_confirmed_at below).';
comment on column public.lineup_drafts.slots is
  'Same shape as the LineupSlot[] payload saveLineupAndUmpire (actions.ts) already accepts -- batting_order/player_id/position/status -- so locking a draft is just handing its slots straight to that existing, unmodified function.';
comment on column public.lineup_drafts.analysis is
  'Cached getFullLineupAnalysis() result (FullLineupAnalysis, full-lineup-analysis-actions.ts) for this draft''s current slots, so reopening a draft doesn''t re-run the AI. Null until the first analysis runs for this draft.';
comment on column public.lineup_drafts.reliability is
  'The cached analysis''s own reliabilityPct, duplicated out of the jsonb blob so the compare view can read/sort it without unpacking analysis.';

alter table public.games add column if not exists lineup_confirmed_at timestamptz;
comment on column public.games.lineup_confirmed_at is
  'Set when a coach locks a draft into the official lineup (lockLineup, draft-actions.ts); null means not locked. A game whose lineup table already had status=''starting'' rows from before this feature existed gets this backfilled to now() the first time its setup page loads under the new code (see ensureDraftsAndLock in draft-actions.ts) -- a one-time migration step, not a live, ongoing fallback check, so Unlock behaves the same for every game afterward.';

alter table public.lineup_drafts enable row level security;

drop policy if exists "lineup_drafts: coach/operator select own team" on public.lineup_drafts;
create policy "lineup_drafts: coach/operator select own team"
  on public.lineup_drafts for select
  using (public.my_role() in ('coach', 'operator') and team_id = public.my_team_id());

drop policy if exists "lineup_drafts: coach/operator write own team" on public.lineup_drafts;
create policy "lineup_drafts: coach/operator write own team"
  on public.lineup_drafts for all
  using (public.my_role() in ('coach', 'operator') and team_id = public.my_team_id())
  with check (public.my_role() in ('coach', 'operator') and team_id = public.my_team_id());
