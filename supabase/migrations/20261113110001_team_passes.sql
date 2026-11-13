-- Team Pass batch: a one-time, coach/parent-purchased unlock for the
-- whole roster at once, layered on top of (never replacing) each
-- player's own individual clubhouse_unlocked/clubhouse_unlocked_until
-- (20261113100001_clubhouse_unlocked_until.sql). See
-- src/lib/team-pass.ts (isTeamPassActive) and src/lib/clubhouse-access.ts
-- (isClubhouseActive) for how the two combine at read time.
--
-- One row per purchased/extended term, not one row per team -- an
-- extension (buying again while a pass is still active) inserts a NEW
-- row starting where the current one ends, rather than updating the
-- existing row's ends_at in place. This keeps the full purchase
-- history (amount_cents, stripe_checkout_session_id, purchased_by) for
-- every term intact, and keeps the webhook's insert idempotent on
-- stripe_checkout_session_id alone with no update-vs-insert branching.
create table if not exists public.team_passes (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  purchased_by uuid references public.profiles (id) on delete set null,
  stripe_checkout_session_id text unique,
  amount_cents integer,
  status text not null default 'active' check (status in ('active', 'refunded')),
  created_at timestamptz not null default now()
);

comment on column public.team_passes.purchased_by is
  'profiles.id of whoever completed the checkout (normally a coach) -- nullable so a manually-granted pass (supabase/data-ops/grant-team-pass.mjs, sold outside Stripe) isn''t forced to name one.';
comment on column public.team_passes.stripe_checkout_session_id is
  'Null for a manually-granted pass. Unique so the webhook''s insert is naturally idempotent on a duplicate/retried checkout.session.completed event.';
comment on column public.team_passes.status is
  'active or refunded. A full refund (charge.refunded) sets this to refunded AND sets ends_at to the refund time -- isTeamPassActive() short-circuits on status alone, so a refunded-but-still-future ends_at from before the refund can''t be read as still active.';

create index if not exists team_passes_team_id_idx on public.team_passes (team_id);

alter table public.team_passes enable row level security;

-- Members of the team (coach, operator, or player) can read their own
-- team's rows -- a player needs this to know "is my team's pass what's
-- unlocking me" (src/app/player/clubhouse/page.tsx), same shape as
-- every other team-scoped select policy in this schema.
create policy "team_passes: team members select"
  on public.team_passes for select
  using (team_id = public.my_team_id());

-- Deliberately no insert/update/delete policy for any role -- every
-- write (the Stripe webhook, the refund handler, and
-- supabase/data-ops/grant-team-pass.mjs) goes through the service-role
-- client, which bypasses RLS entirely. Not even a coach can write this
-- table from their own session; it's never a direct user action, only
-- a side effect of a verified Stripe event or a deliberately-run
-- manual script.
