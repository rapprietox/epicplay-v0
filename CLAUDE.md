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

## Post-Sprint-4 enhancements: schedule collapse, spray chart lines, extended splits

Three enhancements requested after the Sprint 4 commit, built in this order
(quickest win first, most complex last), all computed from existing
`pitches`/`at_bats` rows -- no schema changes.

**Season Schedule collapse** (`src/app/coach/schedule-table.tsx`). Games
split into three tiers by `game_date` vs today: the next 3 upcoming games
render expanded in their own table with the soonest one tagged "Next" and
tinted (`prominent` prop on `GameRow`); everything before today collapses
under a "Past Games (X)" accordion summarizing the team's overall W-L(-T)
record (`resultLetter` tallied across every completed past game, most
recent first when expanded); anything upcoming beyond the next 3 collapses
under "Remaining Schedule (X)". `Collapsible` uses the CSS
`grid-template-rows: 0fr -> 1fr` transition trick (a div wrapping the
content in `overflow-hidden`) instead of measuring pixel heights in JS --
it's the standard way to animate a height nobody knows in advance, and
needs no extra state or ResizeObserver.

**Spray chart "Lines" view** (`src/app/coach/players/[id]/spray-chart.tsx`).
A toggle was added alongside the original dot rendering (now the "Zones"
tab, unchanged) for a new "Lines" tab: each ball in play draws as an SVG
`<line>` from home plate (fixed at the field diagram's `(50, 92)`, where
the foul lines already meet) out to its `field_x`/`field_y`, using
`pathLength={1}` + a `strokeDasharray`/`strokeDashoffset` transition (the
same delayed-reveal pattern already used for the heat map grids'
`revealed` state, just applied per-line with a small per-index stagger for
the "radiating outward" effect) rather than pulling in an animation
library. Color comes from hit type, not result -- `lineHitCategory` /
`LINE_HIT_CATEGORY_COLOR` in `src/lib/heat-map.ts`: fly ball bright green,
ground ball amber, line drive gold, pop up muted green, and a home run
always renders white with a glow **regardless of its logged `hit_type`**
(`result === "hr"` is checked first), since the result is the more
reliable signal for "this ball left the park." `hit_type` values outside
those four tracked buckets (`bunt`, or `null`) fall back to a neutral
"Other" category instead of guessing. Line thickness follows the
`SprayDot.category` already used by the Zones tab (out = 1px, everything
else = 2px). The bottom-right legend (hit-type + percentage breakdown,
counted over whatever the hit-type/game-type filters currently show) is
an absolutely-positioned HTML overlay on top of the SVG rather than raw
SVG text -- simpler to size/wrap correctly than hand-placing `<text>`
elements in a 100x100 viewBox.

**Extended heat map statistics** (`src/app/coach/players/[id]/page.tsx`,
new `hitter-extended-stats.tsx` / `pitcher-extended-stats.tsx` panels,
plus a new `src/lib/count-stats.ts`). Two schema gaps were confirmed with
the user before building, both following the exact honesty precedent
Sprint 4 set for "Whiff Rate":

- **Chase rate and contact rate are not built at all** (not approximated).
  Both need to know whether the batter *swung*; `pitches.outcome` only
  records strike/ball/foul/hbp/inplay, with no swing-vs-take distinction
  and no stored strike-zone boundary to test "outside the zone" against.
  A note to that effect renders directly on the Hitter Splits panel rather
  than silently omitting the sections.
- **Runners-on vs. bases-empty pitching splits are not built.** Historical
  base occupancy isn't persisted anywhere -- only `game_state.runners`,
  which is overwritten continuously as the live game progresses -- so
  there's no reliable per-at-bat "were runners on" signal to split by,
  and reconstructing one from play sequencing was judged too unreliable
  to present as a real stat. Documented in-panel on Pitcher Splits.

Two count-dependent stats (hitters' Count Performance table, pitchers'
Strikeouts-by-Count) both need "what ball-strike count was this at-bat
decided in," which the schema also doesn't store directly -- so
`src/lib/count-stats.ts` adds `reconstructCounts` / `finalCountForAtBat`,
which replays a sorted pitch sequence (balls increment on `ball`, strikes
increment on `strike`/`foul` capped at 2 -- a foul can never be strike
three, `hbp`/`inplay` end the at-bat without changing the count further)
and returns the count in effect for the pitch that decided the at-bat.
This mirrors the existing "the zone for an at-bat is its last pitch's
zone" convention from `heat-map.ts` -- both pick the *decisive* pitch as
the one attribute-worthy moment in a multi-pitch at-bat, for the same
reason. The ten counts named in the request (`0-0/1-0/0-1/2-0/0-2/1-1/
2-1/3-1/3-2/full`) collapse to nine tracked buckets in
`TRACKED_COUNTS` -- 3-2 and "full count" are the same count in baseball,
so it's one row labeled "3-2 (Full)" rather than a duplicate.

