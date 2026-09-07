# EpicPlay AI V0

Baseball statistics tracking app for internal team testing. An operator logs
games live at the field; players see their own stats update in real time;
a coach sees the whole team.

## Stack

- Next.js 14 (App Router) + TypeScript + Tailwind CSS
- Supabase: Postgres + Auth (Google OAuth only) + Row Level Security + Realtime
- Deployed on Vercel. No payments, no separate backend (no Railway) for V0.
- `@supabase/ssr` for cookie-based auth across Server Components, Route
  Handlers, and middleware.

## Repo layout

```
src/
  app/
    login/page.tsx              Google sign-in
    auth/callback/route.ts      OAuth code exchange -> redirect to /
    auth/auth-code-error/page.tsx
    pending/page.tsx             Signed in, no team/role assigned yet
    operator/page.tsx            Placeholder -- Sprint 2 builds game logging here
    player/page.tsx              Placeholder -- Sprint 2 builds stats/heat maps here
    coach/page.tsx                Placeholder -- Sprint 2 builds team dashboard here
    page.tsx                      "/" -- middleware always redirects this away
  components/
    sign-out-button.tsx
  lib/supabase/
    client.ts                     Browser client (Client Components)
    server.ts                     Server client (Server Components / Route Handlers)
    middleware.ts                 updateSession() -- session refresh + role routing
    types.ts                      Hand-written Database type (see below)
  middleware.ts                   NOTE: lives in src/ because of --src-dir
supabase/
  migrations/*.sql                Canonical, ordered migrations
  manual_apply.sql                Convenience concat of all migrations, for pasting
                                   into the Supabase SQL Editor (regenerate by hand
                                   if migrations change -- don't edit directly)
  README.md                       How to apply migrations + onboard the first coach
```

`src/middleware.ts` must stay under `src/` (not the project root) because
the project uses `--src-dir`; Next.js only picks it up from whichever
directory holds `app/`.

## Roles and access model

Three roles: `operator` (logs games), `player` (own stats only), `coach`
(everything). Google OAuth is the only sign-in method; anyone with a Google
account can create a session, but a **`profiles` table** (see below) is
what actually grants access to team data.

`profiles` is **not** one of the tables the product spec listed verbatim --
it was added because role-based access needs somewhere to store "which
role/team/player does this auth.users row correspond to." It's the
single source of truth role-checks and RLS policies key off of.

- `public.profiles(id -> auth.users.id, email, full_name, role, team_id, player_id, created_at)`
- A trigger (`handle_new_user`) auto-inserts a profile on first Google
  sign-in, defaulting to `role = 'player'` with `team_id`/`player_id` both
  null.
- **There is no admin UI yet.** A coach assigns `role`, `team_id`, and (for
  players) `player_id` by hand via the Supabase SQL Editor. See
  `supabase/README.md` for the exact statements. This is deliberate for V0
  (internal testing, presumably one team) -- build a real onboarding UI
  once there's more than a handful of users.
- A user with no `team_id` lands on `/pending` regardless of role.

### RLS design

