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

Then confirm in **Table Editor** that `teams`, `profiles`, `players`,
`games`, `lineup`, `at_bats`, `pitches`, `seasons`, `opponents`,
`opponent_players`, and `stolen_bases` all exist with RLS enabled, and in
**Storage** that `season-schedules` and `opponent-photos` buckets exist.

Both `manual_apply*.sql` files are generated convenience copies -- if you
change a migration, regenerate them by concatenating `migrations/*.sql` (or
just the `2026090713*` subset) in filename order rather than editing them
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