Both new panels reuse the "last pitch type decided this at-bat" map
already built for the zone heat maps (for AVG/K% by pitch type, an
at-bat-level stat) alongside raw per-pitch counts (for Strike Rate by
pitch type, a pitch-level frequency stat) -- the same two-tier approach
`PitcherHeatmap` already used for its zone panels, now reused for pitch
type instead of location. `PITCH_TYPES` and `STRIKE_OUTCOMES` moved from
being locally defined inside `pitcher-heatmap.tsx` into
`src/lib/count-stats.ts` so all three components (existing pitcher heat
map, new hitter panel, new pitcher panel) share one definition instead of
three copies. Zone Coverage (hitters) and Zone Command (pitchers) are
plain pitch-location frequency grids -- how many pitches were seen/thrown
in each zone, not an outcome-colored heat map -- shaded by count relative
to that grid's own max rather than a fixed batting-average color scale,
since "most pitches" has no natural fixed thresholds the way batting
average does.

## Five UI/UX fixes: sequential pitch logging, player navigation, ball
## zones, batter stance, and PDF season-year correction

Built in this order (biggest UX win first): Fix 4 (sequential flow), Fix 1
(player navigation), Fix 2 (ball zones), Fix 3 (batting/throwing hand),
Fix 5 (PDF year correction).

### Fix 4: sequential contextual pitch-logging flow

The operator screen's pitch-by-pitch interaction was rebuilt around a
`flowStep` derived entirely from state the reducer already tracked
(`awaitingResult`/`suggestedResult`/`fieldTap`/`pendingHitType`/
`pendingFielding`/`runnersPendingConfirmation`) -- turned out the Sprint
3/4 state machine already modeled every step of "tap zone -> pick outcome
-> [if in play] tap field -> pick hit type -> pick result -> confirm";
what was missing was a UI that revealed one step at a time instead of
showing every panel at once. `operator-console.tsx` computes
`flowStep: "pitch" | "field" | "hitType" | "result" | "fielding" |
"runnerConfirm"` as a pure function of state on every render -- no new
state machine, this fix is almost entirely a view-layer rewrite:

- **Step 1** (`StrikeZoneGrid` + `PitchOutcomePopup`): tapping a zone sets
  `selectedZone` (unchanged reducer behavior); `StrikeZoneGrid` now
  accepts a `popupContent` node and renders it anchored at the tapped
  point using the same percentage-based positioning the pitch dots
  already used, with simple quadrant-based clamping (flips left/up past
  the 55% mark) so it never renders off the tap surface. Strike splits
  into "Strike (Looking)" / "Strike (Swinging)" -- the one outcome where
  swing-vs-take is genuinely ambiguous (ball/hbp are always a take,
  foul/inplay are always a swing) -- writing to a new nullable
  `pitches.swing` column (see below) rather than being cosmetic-only,
  per the user's explicit choice over a same-schema alternative.
- **Step 2** (`field`): reached when `awaitingResult && suggestedResult
  === null && !fieldTap` -- true only after "In Play" (auto-results like
  walk/strikeout/hbp set `suggestedResult` immediately, so they skip
  straight past steps 2-4). Renders the field diagram full-panel with a
  "Tap where the ball landed" prompt in place of the strike zone.
