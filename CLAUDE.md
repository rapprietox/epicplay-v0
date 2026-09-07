# EpicPlay AI V0

Baseball statistics tracking app for internal team testing. An operator logs
games live at the field; players see their own stats update in real time;
a coach sees the whole team.

## Stack

- Next.js 14 (App Router) + TypeScript + Tailwind CSS
- Supabase: Postgres + Auth (Google OAuth only) + Row Level Security + Realtime + Storage
- Anthropic API (`@anthropic-ai/sdk`, model `claude-opus-5`) for season PDF
  schedule extraction, opponent lineup photo extraction, and the Next Game
  scouting note -- all server-only, called from Server Actions
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
    operator/page.tsx            Placeholder -- Sprint 3 builds live game logging here
    player/page.tsx              Placeholder -- Sprint 3 builds stats/heat maps here
    page.tsx                      "/" -- middleware always redirects this away
    coach/
      page.tsx                    Dashboard: Next Game, Team Leaders, Schedule,
                                   plus Roster + Create Season sections below
      actions.ts                  Server Actions: addPlayer, extractSchedulePdf,
                                   confirmSeasonImport, addManualGame, cancelGame, editGame
      roster-section.tsx          Client -- add-player form + roster list
      season-import-section.tsx   Client -- PDF upload -> review -> confirm
      next-game-panel.tsx         Server (async) -- calls generateOpponentInsight
      leaders-board.tsx           Client -- computes stat lines, all/season/playoff filter
      schedule-table.tsx          Client -- inline edit/cancel, manual add-game form
      players/[id]/page.tsx       Per-player batting/pitching breakdown
      games/[id]/setup/
        page.tsx                   Pre-game setup: lineup + umpire + opponent roster
        actions.ts                  saveLineupAndUmpire, startGame, extractOpponentPhoto,
                                     confirmOpponentRoster
        lineup-builder.tsx          Client -- native HTML5 drag-and-drop, 9 batting slots
        opponent-photo-import.tsx   Client -- photo upload -> review -> confirm
  components/
    sign-out-button.tsx
  lib/
    anthropic.ts                  Server-only Anthropic client + the three AI calls
    stats.ts                      Pure functions: at_bats/stolen_bases -> batting/pitching lines
    dates.ts                      daysUntil / formatGameDate
    opponent-history.ts           W-L-T record vs a given opponent, from raw games rows
    supabase/
      client.ts                   Browser client (Client Components)
      server.ts                   Server client (Server Components / Route Handlers)
      middleware.ts                updateSession() -- session refresh + role routing
      types.ts                    Hand-written Database type (see below)
  middleware.ts                   NOTE: lives in src/ because of --src-dir
