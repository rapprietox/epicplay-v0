-- Launch-capture batch: the hero/Founding-access lead form now also
-- asks for an optional WhatsApp number and an explicit opt-in checkbox
-- for the WhatsApp community list, plus a new "parent" role option.
-- Nullable/defaulted so every pre-existing row (none of which ever had
-- a phone number or an opt-in choice) reads as "no phone given" / "not
-- opted in," never a false opt-in.
alter table public.leads add column if not exists phone text;
alter table public.leads add column if not exists whatsapp_optin boolean not null default false;

comment on column public.leads.phone is
  'Optional WhatsApp/contact phone number, loosely validated client+server side (digits, +, spaces only). Null for every lead captured before this column existed.';
comment on column public.leads.whatsapp_optin is
  'True only if the visitor explicitly checked "Add me to the EpicPlay WhatsApp community" -- defaults to false, never implied by giving a phone number.';

-- "parent" is a new self-reported role option on the launch-page form
-- (Coach / Parent / Player / League organizer) -- added to the existing
-- check constraint rather than replacing it, since 'operator' stays a
-- valid historical value for every lead captured before this batch
-- (the launch form itself just no longer offers it as a choice).
alter table public.leads drop constraint if exists leads_role_check;
alter table public.leads add constraint leads_role_check
  check (role in ('coach', 'operator', 'player', 'league_organizer', 'parent'));

-- Video-visibility fix (same day): the hero now carries a second,
-- lighter-weight copy of this form with name + email only, per the
-- fix request -- it never collects a role at all. role was `not null`
-- since the original leads table, which would reject that submission
-- outright. Dropped to nullable; a plain `check (role in (...))`
-- constraint already treats NULL as satisfying the check (SQL's normal
-- three-valued-logic behavior), so the constraint above needs no
-- further change for this.
alter table public.leads alter column role drop not null;

-- Needed for "skip a duplicate email" in submitLead(). The anon
-- INSERT-only RLS policy on this table (see 20261030100001_leads.sql)
-- means a server action can't SELECT to check for an existing email
-- first without either a new, email-enumerable SELECT policy or
-- reaching for the service-role client outside its one designated
-- module (src/lib/supabase/service-role.ts). A unique index instead
-- lets the insert itself fail on a duplicate (Postgres error 23505),
-- which submitLead() catches and treats as "already on the list," not
-- an error -- no RLS loosening needed.
create unique index if not exists leads_email_unique_idx on public.leads (lower(email));
