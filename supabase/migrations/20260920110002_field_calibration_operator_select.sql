-- Feature 1 (fielding-play logging batch): the operator screen (which an
-- operator, not just a coach, can be signed in as) now reads
-- field_calibration to auto-suggest a fielder from where the ball was
-- tapped -- the coach-only "for all" policy from the calibration-tool
-- migration silently blocked that read for an operator-role user. Splits
-- back into two policies: select for coach or operator (whoever's
-- actually running the live game screen), write still coach-only (the
-- calibration tool itself stays a coach-only route).
drop policy if exists "field_calibration: coach only" on public.field_calibration;

create policy "field_calibration: coach/operator select"
  on public.field_calibration for select
  using (public.my_role() in ('coach', 'operator') and team_id = public.my_team_id());

create policy "field_calibration: coach write"
  on public.field_calibration for insert
  with check (public.my_role() = 'coach' and team_id = public.my_team_id());

create policy "field_calibration: coach update"
  on public.field_calibration for update
  using (public.my_role() = 'coach' and team_id = public.my_team_id())
  with check (public.my_role() = 'coach' and team_id = public.my_team_id());

create policy "field_calibration: coach delete"
  on public.field_calibration for delete
  using (public.my_role() = 'coach' and team_id = public.my_team_id());
