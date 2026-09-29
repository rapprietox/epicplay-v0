-- Clubhouse Pro spray chart batch: a player viewing their own Clubhouse
-- spray chart needs to read their team's field_calibration, same as the
-- operator's field diagram already does. Extends the existing
-- coach/operator select policy (20260920110002_field_calibration_operator_select.sql)
-- to include player -- write stays coach-only.
drop policy if exists "field_calibration: coach/operator select" on public.field_calibration;

create policy "field_calibration: coach/operator/player select"
  on public.field_calibration for select
  using (public.my_role() in ('coach', 'operator', 'player') and team_id = public.my_team_id());
