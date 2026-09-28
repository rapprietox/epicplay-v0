-- Time-of-day/day-of-week filters batch: a proper structured time value
-- on games, distinct from the existing games.game_time (free text --
-- "6:00 PM" or "TBD", used for display since Sprint 2). start_time is
-- what the new "Time of day" filter actually reads.
alter table public.games add column if not exists start_time time default null;

-- Required beyond the literal request: without this, start_time is
-- inert for every game that already exists (nothing has ever written to
-- it) and the whole "Time of day" filter would silently show no data at
-- all. game_time's real values turned out messier than
-- src/lib/time-options.ts's own "H:MM AM/PM" dropdown format suggests --
-- checked against the live data before writing this, and found
-- "H:MM a.m./p.m." (lowercase, with periods, from the AI PDF-extraction
-- path) alongside the dropdown's own format, plus occasional bare
-- "H:MM" with no AM/PM marker at all. Periods are stripped and the
-- string upper-cased before matching/parsing so both real shapes
-- resolve the same way; a bare "H:MM" is genuinely ambiguous (could be
-- either AM or PM) and is left unparsed rather than guessed, same
-- treatment as "TBD" -- matching the app-side fallback's own
-- parseGameTimeText in src/lib/game-time-filters.ts, which keeps
-- handling future games the same way since no game-creation/edit form
-- was changed to write start_time going forward (see that file's own
-- comment for why).
update public.games
set start_time = to_timestamp(regexp_replace(upper(game_time), '\.', '', 'g'), 'HH12:MI AM')::time
where game_time is not null
  and regexp_replace(upper(game_time), '\.', '', 'g') ~ '^[0-9]{1,2}:[0-9]{2}\s*(AM|PM)$'
  and start_time is null;
