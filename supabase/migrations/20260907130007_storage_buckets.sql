-- Private buckets for season schedule PDFs and opponent lineup photos.
-- Objects are stored under a `${team_id}/...` path, and RLS checks that
-- first path segment against the caller's own team -- so uploads/reads
-- stay scoped per team the same way every other table does.
insert into storage.buckets (id, name, public)
values ('season-schedules', 'season-schedules', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('opponent-photos', 'opponent-photos', false)
on conflict (id) do nothing;

create policy "season-schedules: coach/operator read/write own team"
  on storage.objects for all
  using (
    bucket_id = 'season-schedules'
    and public.my_role() in ('coach', 'operator')
    and (storage.foldername(name))[1] = public.my_team_id()::text
  )
  with check (
    bucket_id = 'season-schedules'
    and public.my_role() in ('coach', 'operator')
    and (storage.foldername(name))[1] = public.my_team_id()::text
  );

create policy "opponent-photos: coach/operator read/write own team"
  on storage.objects for all
  using (
    bucket_id = 'opponent-photos'
    and public.my_role() in ('coach', 'operator')
    and (storage.foldername(name))[1] = public.my_team_id()::text
  )
  with check (
    bucket_id = 'opponent-photos'
    and public.my_role() in ('coach', 'operator')
    and (storage.foldername(name))[1] = public.my_team_id()::text
  );
