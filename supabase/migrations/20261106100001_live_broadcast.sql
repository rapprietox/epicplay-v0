-- Phase 1 live broadcast: a coach-generated, unguessable share link that
-- exposes a read-only, no-login public view of one game
-- (/live/[token] -> /api/live/[token]). No new table -- the token lives
-- directly on the game it belongs to, since a game has at most one
-- active share link at a time (generating a new one overwrites/
-- invalidates the old one for free, just by being the same column).
--
-- Deliberately NO public select policy here. The public page and its
-- API route never talk to Supabase directly with the anon key -- the
-- API route (src/app/api/live/[token]/route.ts) uses the service-role
-- client and hand-picks exactly which columns it returns, which is what
-- actually enforces "never return emails, account ids, notes, stats, or
-- any other game." Adding a public RLS policy here would create a
-- second, looser path to the same data and weaken that guarantee rather
-- than help it.
alter table public.games add column if not exists share_token text;

-- Not a `unique` column-level constraint deliberately -- Postgres unique
-- constraints treat every null as distinct from every other null (so
-- "unique" alone wouldn't stop every other nullable column from doing
-- that, but it already does; this is just making the *reasoning*
-- explicit), which is exactly what's needed here: most games have no
-- share link at all (share_token is null), and that must never collide
-- with another null, or with a different game's own token.
create unique index if not exists games_share_token_key
  on public.games (share_token)
  where share_token is not null;

-- Walk-up songs: schema groundwork only in this phase (per the request,
-- actual playback is out of scope) -- a nullable song title, shown as
-- plain text on the live page when set, never audio.
alter table public.players add column if not exists walk_up_song text;
