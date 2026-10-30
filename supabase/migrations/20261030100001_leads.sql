-- Marketing-site conversion funnel: lead capture form. A visitor
-- submitting this form is never signed in (anon key only -- see
-- src/app/_marketing/actions.ts's submitLead), so this is the one
-- table in this schema that a genuinely anonymous request can write
-- to. Scoped as narrowly as that requires: anon can INSERT only --
-- no select/update/delete policy exists for anon (or anyone else),
-- which under RLS means those operations are simply denied, not
-- merely unused. Reading submitted leads happens from the Supabase
-- dashboard directly, not from the app.
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null,
  email text not null,
  role text not null check (role in ('coach', 'operator', 'player', 'league_organizer')),
  team_size integer,
  message text,
  source text not null default 'marketing_site'
);

comment on table public.leads is
  'Lead-capture submissions from the public marketing site. Anonymous INSERT only -- see the RLS policy below. No select/update/delete policy exists for any role.';
comment on column public.leads.role is
  'Self-reported role: coach, operator, player, or league_organizer. Matches the <select> options on the marketing lead form.';
comment on column public.leads.source is
  'Where the submission came from -- defaults to the marketing site''s own lead form; kept as a plain text column rather than an enum in case other lead sources are added later.';

alter table public.leads enable row level security;

create policy "leads: anon insert only"
  on public.leads for insert
  to anon
  with check (true);
