alter table public.games
  add column if not exists logging_accuracy_score numeric(5, 2),
  add column if not exists notes text;