- **Step 3** (`hitType`): a pill row from the existing `HIT_TYPE_LABELS`.
  Picking "HR" auto-calls `pickResult("hr")` immediately (skips step 4 --
  there's only one sensible result for that hit type).
- **Step 4** (`result`): filtered to `HIT_TYPE_RESULT_OPTIONS[hitType]`
  (`src/lib/operator/types.ts`) instead of all 12 results. Ground ball ->
  groundout/single/double/error/fc/double_play; fly ball ->
  flyout/single/double/triple/hr; line drive -> lineout/single/double/
  triple/hr, per the request. Popup and bunt weren't specified in the
  request -- their lists are a reasonable extrapolation of the same "what
  can this batted ball become" logic, documented as an inference in the
  constant's own comment. **"Sacrifice Fly" is deliberately not a button**
  -- it isn't a distinct `AtBatResult` in this schema; a sac fly is
  already a `flyout` result plus the runner's `ScoreMethod` set to
  `sac_fly` when they score (the mechanism Sprint 3 built), so adding a
  separate result value would have duplicated an already-correct
  mechanism rather than filled a gap.
- **Fielding + runner confirmation**: `showFieldingPicker`'s existing
  condition became the `fielding` step; a new `runnerConfirm` step shows
  the picked result, the RBI stepper, and a "Confirm & Continue" button
  only when `runnersPendingConfirmation` is true. A `useEffect` watches
  `flowStep` and calls `handleConfirm()` automatically the instant nothing
  is left to fill in (no fielding needed, no runner movement pending) --
  walks, strikeouts, HBPs, and now every in-play result confirm without a
  separate button tap, matching "tap, respond, tap, respond." The effect
  is declared *above* the `postGameOpen` early return (a hook after a
  conditional return breaks React's rules-of-hooks) and guards on
  `state.currentAtBatId` so it can't fire with nothing to confirm.
- **Right column** (baserunner diamond, wild pitch/balk/passed ball/error,
  substitution) stays persistent and outside the flow -- real baseball
  doesn't pause for the sequential conversation (a steal or a wild pitch
  can happen mid at-bat), so ad-hoc game events keep their own
  always-visible controls rather than being folded into the five steps.
  The field diagram and fielding picker, which used to live permanently
  in this column, moved into the flow panel (they're genuinely part of
  the in-play sequence now, not persistent state).
- **Pitch type** is a pinned pill row above the flow panel (picked once,
  before the zone tap, exactly as requested), not part of the step swap.
- **At-bat summary flash**: `summaryFlash` (a plain `useState<string |
  null>`, not reducer state -- it's transient UI, not something worth
  persisting or undoing) shows `"Single — Line Drive — RF"`-style text for
  2.5s after every confirm (including double plays), auto-clearing via a
  `useEffect`/`setTimeout` pair. The existing 30-second Undo bar in the
  bottom nav is unchanged -- undo already existed and already covers
  every confirmed at-bat, so Fix 4 didn't need to touch it.
- **Change-hit-type escape hatch**: the `result` step keeps a small
  "← change hit type" link back to step 3. Strictly linear flow would
  trap a mis-tapped hit type behind a full at-bat Undo; this one
  intentional deviation from pure linearity is cheap and avoids that trap.
- **Scope boundary**: the Double Play wizard, pitcher picker, substitution
  panel, score-method menu, and runner quick-action menu are unchanged --
  they're already self-contained modal sequences, not the flat
  always-visible panel layout this fix targeted. The "change fielding"
  post-hoc edit link that used to sit in the old always-visible result
  panel was dropped (no longer has anywhere to live once fielding is its
  own one-shot step) -- a wrong tap is now corrected via the existing
  30s Undo, not an inline edit.

`pitches.swing boolean` (migration `20260909100001_pitches_swing.sql`) is
nullable and additive -- every pre-existing pitch stays `null` (unknown);
only pitches logged through the new popup populate it, deterministically
for every outcome (ball/hbp -> false, foul/inplay -> true, strike ->
whichever button was tapped). This doesn't just serve the Looking/Swinging
button -- it's real swing-vs-take data now accumulating for every pitch,
which is exactly what a future Chase Rate / Contact Rate / true Whiff
Rate would need (previously skipped, see the Enhancement 3 section above)
-- not built in this pass, but no longer blocked by the schema either.

### Fix 1: player navigation from the coach dashboard

Turned out the Team Leaders Board (`leaders-board.tsx`) already wrapped
every row in a `Link` to `/coach/players/[id]` -- that part of the
request was already true before this fix. The actual gap was the
**Roster** section (`roster-section.tsx`): it rendered players as plain
`<li>` text, and since the Leaders Board only surfaces category leaders
(not the full roster), any player without a leaderboard entry had no way
to reach their own page. Fixed by turning the roster list into a grid of
`Link` cards to the same `/coach/players/[id]` route -- reusing the
section already titled "Roster" rather than adding a second, separate
roster-shaped section, since that would have duplicated the player list
the coach already sees while adding players.

### Fix 2: outer ball-zone ring on the strike zone grid

25 total zones (9 strike-zone + 16 ball-zone: 3 each on the
top/bottom/left/right edges, plus 4 corners) on a conceptual 5x5 grid.
The **critical constraint**: `zone_x`/`zone_y` for the original 9 zones
already means something on every pitch logged since Sprint 3 --
"position within the strike zone," 0-100 on each axis. Redefining what
0-100 means (e.g. shrinking the strike zone to the middle 60% of a
rescaled grid) would have silently corrupted every historical pitch's
interpretation. Instead the ring's coordinates live **outside** 0-100
(roughly -16.67 to 116.67, using a ring cell width of half a strike-zone
third -- "smaller" than the zone's own cells, per the request), extending
the outward but leaving the original 0-100 meaning completely untouched.
Migration `20260909110001_pitches_ball_zone_range.sql` widens the
`zone_x`/`zone_y` check constraints from `[0,100]` to `[-50,150]` to fit.

This required auditing every caller of `zoneIndexFromCoords`
(`src/lib/heat-map.ts`) -- it's the function all the 9-zone strike-zone
heat maps (batting-average-by-zone, strike-rate-by-zone, zone
coverage/command) use to bucket a pitch's coordinate into one of 9
indices, and it would have thrown or produced a garbage negative array
index the moment a ball-zone pitch (coordinates now outside 0-100) reached
it. Fixed by having it return `number | null` (null for anything outside
the strike zone) instead of always a number -- the type change forced
every call site to handle the null case, which TypeScript caught for free
across `pitcher-heatmap.tsx`, `pitcher-extended-stats.tsx`, and
`hitter-extended-stats.tsx`. A ball-zone pitch correctly falling out of
every strike-zone-only stat is exactly the right behavior, not a bug to
route around.

`strike-zone-grid.tsx`'s tap handler now maps a click to the extended
coordinate range and snaps it either to the existing fine 9x9 sub-grid
(inside the strike zone, unchanged precision) or to the center of
whichever of the 16 ring cells was tapped (coarser -- the ring doesn't
need 9x9 precision, just "which of the 16 zones"). The SVG viewBox
extends to cover the ring; a darker background rect under a lighter
strike-zone rect gives the "ball zones ... darker" look, and the ring's
internal dividers use `strokeDasharray` for the "subtle dashed border"
called for. **Building the actual walk-tendency / wild-pitch heat map
dashboards was out of scope for this fix** -- the request's own framing
("this builds ... heat maps *over time*") reads as future payoff from
data now being captured, not a deliverable to ship immediately; no new
analytics panel was added.

### Fix 3: batter/throwing stance

`players.batting_hand` (`'L'|'R'|'S'`) and `players.throwing_hand`
(`'L'|'R'`), both `char(1) default 'R'` per the request, plus check
constraints restricting the allowed values (migration
`20260909120001_players_hands.sql`). Added to the Add Player form
(`roster-section.tsx`, defaulting to R/R) and shown as a small `B/T`
badge on each roster card. The operator screen shows the batting hand as
a small badge next to the current batter's name (`operator-console.tsx`)
-- only for our own lineup; opponent batters come from `opponent_players`
(populated by AI photo extraction, which has no way to read a stance off
a lineup card), so there's no data source for an opposing batter's hand
and none is shown. HBP needed no code change -- the batter's hand is
already available via the existing `players` row the operator screen
already has loaded, exactly as the request anticipated.

### Fix 5: season-year correction on PDF import

`season-import-section.tsx`'s `detectStaleYear` checks whether every
extracted game shares one single year and that year isn't the current
one (a schedule PDF is often typeset with the prior year, or scanned
early) -- if so, a dismissible prompt offers a year `<select>` (defaulting
to the current year) with "Update to [year]" or "Keep [year]." Updating
rewrites every extracted game's date string in place (keeps month/day,
replaces the year) and the season name/year fields, before the coach even
starts reviewing individual rows -- deliberately a bulk, upfront
correction rather than a per-row fix, since the whole PDF is virtually
always wrong in the same direction if it's wrong at all.

## Five more operator-screen fixes: popup positioning, pitch flash, pickoff, balk, tag-up

Built in the requested order: Fix 1 (menu position -- the most disruptive
bug), Fix 5 (flash), Fix 2 (pickoff), Fix 3 (balk), Fix 4 (tag-up),
prompted "no database changes needed except pickoff already exists in
game_events." That premise turned out wrong (see Fix 2) -- worth flagging
here since it's exactly the kind of assumption this file exists to
correct before it causes confusion later.

### Fix 1: the outcome popup was being clipped, not "off-screen"

The popup added in the Fix 4 sequential-flow rework positioned itself as
a `left/top: %` child inside `StrikeZoneGrid`'s own box -- which has
`overflow-hidden` (to clip the SVG/dots to its rounded corners). Any part
of the popup that fell outside that ~280x280px box was being silently
clipped by its own parent, not rendered somewhere else on the page. A
purely CSS/percentage-based repositioning fix couldn't solve this; the
popup had to leave that DOM subtree entirely.

Fixed with a `createPortal` (`react-dom`) straight to `<body>`, positioned
`fixed` in real viewport pixel coordinates captured from
`getBoundingClientRect()` + the tap event's `clientX`/`clientY` (per
spec) -- `position: fixed` on a portaled node is no longer a descendant
of the clipping container, so `overflow-hidden` can't touch it. Anchor
side follows the spec exactly: top-half tap -> menu renders below
(`translateY(+gap)`), bottom-half -> above (`translateY(-100% - gap)`),
right-half tap -> anchored left (`translateX(-100%)`), left-half ->
anchored right (`translateX(0)`). A `useLayoutEffect` then measures the
popup's own rendered `getBoundingClientRect()` after paint and nudges it
back with an extra `translate(dx, dy)` if it still overflows the viewport
by less than an 8px margin -- the CSS-side quadrant logic gets it right
in the vast majority of taps, but only an actual post-render measurement
can guarantee "never outside the viewport" for a tap right at a screen
edge, which is what the spec's own "use getBoundingClientRect()" line was
asking for.

