-- Profiles: bridges auth.users to a role (operator/player/coach), a team,
-- and (for players) the players row that owns their stats.
-- Not part of the schema the user dictated verbatim, but required for
-- role-based access control -- there is otherwise nowhere to store "role".
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  role text not null default 'player' check (role in ('operator', 'player', 'coach')),
  team_id uuid references public.teams (id) on delete set null,
  -- players doesn't exist yet at this point in the migration order; the FK
  -- for this column is added in 20260907120004_players.sql once it does.
  player_id uuid,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Auto-create a profile row on first Google sign-in. Defaults to role
-- 'player' with no team/player link -- a coach must assign team_id, role,
-- and (for players) player_id manually via SQL/dashboard for V0, since
-- there is no admin UI yet.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Security-definer helpers so RLS policies elsewhere can read the caller's
-- role/team/player without re-triggering RLS on profiles (which would
-- recurse).
create or replace function public.my_role()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.my_team_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select team_id from public.profiles where id = auth.uid();
$$;

create or replace function public.my_player_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select player_id from public.profiles where id = auth.uid();
$$;

-- Profiles policies
create policy "profiles: self select"
  on public.profiles for select
  using (id = auth.uid());

create policy "profiles: coach selects team"
  on public.profiles for select
  using (public.my_role() = 'coach' and team_id = public.my_team_id());

create policy "profiles: coach updates team"
  on public.profiles for update
  using (public.my_role() = 'coach' and team_id = public.my_team_id())
  with check (public.my_role() = 'coach' and team_id = public.my_team_id());
