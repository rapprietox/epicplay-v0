-- KAIROS batch: required beyond "no new database tables needed" -- Tool
-- 1's own example ("best hitter against left-handed pitchers") and Tool
-- 4's own example ("lineup against a right-handed pitcher") both need to
-- know an OPPOSING pitcher's throwing hand, and nothing in this schema
-- tracks that at all (opponent_players has no hand column; the photo
-- import that populates it has no way to read a throwing arm off a
-- lineup card anyway). Unlike players.throwing_hand (default 'R', a
-- reasonable assumption for our own real roster), this is left with no
-- default -- presenting a guessed hand for an opponent as fact would be
-- worse than an honest "unknown." KAIROS's stats-query tool checks for
-- this being null and says so rather than fabricating a split; there is
-- no UI yet to set it (a coach would need to via Supabase directly, same
-- as the rest of this app's "no admin UI yet" pattern), so real
-- L/R-vs-opposing-pitcher data will be empty until that's built.
alter table public.opponent_players add column if not exists throwing_hand char(1) default null;
alter table public.opponent_players drop constraint if exists opponent_players_throwing_hand_check;
alter table public.opponent_players add constraint opponent_players_throwing_hand_check
  check (throwing_hand is null or throwing_hand in ('L', 'R'));