### Fix 5: pitch confirmation flash

A `pitch-flash-overlay` CSS class (`globals.css`) with a `@keyframes
pitch-flash` (`0%`/`50%`/`100%` opacity `0`/`0.4`/`0` over `300ms` --
150ms up, 150ms down, exactly per spec) renders as an absolutely
positioned div over the grid. `operator-console.tsx` bumps a `flashKey`
counter (not a boolean -- a boolean flipped `true` on back-to-back
identical pitches wouldn't re-trigger a CSS animation, since the class
never actually changed) on every `ball`/`strike`/`foul`/`hbp` outcome,
and `StrikeZoneGrid` keys the overlay div on that number so React
remounts a fresh element (and therefore restarts the animation) each
time. `"inplay"` deliberately never bumps `flashKey`, per spec -- that
outcome transitions straight to the field-diagram step instead of
resetting for another pitch.

### Fix 2: pickoff -- and the incorrect premise about game_events

**The request's framing ("pickoff already exists in game_events") doesn't
match the schema.** `game_events.event_type`'s check constraint only ever
allowed `wild_pitch`/`passed_ball`/`balk`/`error`. What already existed
was a *different* thing: `RunnerQuickAction`'s `"picked_off"` value, a
per-base menu item (tap an occupied base -> its quick-action menu) that
only increments `outs` and clears the runner locally -- by design, per
the Sprint 3 note already in this file, it "doesn't retroactively rewrite
the at-bat... neither is attributed to the pitcher's formal
`at_bats`-based stats," and critically **it never wrote a `game_events`
row at all.** So a real migration was needed here despite the request
saying otherwise: `20260917100001_game_events_pickoff_tagup.sql` widens
the constraint to add `pickoff_out`, `pickoff_attempt`, and (for Fix 4)
`tag_up_violation`.

