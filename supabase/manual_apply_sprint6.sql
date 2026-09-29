  -- Sprint 6 (Clubhouse): player account linking + Clubhouse Pro unlock.
  --
  -- CORRECTION to the originally proposed migration: players.user_id
  -- already exists (added in 20260907120004_players.sql) and
  -- profiles.player_id already exists too (added in the same migration).
  -- Neither has ever been written by application code -- this sprint is
  -- what starts using them. Only invite_token and clubhouse_unlocked are
  -- genuinely new columns; user_id is NOT re-added here.
  alter table public.players add column if not exists invite_token text unique;
  alter table public.players add column if not exists clubhouse_unlocked boolean not null default false;

  comment on column public.players.invite_token is
    'Single-use claim secret for the coach "Link Account" flow. Cleared to null the moment a player claims it, so a reused/old link fails cleanly instead of needing a separate "used" flag.';
  comment on column public.players.clubhouse_unlocked is
    'True once Clubhouse Pro is unlocked, via Stripe checkout.session.completed or a redeemed promo code. One-time unlock, never re-locked by app code.';

  -- Promo codes: a small number generated per team, handed out by the
  -- coach outside the app. Each code belongs to a team, not a specific
  -- player, redeemable once by whichever linked player enters it first.
  create table if not exists public.promo_codes (
    id uuid primary key default gen_random_uuid(),
    team_id uuid not null references public.teams (id) on delete cascade,
    code text not null unique,
    redeemed_by_player_id uuid references public.players (id) on delete set null,
    redeemed_at timestamptz,
    created_at timestamptz not null default now()
  );

  alter table public.promo_codes enable row level security;

  create policy "promo_codes: team members select"
    on public.promo_codes for select
    using (team_id = public.my_team_id());

  create policy "promo_codes: coach/operator write"
    on public.promo_codes for all
    using (public.my_role() in ('coach', 'operator') and team_id = public.my_team_id())
    with check (public.my_role() in ('coach', 'operator') and team_id = public.my_team_id());

  -- Clubhouse Pro spray chart batch: a player viewing their own Clubhouse
  -- spray chart needs to read their team's field_calibration, same as the
  -- operator's field diagram already does. Extends the existing
  -- coach/operator select policy (20260920110002_field_calibration_operator_select.sql)
  -- to include player -- write stays coach-only.
  drop policy if exists "field_calibration: coach/operator select" on public.field_calibration;

  create policy "field_calibration: coach/operator/player select"
    on public.field_calibration for select
    using (public.my_role() in ('coach', 'operator', 'player') and team_id = public.my_team_id());
