-- Fix 3: batter/pitcher stance, so the operator screen can show a
-- quick L/R indicator without the operator having to remember or ask.
alter table public.players add column if not exists batting_hand char(1) default 'R';
alter table public.players add column if not exists throwing_hand char(1) default 'R';

alter table public.players drop constraint if exists players_batting_hand_check;
alter table public.players add constraint players_batting_hand_check
  check (batting_hand is null or batting_hand in ('L', 'R', 'S'));

alter table public.players drop constraint if exists players_throwing_hand_check;
alter table public.players add constraint players_throwing_hand_check
  check (throwing_hand is null or throwing_hand in ('L', 'R'));