The new "Pickoff" quick-action button opens its own two-step
`PickoffWizard` (pick the occupied base, then Out/Safe) -- kept
deliberately separate from the existing per-base "Picked Off" menu item
rather than replacing it, since that one is still a legitimate quick
single-tap path for "this runner's just out, don't ask more"; the new
wizard is for when the operator specifically wants the pickoff attempt
itself on record (including the "attempted, runner safe, nothing changes"
case the old action had no way to represent at all). "Out" reuses the
same `applyRunnerAction(base, "picked_off")` path (removes the runner,
increments `outs` -- the always-rendered `ThreeOutsModal` reacts on its
own if this happens to be out #3, no special-cased "is this the 3rd out"
check needed anywhere) and additionally logs a `pickoff_out` event
attributed to the pitcher (`resolve("P")` -- a pickoff throw is always
pitcher-initiated). "Safe" logs `pickoff_attempt` with no state change at
all. Both flash a confirmation via the same `summaryFlash` state Fix 4
introduced.

### Fix 3: balk -- already fully worked

**Balk was already a fully-correct existing quick action**
(`handleQuickEvent("balk")`, built well before this batch): all runners
already advance one base (`advanceAllRunnersOneBase`), a runner on 3rd
already scores (via the same call's `scored` array feeding `runsScored`
into `logGameEvent`, which credits the run directly to `games.our_score`/
`opponent_score`), no RBI is credited (nothing in that path touches
`pendingRbi`), and the event already logs to `game_events` with
`event_type: 'balk'` attributed to the pitcher. The request's own
requirements were, unknowingly, already fully met -- the only literal gap
was the "show a brief confirmation" line, so that's the only thing this
fix actually added: `setSummaryFlash("Balk — all runners advance")`
alongside the existing dispatch.

