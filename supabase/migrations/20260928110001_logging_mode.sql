-- Quick Mode batch: which of the two operator logging modes this game
-- uses, set once at Start Game and never changed mid-game (switching
-- mid-game would leave a game with a mix of pitch-detailed and
-- pitch-free at-bats, which none of the "what's available" framing in
-- the request accounts for).
alter table public.games add column if not exists logging_mode text default 'full'
check (logging_mode in ('full', 'quick'));