supabase/
  migrations/*.sql                Canonical, ordered migrations
  manual_apply.sql                Convenience concat of every migration
  manual_apply_sprint2.sql        Convenience concat of just the Sprint 2 migrations
                                   (regenerate both by hand if migrations change --
                                   don't edit them directly)
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
- `at_bats`, `pitches`, `stolen_bases`: `coach`/`operator` can `select`/write
  everything scoped to their team (joining up through `games`/`at_bats`);
  `player` can only `select` rows tied to their own `my_player_id()`.
  Players never get insert/update/delete policies on any of these -- only
  an operator logs at-bats, pitches, and steals.
- `seasons`, `opponents`, `opponent_players`: same team-scoped
  select-for-members / write-for-coach-or-operator shape as `players`/`games`.
- Storage buckets `season-schedules` and `opponent-photos` are private;
  objects are stored at `${team_id}/...` and a policy checks
  `(storage.foldername(name))[1] = my_team_id()::text`, restricted to
  `coach`/`operator` -- same team-scoping model as the tables, just applied
  to object paths instead of a `team_id` column.

## Database schema

See `supabase/migrations/*.sql` for the authoritative definitions
(constraints, indexes, RLS policies). Summary:

- `teams(id, name, created_at)`
- `profiles(id, email, full_name, role, team_id, player_id, created_at)` -- not in the original spec, see above
- `players(id, team_id, name, jersey_number, position, user_id, created_at)`
- `games(id, team_id, season_id, opponent_id, opponent_name, game_date, game_time, game_type, home_away, our_score, opponent_score, status, umpire_name, winning_pitcher_id, created_at)`
  - `game_type`: friendly / preseason / season / playoff / tournament / championship
  - `status`: setup / active / completed / cancelled
  - `season_id`, `opponent_id`, `game_time`, `umpire_name`, `winning_pitcher_id` added in Sprint 2; `opponent_name` stays the display name even when `opponent_id` is set, and is the only opponent reference for free-text (unscheduled/friendly) games
- `lineup(id, game_id, player_id, batting_order, position, created_at)`
- `at_bats(id, game_id, player_id, pitcher_id, inning, inning_half, batting_order_position, result, hit_type, field_x, field_y, rbi, runs_scored, is_out, created_at)`
  - `result`: single/double/triple/hr/flyout/groundout/lineout/strikeout/walk/hbp/error/fc
  - `hit_type`: groundball/linedrive/flyball/bunt/popup/hr (nullable -- not every result has one)
  - `field_x`/`field_y`: 0-100 coordinates on the field diagram (nullable)
  - `pitcher_id` added in Sprint 2 (nullable, who was pitching this at-bat) -- see Pitching stats below
- `pitches(id, at_bat_id, pitch_number, pitch_type, zone_x, zone_y, outcome, created_at)`
  - `pitch_type`: fastball/curveball/changeup/slider/2seam/other (nullable)
  - `zone_x`/`zone_y`: 0-100 coordinates in the strike-zone grid (nullable)
  - `outcome`: strike/ball/foul/hbp/inplay
- `seasons(id, team_id, name, year, start_date, end_date, created_at)` -- Sprint 2. `start_date`/`end_date` are derived from min/max imported game date, not asked of the coach separately.
- `opponents(id, team_id, name, created_at)` -- Sprint 2, unique per `(team_id, name)`. Auto-created on schedule import or manual game add (deduped by name); also the free-text fallback for unscheduled/friendly opponents (a game can have `opponent_name` set with `opponent_id` null).
- `opponent_players(id, opponent_id, name, jersey_number, position, created_at)` -- Sprint 2. `jersey_number` is `text` (not `int`), defaulting to `'—'`, because the source is often an illegible photo.
- `stolen_bases(id, game_id, player_id, inning, created_at)` -- Sprint 2. A standalone event, not tied to an `at_bat` (a steal happens between pitches, not as its own plate appearance) -- see Stolen bases below.

### Pitching stats and stolen bases -- schema additions beyond the literal spec

The product spec asked the Team Leaders Board to show pitching stats
(ERA/WHIP/W/K/IP) and stolen bases, but nothing in the Sprint 1 schema
could support either -- there was no way to know who was pitching, and a
steal isn't an at-bat outcome. Both were confirmed with the user before
building (see git history) rather than silently shipped or silently
dropped:

- `at_bats.pitcher_id` (nullable FK -> `players`) + `games.winning_pitcher_id`
  (nullable FK -> `players`, set manually by the coach -- deriving a
  "winning pitcher" automatically from play-by-play is genuinely hard and
  not worth building for V0). ERA treats every run allowed as earned (no
  earned/unearned distinction tracked) -- a documented simplification.
- `stolen_bases` as its own table (see above).

**Neither is populated yet.** `pitcher_id` and steal-logging both require
the operator live-game-logging screen, which is Sprint 3 scope. Until
then, `src/lib/stats.ts` returns an empty map for pitching lines and the
Leaders Board renders a blank/dash state for those rows and for Stolen
Bases -- this is expected, not a bug.

### `src/lib/stats.ts`

Pure functions (`computeBattingLines`, `computePitchingLines`) that take
raw `at_bats`/`stolen_bases`/`games` rows and return `Map<playerId, ...Line>`.
OBP/SLG don't distinguish sacrifice flies (not tracked in the schema) --
also a documented V0 simplification. No DB views/functions for
aggregation -- computed in TypeScript from rows fetched per dashboard
render, which is fine at V0's data volume (a handful of games/players) and
avoids committing to a SQL aggregation shape this early.

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
| Surface (cards) | `#0D1E35` |
| Border | `#1A2D4A` |
| Blue accent | `#2E6FD4` |
| Green | `#1D9E75` |
| Amber | `#EF9F27` |
| Gold (leaders) | `#F0C060` |
| Text | `#C5D8F0` |
| Body font | DM Sans (`--font-sans`, class `font-sans`, the default) |
| Heading/big-number font | Barlow Condensed (`--font-heading`, class `font-heading`) |

Both fonts load via `next/font/google` in `src/app/layout.tsx`. Sprint 1
shipped with Inter/`surface: #0F1F38`/`border: #1C2E4A` as a placeholder;
Sprint 2 replaced them with the values above per the product spec --
if you see the old hex values anywhere they're stale. Tokens live in
`tailwind.config.ts` (`accent.blue/green/amber/gold`, `surface`, `border`,
`fontFamily.sans/heading`) and `src/app/globals.css` (`--background`,
`--foreground`). No external chart library -- heat maps and spray charts
(Sprint 3) render as inline SVG.

## Environment variables

See `.env.local.example`. Real values live in `.env.local` (gitignored,
never commit it):

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=      # server-only; not currently used by any route, kept for future admin scripts
NEXT_PUBLIC_SITE_URL=           # http://localhost:3000 in dev
ANTHROPIC_API_KEY=              # server-only; season PDF + opponent photo extraction, scouting notes
```

Google OAuth Client ID/Secret are **not** app env vars -- they live in the
Supabase Auth provider settings. `ANTHROPIC_API_KEY` is read implicitly by
`new Anthropic()` in `src/lib/anthropic.ts` -- never pass it through to the
client, and every call site is a Server Action or a Server Component, never
a Client Component.

## Sprint status

**Sprint 1 (done):** Next.js 14 + TS + Tailwind scaffold, Supabase client
setup (browser/server/middleware), all migrations, Google OAuth flow,
role-based routing, placeholder role landing pages that confirm the whole
pipeline (auth -> profile lookup -> team lookup) actually works end to end.

**Sprint 2 (done):** Coach dashboard (Next Game panel with an AI scouting
note, Team Leaders Board with an all/season/playoff filter, Season
Schedule table with inline edit/cancel), roster management, season PDF
import (Claude extracts games -> coach reviews/edits -> confirm creates
opponents + games), manual add/edit/cancel game, pre-game setup (drag-
and-drop 9-slot lineup builder, umpire name, opponent lineup photo import
via Claude Vision -> review -> confirm, Start Game gated on 9 players +
umpire), per-player batting/pitching breakdown page. Pitching stats and
stolen bases are schema-ready but empty until Sprint 3 populates
`at_bats.pitcher_id` and logs `stolen_bases` rows (see above). `/operator`
is still the Sprint 1 placeholder, now reachable with `?game=<id>` after
Start Game.

**Sprint 3 (next, not started):** Operator live game-logging screen (strike
zone 3x3 tap grid, at-bat outcomes incl. pitcher_id/steals, field diagram
tap, pitch-by-pitch logging, manual End Inning, 30-second undo window),
player dashboard (AVG/HR/RBI/OBP/SLG/OPS, at-bat history, SVG heat map,
SVG spray chart), Supabase Realtime subscriptions so player/coach stats
update live as the operator logs at-bats.

## If `npm run build` OOMs locally: check for orphaned dev servers first

`npm run build` hit `Fatal process out of memory` during "Generating
static pages" during Sprint 2 development -- turned out to be two
orphaned `next dev` processes left running from earlier in the session
(a backgrounded `npm run dev` whose `kill` didn't actually reach the
detached Windows process tree), not a real memory ceiling or a code
issue. Before assuming the build itself needs more heap, check for
leftover node processes eating memory:

```powershell
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Select-Object ProcessId, CommandLine
```

and stop any stray `next dev` trees (`Stop-Process -Id <pid> -Force`).
Killing a backgrounded dev server with plain `kill` from Git Bash is not
reliable on Windows -- prefer stopping it via PowerShell as above, or note
the port and don't leave it running across tool calls in the first place.