### Fix 4: tag-up violation (appeal play)

A distinct, separate out from the fly out that just ended the at-bat --
scoped to `result === "flyout"` specifically (the request's "Fly Out or
any caught fly ball" phrasing reads as clarifying what a fly out *is*,
not asking to extend this to line outs too). Right after `handleConfirm`
dispatches `CONFIRM_LOCAL` for a flyout, if any runner is still on base
(`Object.values(state.runners).some(Boolean)` -- no point prompting with
empty bases), `tagUpPrompt` flips true and a small panel appears in the
flow column: one button per occupied base ("<name> (<base>) — Out, left
early") plus a "No" dismiss. Tapping a runner reuses
`applyRunnerAction(base, "out")` (same reasoning as Fix 2 -- outs
accumulate from any source and `ThreeOutsModal` is purely reactive to
`state.outs >= 3`, so "if this brings total outs to 3" needed no special
code) and logs a `tag_up_violation` event with no fielder attribution
(the spec didn't ask for a picker here, so this follows the same
"log without a guessed attribution" precedent as `error_advance`). The
prompt auto-clears via a `useEffect` on `state.currentAtBatId` -- once
the next batter's first pitch starts a new draft at-bat, the appeal
window has implicitly passed, so there's no need to track a separate
timeout for it.

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

**Sprint 4 (done):** Pitch-by-pitch logging and heat maps -- see the
dedicated section below for the schema-driven decisions (an honest
"Strike Rate" instead of a fabricated "Whiff Rate," how zone-based heat
maps derive a zone from an at-bat, the running-accuracy storage
repurposing, and a real pre-existing pitching-stats bug this sprint fixed
along the way). **Note:** this built out the *coach's* view of a player
(`/coach/players/[id]`) with heat maps/spray charts, plus the operator
screen's live pitch sequence/session heat map and the coach dashboard's
new Team Analytics section -- the *player's own* self-service dashboard
(`/player`, what a signed-in player sees of their own stats) is still the
Sprint 1 placeholder and remains the next real gap.

**Post-Sprint-4 enhancements (done):** Season Schedule three-tier
collapse, a "Lines" spray-chart view (radiating, hit-type-colored,
animated), and extended Hitter/Pitcher Splits panels on the player
breakdown page (count performance, pitch-type breakdown, zone
coverage/command, strikeouts-by-count, first-pitch-strike%,
pitches/AB) -- see the dedicated section below for the two schema-gap
decisions (chase/contact rate and runners-on/off splits both omitted,
not approximated) and the count-reconstruction utility they share.

**Five UI/UX fixes (done):** the operator screen's pitch logging is now a
sequential, contextual flow (tap zone -> popup -> [in-play sub-flow] ->
auto-confirm) instead of an always-visible multi-panel layout; every
player is reachable from the coach dashboard (Roster cards, plus the
Leaders Board links that already existed); the strike zone grid grew a
16-cell outer ball-zone ring around the original 9; players carry a
batting/throwing hand shown on the operator screen; season PDF import
flags and offers to bulk-correct a stale extracted year. See the dedicated
section below for the schema additions (`pitches.swing`, the widened
`pitches.zone_x/zone_y` range, `players.batting_hand/throwing_hand`) and
the `zoneIndexFromCoords` nullability fix the ball-zone ring required.

**Five more operator-screen fixes (done):** the pitch-outcome popup is now
portaled to `<body>` with real-pixel `position: fixed` placement instead
of a percentage position inside an `overflow-hidden` parent that was
silently clipping it; ball/strike/foul/HBP now flash the strike zone grid
green on confirmation; a new "Pickoff" quick action logs a real
`game_events` row (`pickoff_out`/`pickoff_attempt`) that the pre-existing
per-base "Picked Off" runner action never did; Balk needed no logic
changes (it already fully worked) beyond a confirmation flash; a
post-flyout "did a runner leave early" appeal panel logs
`tag_up_violation` as a second, separate out. See the dedicated section
below -- including a note on the one incorrect premise in that request
(pickoff did *not* already have a `game_events` type) and the migration
that followed from it.

## Sprint 4: pitch sequence, pitch count/accuracy display, and heat maps

**Bug fix found and fixed along the way:** the coach's per-player
breakdown page (`/coach/players/[id]`) computed pitching stats
(`computePitchingLines`) from the *same* `at_bats` query used for batting
stats -- `.eq("player_id", player.id)`. But pitching-mode at-bats never
have `player_id` set (it's null; `pitcher_id` is the relevant column, per
the Sprint 3 draft/confirmed lifecycle design). So the "Pitching" section
on that page could never have shown real data, for any player, since
Sprint 3. Fixed by querying pitching-mode at-bats separately, keyed by
`pitcher_id`.

**"Whiff Rate" doesn't exist in this schema, so it isn't built.**
`pitches.outcome` has one generic `'strike'` value with no swinging-vs-
called distinction -- there's no way to compute a real swing-and-miss
rate from what's stored. The pitcher heat map (`pitcher-heatmap.tsx`)
builds a defensible substitute instead: **Strike Rate by zone**
(strike/foul/in-play share of pitches in that zone), explicitly labeled
as such with an on-page note explaining why, rather than mislabeling it
"whiff rate."

**Zone-based heat maps use the *last pitch* of a confirmed at-bat as
"the zone."** A plate appearance sees many pitch locations; "batting
average by zone" only makes sense pinned to *one* location per at-bat,
and the final pitch (the one whose outcome ended the at-bat) is the only
defensible choice -- it's what "the pitch that got them out" or "the
pitch they hit" actually refers to. `src/lib/heat-map.ts`
(`zoneIndexFromCoords`, `computeZoneBattingLines`) implements this;
`zoneIndexFromCoords` reuses the exact same 3x3 thirds boundaries as the
operator's `StrikeZoneGrid` (33.33/66.67), so a zone means the same thing
everywhere it's shown.

**The pitch-count-accuracy running average redesign.** Sprint 3 tracked
"3 consecutive low-accuracy at-bats" as a streak counter. Sprint 4 restated
the requirement as a single running percentage ("Logging: 94% accurate")
warning below 70% -- a genuinely different aggregation, not just a
threshold tweak, so the streak counter was replaced (not kept alongside)
with `accuracyRatioSum`/`accuracyAtBatCount` running totals
(`src/lib/pitch-accuracy.ts` -> `runningAccuracy`,
`RUNNING_ACCURACY_WARNING_THRESHOLD`). The spec's literal expected-pitches
formula ("balls + strikes + fouls + 1") was *not* adopted as written --
those counts are themselves derived from what the operator logged, so
"expected" would always equal "actual" and the check could never fire;
Sprint 3's result-based heuristic (`expectedMinPitches`) was kept, since
it's the only version that can actually detect under-logging. Storage:
`games.logging_accuracy_score` now holds a 0-1 float (was 0-100) per the
Sprint 4 spec; `game_state.logging_accuracy_score` /
`consecutive_low_accuracy_at_bats` are **repurposed, not renamed**, to
hold the running sum/count instead of a score/streak (no new columns --
see the comments at both write sites in `actions.ts` and
`initial-state.ts`).

**The operator's own "Session Heat Map" toggle is a live, session-scoped,
best-effort view**, not authoritative: `OperatorState.gamePitchLog`
accumulates every pitch logged this game (seeded from a fresh `pitches`
fetch on load, appended to locally as pitches are logged) and is never
retroactively pruned if an at-bat is later undone. It exists purely as a
quick in-game glance for the operator; the real heat maps (player/team/
pitcher pages) always read fresh from the `pitches`/`at_bats` tables, so
an undone pitch never contaminates the real stats -- only this one
session-local, non-authoritative view.

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