Three security-definer helper functions (defined in the profiles migration,
callable from any policy without recursing into `profiles`' own RLS):
`my_role()`, `my_team_id()`, `my_player_id()`.

General shape, table by table:
- `teams`: any member of the team can `select`; only `coach` can `update`.
  Team creation is done directly via SQL/dashboard for V0 (no signed-in
  user policy allows `insert`).
- `players`, `games`, `lineup`: any team member can `select`; only
  `coach`/`operator` can write, scoped to their own `team_id`.
- `at_bats`, `pitches`: `coach`/`operator` can `select`/write everything
  scoped to their team (joining up through `games`/`at_bats`); `player`
  can only `select` rows where `player_id` (or the parent at-bat's
  `player_id`, for pitches) matches their own `my_player_id()`. Players
  never get insert/update/delete policies on either table -- only an
  operator logs at-bats and pitches.

## Database schema

See `supabase/migrations/*.sql` for the authoritative definitions
(constraints, indexes, RLS policies). Summary:

- `teams(id, name, created_at)`
- `profiles(id, email, full_name, role, team_id, player_id, created_at)` -- not in the original spec, see above
- `players(id, team_id, name, jersey_number, position, user_id, created_at)`
- `games(id, team_id, opponent_name, game_date, game_type, home_away, our_score, opponent_score, status, created_at)`
  - `game_type`: friendly / preseason / season / playoff / tournament / championship
  - `status`: setup / active / completed
- `lineup(id, game_id, player_id, batting_order, position, created_at)`
- `at_bats(id, game_id, player_id, inning, inning_half, batting_order_position, result, hit_type, field_x, field_y, rbi, runs_scored, is_out, created_at)`
  - `result`: single/double/triple/hr/flyout/groundout/lineout/strikeout/walk/hbp/error/fc
  - `hit_type`: groundball/linedrive/flyball/bunt/popup/hr (nullable -- not every result has one)
  - `field_x`/`field_y`: 0-100 coordinates on the field diagram (nullable)
- `pitches(id, at_bat_id, pitch_number, pitch_type, zone_x, zone_y, outcome, created_at)`
  - `pitch_type`: fastball/curveball/changeup/slider/2seam/other (nullable)
  - `zone_x`/`zone_y`: 0-100 coordinates in the strike-zone grid (nullable)
  - `outcome`: strike/ball/foul/hbp/inplay

No stat-aggregation views/functions yet (AVG/OBP/SLG/OPS etc.) -- those
land in Sprint 2 alongside the dashboards that need them, to avoid
building aggregation logic before there's a consumer to validate it against.

### `src/lib/supabase/types.ts`

Hand-written to mirror the migrations (including a `Relationships: []` on
every table -- omitting it silently makes every `.select()` type-infer to
`never` under `@supabase/ssr`'s generic constraints). Once the Supabase CLI
is linked to the project (`supabase link --project-ref <ref>`), regenerate
with `supabase gen types typescript --linked` instead of hand-editing, and
prefer two-step queries (fetch a row, then a related row by id) over
embedded `select("foo(bar)")` joins unless the generated types include real
`Relationships` metadata -- the hand-written stub does not.

## Auth flow

1. `/login` -- client component, calls
   `supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: "<site>/auth/callback" } })`.
2. Google OAuth Client ID/Secret are configured in the **Supabase
   dashboard** (Authentication > Providers > Google), not as app env vars.
3. `/auth/callback` (Route Handler) exchanges the `code` query param for a
   session via `exchangeCodeForSession`, then redirects to `/`.
4. `src/middleware.ts` (via `updateSession()`) runs on every request:
   refreshes the Supabase session cookie, then:
   - no user + not a public path -> redirect to `/login`
   - user + `/login` -> redirect to `/`
   - user + `/` -> redirect to `/operator`, `/player`, or `/coach` based on
     `profiles.role`, or `/pending` if `team_id` is null
   - user hitting another role's section (e.g. a `player` hitting
     `/operator`) -> redirected back to their own section

Public paths (no auth required): `/login`, `/auth/callback`,
`/auth/auth-code-error`.

## Design system

Dark theme, must read as an MLB analytics tool, not a school project.

| Token | Value |
|---|---|
| Background | `#0A1628` |
| Surface (cards) | `#0F1F38` |
| Border | `#1C2E4A` |
| Blue accent | `#2E6FD4` |
| Green | `#1D9E75` |
| Amber | `#EF9F27` |
| Text | `#C5D8F0` |
| Font | Inter (`next/font/google`, loaded in `src/app/layout.tsx`) |

Tokens live in `tailwind.config.ts` (`accent.blue/green/amber`, `surface`,
`border`) and `src/app/globals.css` (`--background`, `--foreground`). No
external chart library -- heat maps and spray charts (Sprint 2+) render as
inline SVG.

## Environment variables

See `.env.local.example`. Real values live in `.env.local` (gitignored,
never commit it):

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=      # server-only; not currently used by any route, kept for future admin scripts
NEXT_PUBLIC_SITE_URL=           # http://localhost:3000 in dev
```

Google OAuth Client ID/Secret are **not** app env vars -- they live in the
Supabase Auth provider settings.

## Sprint status

**Sprint 1 (done):** Next.js 14 + TS + Tailwind scaffold, Supabase client
setup (browser/server/middleware), all migrations, Google OAuth flow,
role-based routing, placeholder role landing pages that confirm the whole
pipeline (auth -> profile lookup -> team lookup) actually works end to end.

**Sprint 2 (next, not started):** Operator live game-logging screen (strike
zone 3x3 tap grid, at-bat outcomes, field diagram tap, pitch-by-pitch
logging, manual End Inning, 30-second undo window), player dashboard
(AVG/HR/RBI/OBP/SLG/OPS, at-bat history, SVG heat map, SVG spray chart),
coach dashboard (team stats table, per-player drill-down), Supabase
Realtime subscriptions so player stats update live as the operator logs
at-bats.
