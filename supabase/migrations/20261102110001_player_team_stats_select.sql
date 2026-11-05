-- Player team-view batch: a player can already select games/players/
-- lineup/seasons/opponents team-wide (see the original migrations for
-- each table) -- at_bats, stolen_bases, and game_events are the three
-- tables where a player's own existing SELECT policy is scoped to
-- "rows about me" (player_id = my_player_id(), or an at_bats join for
-- pitches) rather than "rows for my team." That's exactly right for
-- the operator-facing write side (a player never writes these), but it
-- blocks the new read-only Team section (Team Leaders board, team-wide
-- stolen-base/EPS totals) from ever seeing a teammate's rows -- RLS
-- silently returns zero rows for everyone but the signed-in player,
-- not an error, so this would look like "it works" with one player's
-- own data and quietly under-report the moment a second player's
-- stats are expected to show.
--
-- These three policies are purely additive -- the existing
-- "...: player selects own" policies are untouched (now redundant,
-- since the new one is a superset for a player, but harmless to leave
-- as documentation of the original, narrower intent). Postgres ORs
-- permissive policies together for the same command, so adding a
-- broader SELECT policy only ever grants more, never revokes the
-- existing one. Shape mirrors each table's own existing
-- "...: coach/operator select team" policy exactly, with the role
-- check swapped to 'player' -- same team-scoping join, not a new
-- pattern.
--
-- Written idempotently (drop policy if exists before each create) so
-- it's safe to re-run.

drop policy if exists "at_bats: player selects team" on public.at_bats;
create policy "at_bats: player selects team"
  on public.at_bats for select
  using (
    public.my_role() = 'player'
    and exists (
      select 1 from public.games g
      where g.id = at_bats.game_id and g.team_id = public.my_team_id()
    )
  );

drop policy if exists "stolen_bases: player selects team" on public.stolen_bases;
create policy "stolen_bases: player selects team"
  on public.stolen_bases for select
  using (
    public.my_role() = 'player'
    and exists (
      select 1 from public.games g
      where g.id = stolen_bases.game_id and g.team_id = public.my_team_id()
    )
  );

drop policy if exists "game_events: player selects team" on public.game_events;
create policy "game_events: player selects team"
  on public.game_events for select
  using (
    public.my_role() = 'player'
    and exists (
      select 1 from public.games g
      where g.id = game_events.game_id and g.team_id = public.my_team_id()
    )
  );
