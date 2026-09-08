# Database migrations

`migrations/*.sql` are the canonical, ordered migrations (also what
`supabase db push` will pick up once the CLI is linked to the project with
`supabase link --project-ref <ref>`).

For now (no DB password on hand), apply them by hand:

- **Fresh project, nothing applied yet:** paste `manual_apply.sql` (every
  migration concatenated, in order) into Supabase Dashboard → **SQL
  Editor** → **New query** → **Run**.
- **Sprint 1 already applied, only need Sprint 2:** paste
  `manual_apply_sprint2.sql` instead (just the `2026090713*` migrations:
  seasons, opponents, opponent_players, the games/at_bats column
  additions, stolen_bases, and the two storage buckets).
- **Sprints 1-2 already applied, only need Sprint 3:** paste
  `manual_apply_sprint3.sql` instead (all `20260908*` migrations: the
  at_bats draft/confirmed lifecycle, `game_state`, `substitutions`,
  `game_events`, the `games` logging-accuracy/notes columns, enabling
  Realtime on `games`/`at_bats`/`game_state`, double-play + fielding-credit
  columns on `at_bats`, and attribution columns on `game_events`).
- **Sprint 3's base already applied (the `2026090814*` migrations),
  only need the later double-play/fielding-credit follow-up:** paste
  `manual_apply_sprint3b.sql` instead (just the two `2026090815*`
  migrations) -- re-running the full `manual_apply_sprint3.sql` here would
  error on tables/policies that already exist.

Then confirm in **Table Editor** that `teams`, `profiles`, `players`,
`games`, `lineup`, `at_bats`, `pitches`, `seasons`, `opponents`,
`opponent_players`, `stolen_bases`, `game_state`, `substitutions`, and
`game_events` all exist with RLS enabled, that `at_bats` has
`out_type`/`fielded_by_position`/`fielded_by_player_id`/
`fielded_by_opponent_player_id` columns and `game_events` has
`player_id`/`opponent_player_id`, in **Storage** that `season-schedules`
and `opponent-photos` buckets exist, and in **Database > Replication**
that `games`, `at_bats`, and `game_state` are enabled for the
`supabase_realtime` publication.

All `manual_apply*.sql` files are generated convenience copies -- if you
change a migration, regenerate them by concatenating `migrations/*.sql` (or
the relevant dated subset) in filename order rather than editing them
directly.

## After running the Sprint 1 migrations: create a team and onboard yourself

There's no admin UI yet, so the first team and the first coach/operator
role assignment happen by hand in the SQL Editor:

```sql
-- 1. Create a team
insert into teams (name) values ('Your Team Name') returning id;

-- 2. Sign in to the app once with Google (see main README) so a row
--    appears in public.profiles with your account's id, defaulted to
--    role 'player' with no team. Find it:
select id, email, role, team_id from profiles order by created_at desc;

-- 3. Promote yourself to coach and attach the team (use the ids from
--    steps 1 and 2):
update profiles
set role = 'coach', team_id = '<team-id-from-step-1>'
where id = '<your-profile-id-from-step-2>';
```

Repeat step 3 (with `role = 'operator'` or `role = 'player'`) for other
accounts as they sign in. A player's profile also needs `player_id` set to
their row in `players` once that roster row exists.
