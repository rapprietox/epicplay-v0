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
    player/page.tsx              Placeholder -- Sprint 4 builds stats/heat maps here
    page.tsx                      "/" -- middleware always redirects this away
    operator/
      page.tsx                    Finds the team's active game, hydrates OperatorConsole
      actions.ts                  Server Actions: getOrCreateGameState, syncGameState,
                                   startDraftAtBat, logPitch, confirmAtBat, undoAtBat,
                                   logStolenBase, logGameEvent, saveSubstitution, endGame
      operator-console.tsx        Client -- the whole tablet-first live logging screen
      initial-state.ts            Builds OperatorState from server rows (game_state +
                                   draft at_bats + its pitches) on first render
      strike-zone-grid.tsx        3x3 tap grid
      field-diagram.tsx           SVG field, tap-to-mark ball landing spot
      baserunner-diamond.tsx      SVG diamond -- presentational; picker lives in the console
      substitution-panel.tsx      Modal: player out/in + reason
      pitch-count-modal.tsx       Full-screen, must-acknowledge warning at 100 pitches
      post-game-summary.tsx       Shown after "End Game" confirm; Submit calls endGame
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
      realtime-refresh.tsx        Client -- subscribes to games/at_bats changes,
                                   debounced router.refresh() so the dashboard updates
                                   live as the operator logs plays
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
                                   (callers must pass only confirmed_at is not null rows)
    pitch-accuracy.ts             Expected-vs-logged-pitches heuristic (see below)
    dates.ts                      daysUntil / formatGameDate
    opponent-history.ts           W-L-T record vs a given opponent, from raw games rows
    operator/
      types.ts                    OperatorState shape + result/pitch-type/hit-type label maps
      reducer.ts                  operatorReducer -- the whole client-side game state machine
      local-storage.ts            5s localStorage snapshot + restore, keyed by game id
      sync-queue.ts                In-memory retry queue for offline writes (see limits below)
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
  manual_apply_sprint3.sql        Convenience concat of just the Sprint 3 migrations
                                   (regenerate all three by hand if migrations change --
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
- `game_state`, `substitutions`, `game_events`: coach/operator only (no
  player-select policy) -- these are operator-console scratch state and
  logs, not something the player dashboard reads.
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
- `games(id, team_id, season_id, opponent_id, opponent_name, game_date, game_time, game_type, home_away, our_score, opponent_score, status, umpire_name, winning_pitcher_id, logging_accuracy_score, notes, created_at)`
  - `game_type`: friendly / preseason / season / playoff / tournament / championship
  - `status`: setup / active / completed / cancelled
  - `season_id`, `opponent_id`, `game_time`, `umpire_name`, `winning_pitcher_id` added in Sprint 2; `opponent_name` stays the display name even when `opponent_id` is set, and is the only opponent reference for free-text (unscheduled/friendly) games
  - `logging_accuracy_score`, `notes` added in Sprint 3, set once by `endGame` when the operator submits the post-game summary
- `lineup(id, game_id, player_id, batting_order, position, created_at)`
- `at_bats(id, game_id, player_id, pitcher_id, mode, inning, inning_half, batting_order_position, result, hit_type, field_x, field_y, rbi, runs_scored, is_out, confirmed_at, created_at)`
  - `result`: single/double/triple/hr/flyout/groundout/lineout/strikeout/walk/hbp/error/fc
  - `hit_type`: groundball/linedrive/flyball/bunt/popup/hr (nullable -- not every result has one)
  - `field_x`/`field_y`: 0-100 coordinates on the field diagram (nullable)
  - `pitcher_id` added in Sprint 2 (nullable, who was pitching this at-bat) -- see Pitching stats below
  - `mode` (`hitting`/`pitching`) and `confirmed_at` added in Sprint 3; `player_id` and `result` became nullable -- see the draft/confirmed lifecycle below
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

Both are now populated by the Sprint 3 operator screen -- `pitcher_id` is
set on every pitching-mode draft at-bat, and Stolen Base is a quick-action
button that inserts into `stolen_bases`.

## Sprint 3: at-bats draft/confirmed lifecycle, game_state, and the operator screen

Three schema forks were confirmed with the user before building (see git
history), because the live-logging requirements exposed real gaps the
Sprint 1/2 schema couldn't support:

**Opposing batter identity.** `at_bats.player_id` only ever references our
own roster. During `mode = 'pitching'` at-bats (the opponent batting
against our pitcher), the batter is an opposing player -- tracked for
on-screen display only (typed/picked from `opponent_players`, held in
`game_state.opponent_batter_name` and the operator's local React state),
never persisted onto `at_bats`. `player_id` stays null for those rows.
Nothing we compute (ERA/WHIP/K are all keyed off `pitcher_id`) needs the
opposing batter's identity, so this avoided an unused column.

**Draft/confirmed at-bat lifecycle.** The spec requires every pitch to hit
the `pitches` table the instant its outcome is tapped, before the at-bat
is confirmed -- but `pitches.at_bat_id` is a NOT NULL FK, so a pitches row
can't exist without an `at_bats` row already there. Resolved by creating
the `at_bats` row immediately when a new batter steps up (`result` and
`player_id` nullable, new `confirmed_at` column, both null on a draft
row), attaching pitches to it right away, and having "Confirm At-Bat" do
an UPDATE that fills in the result and stamps `confirmed_at`. **Every
query that computes stats (`computeBattingLines`, `computePitchingLines`,
anything feeding the coach dashboard or a player breakdown page) must
filter `confirmed_at is not null`** -- both stats functions also
defensively skip null-result/null-player_id rows themselves, but the
query-level filter is what keeps drafts from ever being fetched in the
first place. This also gives free crash-recovery: the current ball/strike
count for an in-progress at-bat is just "pitches attached to the
still-unconfirmed `at_bats` row" -- no separate counter needed.

**Live game state.** Runner positions are operator-adjustable at any
moment (tap a base on the diamond to assign/clear a runner), which means
they aren't purely derivable from `at_bats`/`pitches` history once manual
override is allowed. `game_state` (one row per game, upserted
continuously) holds this: current inning/half/outs, mode, whose turn at
bat, the current pitcher and their pitch count, runner positions (`runners
jsonb` -- `{first, second, third}`, each `{type: "player"|"opponent", id,
name}` since our own runners are real player FKs but opposing runners
during pitching mode are display-only), pitch-count acknowledgment flags,
and the rolling low-accuracy-streak counter. This is what makes "resume an
active game on a different device" actually work, not just "resume on the
same tablet after a reload."

Two more small additions, both straightforward once the above was settled:
`substitutions(id, game_id, player_out_id, player_in_id, reason, inning,
inning_half, created_at)` for the Substitution panel, and
`game_events(id, game_id, inning, inning_half, event_type, note,
created_at)` (`wild_pitch`/`passed_ball`/`balk`/`error`) for the
runner-advancing quick-action buttons that aren't their own at-bat.
`games`/`at_bats`/`game_state` are enabled on the `supabase_realtime`
publication so the coach dashboard's `RealtimeRefresh` component can
subscribe.

### Pitch-logging accuracy heuristic (`src/lib/pitch-accuracy.ts`)

There's no ground truth for how many pitches an at-bat "really" took --
only what the operator logged. `expectedMinPitches(result)` estimates a
defensible minimum from the final result (walk needs >= 4, strikeout >= 3,
everything else >= 1) and `atBatAccuracyRatio` compares it to pitches
actually logged, capped at 1.0. A ratio under 50% for 3 consecutive
at-bats triggers the non-blocking "Low pitch detail" banner; `endGame`
averages the ratio across every confirmed at-bat in the game into
`games.logging_accuracy_score`. This is a documented heuristic, not a
precise measurement -- fouls with 2 strikes can legitimately extend a real
at-bat well past the minimum without that being an accuracy problem,
which is why it only flags being *under* the threshold, never a gap above.

### Operator client-state architecture

`src/lib/operator/reducer.ts` (`operatorReducer`) is the single state
machine driving the whole console -- `src/app/operator/operator-console.tsx`
is a thin(ish) view over it plus the async glue to Server Actions.
Every mutation dispatches synchronously (instant UI feedback -- the
operator is tapping fast under pressure) and *separately* fires the
corresponding Server Action through `withOfflineRetry` (fire-and-forget,
not awaited by the UI). Key design points:

- **Draft at-bat creation is lazy.** `ensureDraftAtBat()` only calls
  `startDraftAtBat` on the *first* pitch outcome tap for a new batter, not
  preemptively after the previous at-bat confirms. This keeps Undo simple:
  it only ever needs to reverse the one just-confirmed row (delete it +
  its pitches, reverse the score/outs/batting-order delta captured in
  `state.lastConfirmed`), never a cascading "and also undo the next
  batter's not-yet-created draft."
- **Baserunner advancement is suggested, never locked.** Picking (or
  auto-reaching, on ball 4 / strike 3 / HBP) an at-bat result computes a
  suggested new `runners` state via `src/lib/operator/runner-advance.ts`
  (`suggestRunnerAdvance` -- single/double/triple/HR/error/FC advance by a
  fixed number of bases, walk/HBP follow the standard force cascade, outs
  leave runners on base) and applies it immediately to `state.runners` so
  the diamond reflects it live, flagging `runnersPendingConfirmation` for
  the pulsing "Confirm Runners" UI. It's a suggestion, not a lock: tapping
  any occupied base at any time (mid-suggestion or not) opens the
  quick-action menu (Advance / Scored / Out / Stolen Base / Picked Off /
  Error Advance -- `RunnerQuickActionMenu`) to override it, since real
  baseball has cases the suggestion can't know (runner going first-to-third
  on a single, thrown out taking an extra base). Wild Pitch/Passed
  Ball/Balk/(all-runners) Error quick actions still advance every occupied
  base by exactly one as a simplification (the common case; doesn't model
  multi-base or no-advance error scenarios). "Picked Off" and "Out" both
  just increment `outs` -- they don't retroactively rewrite the at-bat
  that put the runner on base, and neither is attributed to the pitcher's
  formal `at_bats`-based stats (no at-bat row exists for a pickoff), a
  documented simplification.
- **RBI and runs-scored are no longer independent manual entry.**
  `state.scoredThisAtBat` (runners marked "Scored," whether via the
  suggestion or a manual override) is the *sole* source of truth for
  `runsScored` at Confirm At-Bat time -- there's deliberately no separate
  "runs scored" stepper any more, since two parallel sources of truth for
  the same number could drift out of sync. RBI stays a small manual
  stepper (defaults to the scored count, zeroed by default on an error)
  since RBI crediting has real judgment-call nuance a formula won't get
  right. A "Scored" tap *outside* the at-bat-review flow (e.g. a delayed
  steal of home between at-bats) calls the new `adjustScore` action
  immediately instead, since there's no upcoming Confirm At-Bat to carry it.
- **Undo restores runner positions too**, not just score/outs/batting
  order: `START_DRAFT_LOCAL` snapshots `runners` into
  `runnersAtAtBatStart`, copied onto `lastConfirmed.runnersBeforeAtBat` at
  confirm time so `UNDO_LOCAL` can put runners back exactly where they
  were before that at-bat's suggestion was applied.
- A live `games.game_state` JSONB column was proposed at one point for
  this same runner/inning/score state -- rejected in favor of the
  `game_state` **table** above, which already covered it (and already had
  RLS + the whole operator console wired to it); a same-named column
  would have collided with the table for no benefit, since `our_score`/
  `opponent_score` on `games` are more query-friendly than nesting score
  in JSON anyway.
- **Offline queue is best-effort, not durable across a reload.**
  `src/lib/operator/sync-queue.ts` retries failed writes (most commonly a
  network error while offline) every 5s and on the `online` event, in
  order. The retry closures live in memory -- they do not survive the tab
  being closed or reloaded while offline. What *does* survive a reload:
  `src/lib/operator/local-storage.ts` snapshots the full `OperatorState`
  every 5s, so the operator's in-progress local view is restored and they
  can see what they were mid-logging, but any write that failed and never
  synced before a reload needs to be redone by hand. True cross-reload
  durability would need a service worker + IndexedDB job queue -- out of
  scope for V0, and "zero data loss under any circumstance" should be read
  with that caveat: durable once a request reaches the server, best-effort
  (not guaranteed) if the browser tab is destroyed mid-outage.
- **State hydration**: on mount, `useReducer`'s lazy initializer prefers a
  `dirty: true` localStorage snapshot (unsynced changes from a crash/close)
  over the server-provided initial state (`buildInitialStateFromServer` in
  `initial-state.ts`, built from `game_state` + the draft `at_bats` row and
  its `pitches` if one exists) -- since a `dirty` snapshot means the last
  session ended before those changes reached Supabase.

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

## Sprint 3 follow-up: RBI crediting, double plays, fielding credit, box score

A second Sprint 3 pass added six operator-screen features on top of the
base build above -- `at_bats.result` gained `'double_play'`, plus
`out_type`, `fielded_by_position`, `fielded_by_player_id`, and
`fielded_by_opponent_player_id`; `game_events` gained `player_id` and
`opponent_player_id` for attribution. No new tables.

**A `games.game_state` JSONB column was requested and not built** -- the
existing `game_state` *table* (see above) already covers everything it
would have held (runners, outs, inning, mode), and `games.our_score`/
`opponent_score` already cover score more usefully than nesting it in
JSON. Building the column would have meant either a duplicate, colliding
source of truth or a large rewrite for no functional gain.

**RBI is now auto-derived, not a blanket manual count.** Every runner in
`state.scoredThisAtBat` (`src/lib/operator/types.ts`, `ScoredRunner`)
carries a `ScoreMethod` (`hit`/`sac_fly`/`forced_walk_hbp` award RBI;
`wild_pitch`/`passed_ball`/`balk`/`error` don't). Runners the suggestion
engine auto-advances off a hit/walk/HBP result get their method inferred
(`resultToScoreMethod`); a runner marked "Scored" manually via the
diamond's quick-action menu prompts "How did they score?" (`ScoreMethodMenu`)
so the operator states the method explicitly. `pendingRbi` still recomputes
as a default from this list but stays a manually-adjustable stepper on
top, for judgment calls (e.g. the traditional no-RBI-on-GIDP-as-3rd-out
rule) this project doesn't try to auto-enforce -- the operator has full
control either way.

**Fielding attribution reuses the same "derive from position" mechanism**
for three different features: Fix 6's fielding-credit picker on outs (and
on `result = 'error'`, so an error can be attributed to a fielder too),
and the pitcher/catcher attribution on wild_pitch/balk/passed_ball events.
`src/lib/operator/fielding.ts` (`resolveFielder`) looks up "who's playing
position X right now" from `lineup.position` (ours, mode `'pitching'`) or
`opponent_players.position` (theirs, mode `'hitting'`) -- not tracked as
separate live state, so it assumes positions stay accurate through
mid-game substitutions (a V0 simplification, same spirit as the rest of
this sprint). All-runners quick actions (Wild Pitch/Balk/Passed
Ball/Error, and the per-runner Error Advance) that don't have their own
position picker log the event without a guessed fielder rather than
attributing to an arbitrary position.

**Double plays create two `at_bats` rows, not one.** The batter's own
draft row becomes their out (always a force at 1st); a second row is
created and confirmed in the same step for the runner also put out
(`confirmDoublePlay` in `actions.ts`). This is deliberate, not an
oversight: while pitching, each row's `is_out = true` with `pitcher_id`
set is exactly what `computePitchingLines` already uses to count outs, so
two rows correctly credit the pitcher 2/3 of an inning. The known
trade-off: while hitting, the runner's row also counts as an extra AB/out
in *their own* batting line, which a traditional box score wouldn't
charge them (only the batter is charged for a DP) -- accepted as a minor,
documented stats inaccuracy rather than building a special-cased
"out record that isn't a real at-bat" concept. Undo for a double play
deletes both rows (`lastConfirmed.secondAtBatId`) and reverses 2 outs.

**The mini box-score dashboard (H/R/E/K + LOB) tracks *our* team's line
specifically**, not a per-team-pair line score: hits and runs accumulate
from hitting-mode at-bats (our offense), errors and strikeouts from
pitching-mode at-bats (our defense -- errors we commit fielding,
strikeouts our pitcher records). LOB counts runners left on base only when
a *hitting* half-inning ends. This reads as "how are we doing" rather
than a traditional two-team line score, which the spec's plain "Hits /
Runs / Errors / Strikeouts" wording didn't specify either way. These
counters live only in `OperatorState` (not persisted to `game_state`), so
a page reload resets the live dashboard to 0 even though the underlying
`at_bats` history -- the real source of truth for the coach dashboard --
is unaffected.

**Three-outs is now a blocking full-screen modal, not a bottom-bar
button.** Whenever `state.outs >= 3` (from any source: a batter's own
out, a runner out/picked off via the diamond, or the two outs from a
double play) the modal renders unconditionally and, being a full-screen
overlay, naturally blocks every pitch-logging control underneath without
needing a separate "disabled" prop threaded through them. The only way
past it is its own "End Inning" button.

**Fielding stats computation exists but isn't surfaced in any UI yet.**
`computeFieldingLines`/`computeOpponentFieldingLines` in `src/lib/stats.ts`
compute putouts and errors per fielder from `at_bats.fielded_by_*`. Only
putouts, not assists -- Fix 6 deliberately captures one fielder per play
(a single tap after the field-diagram tap), so there's no multi-fielder
chain to derive an assist from. No coach-dashboard panel displays these
yet; that's future-sprint scope, not part of this batch.

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

Dark theme, Oakland A's-inspired green rebrand (post-Sprint-3), must read
as an MLB analytics tool, not a school project.

| Token | Value |
|---|---|
| Background | `#030A06` |
| Surface (cards) | `#071A0E` |
| Card | `#0A2214` |
| Border | `#1A3D28` |
| Primary accent | `#1A6B3C` |
| Accent (light/hover) | `#24A058` |
| Accent green (bright/success) | `#2ECC71` |
| Glow (neon accents) | `#00FF7F` |
| Amber | `#EF9F27` |
| Red (errors) | `#E24B4A` |
| Gold (leaders) | `#F0C060` |
| Text | `#C8F0D5` |
| Body font | DM Sans (`--font-sans`, class `font-sans`, the default) |
| Heading/big-number font | Barlow Condensed (`--font-heading`, class `font-heading`) |

Both fonts load via `next/font/google` in `src/app/layout.tsx`. Tokens
live in `tailwind.config.ts` (`accent.primary/light/green/glow/amber/red/
gold`, `surface`, `card`, `border`, `fontFamily.sans/heading`) and
`src/app/globals.css` (`--background`, `--foreground`, plus the `.glossy`
and `.glow-green` utility classes -- see below). No external chart library
-- heat maps and spray charts (Sprint 4) render as inline SVG.

**Color history, oldest to newest** (if you see any of these hex values
anywhere, they're stale and should be replaced with the current tokens
above): Sprint 1 shipped Inter/`surface: #0F1F38`/`border: #1C2E4A` as a
placeholder; Sprint 2 replaced them with a blue accent (`#0A1628`
background, `#0D1E35` surface, `#1A2D4A` border, `#2E6FD4` blue,
`#1D9E75` green, `#C5D8F0` text); a later Sprint 3 pass replaced the blue
scheme entirely with the green palette in the table above. **The old
`accent.blue` Tailwind token was renamed to `accent.primary`** (not just
re-valued) -- keeping a class named "blue" that resolves to green would
have been a confusing, stale-sounding name for anyone reading the JSX;
the rename was a global, mechanical find-and-replace of `accent-blue` ->
`accent-primary` across every `.tsx` file. `accent.green` kept its name
(green already made sense) but its *value* moved from the old
`#1D9E75` to the new bright `#2ECC71` -- it was already the app's
established "success/confirm/positive" color (Save, Confirm At-Bat, Live
indicator, Win), and the new palette's "bright green" is explicitly
meant to take over exactly that role. Generic Tailwind `red-400`/`red-500`
utility classes (errors, End Game, the pitch-count alert) were similarly
consolidated onto the single formal `accent.red` (`#E24B4A`) token.

**`.glossy`** (defined in `globals.css`): the glossy/satin gradient +
inset-highlight + outer-glow card treatment, applied to cards, the strike
zone grid, and operator-screen panels via `className="glossy ..."`
alongside whatever `bg-surface`/`bg-card` the element already used (it
doesn't set its own background, so it composes rather than overrides).
**`.glow-green`**: a neon box-shadow glow for occupied-base runner dots
and other "key moment" accents -- SVG shapes use an inline
`style={{ filter: "drop-shadow(...)" }}` instead, since `box-shadow`
doesn't reliably apply to SVG shape elements the way it does to a `<div>`.

The field diagram SVG (`src/app/operator/field-diagram.tsx`) now draws
outfield and infield grass as two separate layered shapes (`#2D5A1B`
outfield, `#3A7A25` infield) instead of one flat fill, specifically to
support the two distinct Oakland A's field-green shades.

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

**Sprint 3 (done):** The operator live game-logging screen, tablet-first,
at `/operator` -- HITTING/PITCHING mode toggle, current batter/pitcher
header, ball-strike-out count, inning/score display, pitch type pills, a
strike zone tap grid (visually a 9x9 subdivision -- 81 zones -- of the
original 3x3 thirds for more precise location capture, but still one
large continuous tap surface rather than 81 small buttons, per the
48px-minimum-tap-target rule; see `strike-zone-grid.tsx`), pitch outcome
buttons (each pitch saved to `pitches` immediately, before the at-bat is
confirmed -- see the draft/confirmed lifecycle above), at-bat result
buttons with an RBI stepper and a derived (not manually entered)
runs-scored count, Confirm At-Bat with a 30-second visible-countdown Undo
that also restores runner positions, SVG field diagram tap-to-mark,
baserunner diamond with suggested-then-confirmable auto-advance (see
"Baserunner advancement is suggested, never locked" above) and a
per-runner quick-action menu (Advance/Scored/Out/Stolen Base/Picked
Off/Error Advance) alongside the existing all-runners Wild
Pitch/Balk/Passed Ball/Error quick actions, Substitution panel, running
pitch count with 75/85 color warnings and a must-acknowledge full-screen
modal at 100, the low-pitch-detail accuracy warning, manual End Inning/End
Game with confirmation dialogs, and a post-game summary screen (Submit ->
`endGame` sets `status='completed'`, computes `logging_accuracy_score`).
5-second localStorage snapshots + best-effort offline retry queue (see the
durability caveat above -- not literally bulletproof across a reload while
offline). Coach dashboard gained a live "Continue Game" panel for an
active game, a live/Continue row on the schedule table, and
`RealtimeRefresh` (Supabase Realtime -> debounced `router.refresh()`) so
scores and stats update as the operator logs plays.

**Sprint 4 (next, not started):** Player dashboard (AVG/HR/RBI/OBP/SLG/
OPS, at-bat history, SVG heat map, SVG spray chart) -- the last major
placeholder page (`/player`) left from Sprint 1.

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
