-- Field calibration tool: one-time mapping of the two field images
-- (field-2d.png, field-3d.png) to the 0-100 at_bats.field_x/field_y
-- coordinate system, so a future spray chart can place a ball on the
-- actual image via interpolation between these 7 anchor points instead
-- of guessing. This migration only creates the table -- the spray chart
-- itself is a separate, later piece of work.
create table if not exists public.field_calibration (
  id uuid default gen_random_uuid() primary key,
  team_id uuid references public.teams(id) on delete cascade,
  field_type text check (field_type in ('2d', '3d')),
  calibration_points jsonb,
  created_at timestamptz default now(),
  unique(team_id, field_type)
);

alter table public.field_calibration enable row level security;

-- Coach-only, same condition for read and write -- this is explicitly a
-- coach setup tool (unlike players/games/lineup, which any team member
-- can at least read), and nothing else reads from this table yet, so one
-- "for all" policy covers select too rather than needing a second policy
-- with an identical condition.
create policy "field_calibration: coach only"
  on public.field_calibration for all
  using (public.my_role() = 'coach' and team_id = public.my_team_id())
  with check (public.my_role() = 'coach' and team_id = public.my_team_id());
