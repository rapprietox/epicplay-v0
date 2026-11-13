-- Pro expiry batch: clubhouse_unlocked has always been a one-time,
-- never-re-locked boolean (see its own column comment in
-- 20260929110001_clubhouse_invites_and_promo_codes.sql). This adds a
-- real expiry date alongside it so Clubhouse Pro access can actually
-- lapse at season end, instead of being permanent the moment it's true.
--
-- Nullable, not required: null means "no expiry" (the grandfather case
-- the backfill below creates for everyone already unlocked today), a
-- set value means "active only until this timestamp." See
-- src/lib/clubhouse-access.ts (isClubhouseActive) for how the two
-- columns combine, and src/lib/pricing.ts (PRO_VALID_UNTIL) for where
-- new unlocks get their expiry from.
alter table public.players add column if not exists clubhouse_unlocked_until timestamptz;

comment on column public.players.clubhouse_unlocked_until is
  'Null = unlocked with no expiry (grandfathered). Set = Clubhouse Pro access lapses at this timestamp; isClubhouseActive() checks clubhouse_unlocked AND (this is null OR in the future). Never read directly -- always go through isClubhouseActive().';

-- Backfill: every player already unlocked today (via Stripe or a promo
-- code, before this column existed) gets the same season-end expiry a
-- brand-new unlock would get from today forward -- nobody who already
-- paid loses access early, and nobody gets a silent indefinite
-- grandfather either. Scoped to clubhouse_unlocked = true rows only;
-- a locked player's clubhouse_unlocked_until stays null (meaningless
-- until they actually unlock, per isClubhouseActive's own short-circuit
-- on clubhouse_unlocked = false).
update public.players
set clubhouse_unlocked_until = '2026-12-31T23:59:59Z'
where clubhouse_unlocked = true
  and clubhouse_unlocked_until is null;
