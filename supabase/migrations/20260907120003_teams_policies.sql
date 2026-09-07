-- Teams policies (split from the table creation because they depend on the
-- my_role()/my_team_id() helpers defined in the profiles migration).
create policy "teams: members select"
  on public.teams for select
  using (id = public.my_team_id());

create policy "teams: coach updates own team"
  on public.teams for update
  using (public.my_role() = 'coach' and id = public.my_team_id())
  with check (public.my_role() = 'coach' and id = public.my_team_id());

-- Team creation and player/coach/operator onboarding for V0 is done via the
-- Supabase SQL editor / service role, not through client-side policies.
