# Database migrations

`migrations/*.sql` are the canonical, ordered migrations (also what
`supabase db push` will pick up once the CLI is linked to the project with
`supabase link --project-ref <ref>`).

For now (no DB password on hand), apply them by hand:

1. Open the Supabase Dashboard for this project → **SQL Editor** → **New query**.
2. Paste the contents of `manual_apply.sql` (all 8 migrations concatenated,
   in the order they must run) and click **Run**.
3. Confirm in **Table Editor** that `teams`, `profiles`, `players`, `games`,
   `lineup`, `at_bats`, and `pitches` all exist, each with RLS enabled.

`manual_apply.sql` is a generated convenience copy -- if you change a
migration, regenerate it by concatenating `migrations/*.sql` in filename
order rather than editing it directly.

## After running the migrations: create a team and onboard yourself

There's no admin UI yet (Sprint 1 is auth + schema only), so the first team
and the first coach/operator role assignment happen by hand in the SQL
Editor:

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
