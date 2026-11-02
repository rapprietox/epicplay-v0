-- Team activity batch: coach-only "who's online / last seen" panel.
--
-- Realtime Presence itself is ephemeral (no row is ever written for
-- "online now" -- ending a browser session simply drops out of the
-- channel) -- the only thing persisted to Postgres is `last_seen_at`,
-- per the request's own "never store anything beyond last_seen_at"
-- scoping. Written client-side at most once every 5 minutes (see
-- src/components/presence-tracker.tsx), via the security-definer
-- touch_last_seen() function below rather than a direct UPDATE --
-- `profiles` has no self-update RLS policy at all (only "coach updates
-- team", see 20260907120002_profiles.sql), and adding a broad one just
-- for this one column would let a player rewrite other fields on their
-- own profile too. A security-definer function scoped to exactly
-- `last_seen_at` on exactly auth.uid()'s own row is the same minimal,
-- narrowly-scoped pattern this migration's own my_role()/my_team_id()
-- helpers already use.
alter table public.profiles add column if not exists last_seen_at timestamptz;

comment on column public.profiles.last_seen_at is
  'Updated by touch_last_seen(), at most once every 5 minutes per session (see src/components/presence-tracker.tsx). Powers the "last seen" half of the coach-only Team Activity card -- src/app/coach/team-activity.tsx -- for whichever team members are not currently online via Presence.';

create or replace function public.touch_last_seen()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles set last_seen_at = now() where id = auth.uid();
end;
$$;

grant execute on function public.touch_last_seen() to authenticated;

-- Realtime Presence/Broadcast Authorization: without this, a private
-- channel's presence state is enforced purely client-side (our own UI
-- just never renders it for a player) -- which only hides it in OUR
-- app's own code, not from anyone who opens devtools and subscribes to
-- the channel topic directly with their own valid session, since Realtime
-- would otherwise broadcast presence diffs to any subscriber holding a
-- valid JWT. These RLS policies on realtime.messages are Supabase's own
-- server-side enforcement point for private channels (channel created
-- with `{config: {private: true}}` on both the tracking and the
-- listening side -- see presence-tracker.tsx / team-activity-client.tsx) --
-- this is what actually satisfies "enforce it on the server, never send
-- presence data to players," not just a client-side rendering choice.
--
-- Topic convention: "team-presence:<team_id>". realtime.topic() reads
-- the topic of the channel the client is trying to join; split_part
-- pulls the team_id back out of it to compare against the caller's own
-- team (via public.profiles, auth.uid()).
alter table realtime.messages enable row level security;

drop policy if exists "team presence: members can send their own presence" on realtime.messages;
create policy "team presence: members can send their own presence"
  on realtime.messages for insert
  to authenticated
  with check (
    realtime.topic() like 'team-presence:%'
    and split_part(realtime.topic(), ':', 2) = (select team_id::text from public.profiles where id = auth.uid())
  );

drop policy if exists "team presence: only coaches receive presence" on realtime.messages;
create policy "team presence: only coaches receive presence"
  on realtime.messages for select
  to authenticated
  using (
    realtime.topic() like 'team-presence:%'
    and split_part(realtime.topic(), ':', 2) = (select team_id::text from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) = 'coach'
  );
