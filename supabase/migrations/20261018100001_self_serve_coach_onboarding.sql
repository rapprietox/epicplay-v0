-- Launch-audit Fix 1: self-serve coach onboarding. Previously team
-- creation and the first coach/role assignment were SQL-editor-only
-- (see supabase/README.md's manual process) -- a brand-new coach had
-- no way to get off /pending themselves. This adds the minimum RLS
-- needed for a signed-in, not-yet-assigned user to create their own
-- team and promote themselves to its coach, without opening a general
-- "anyone can insert a team" or "anyone can become a coach" hole.
--
-- created_by closes the obvious abuse case: without it, a self-serve
-- "become coach of team X" policy would have to accept an arbitrary
-- existing team_id from the client, letting any unassigned user claim
-- coach of someone else's already-created team. Scoping the profiles
-- update to "team_id must be a team YOU created" (verified via this
-- column, not just trusted from the client) means the only team a
-- user can self-promote into is one they just inserted themselves.
alter table public.teams add column if not exists created_by uuid references auth.users (id) default auth.uid();

comment on column public.teams.created_by is
  'The auth.users id that created this team via self-serve onboarding. Null for teams created the old way (manual SQL) -- only used to scope the self-serve profiles update policy below, not read anywhere else.';

create policy "teams: self-serve creation for unassigned users"
  on public.teams for insert
  with check (
    created_by = auth.uid()
    and exists (select 1 from public.profiles where id = auth.uid() and team_id is null)
  );

-- Scoped narrowly: only your OWN profile, only while you don't already
-- belong to a team, and the resulting row must become role='coach' of
-- a team you created (see created_by above). Setting players.player_id
-- afterward (the optional "I'm also a player" case) doesn't need a
-- second new policy -- the existing "profiles: coach updates team"
-- policy already covers it, since by that second call the caller's
-- own my_role()/my_team_id() already reflect this update.
create policy "profiles: self-serve coach onboarding"
  on public.profiles for update
  using (id = auth.uid() and team_id is null)
  with check (
    id = auth.uid()
    and role = 'coach'
    and team_id in (select id from public.teams where created_by = auth.uid())
  );
