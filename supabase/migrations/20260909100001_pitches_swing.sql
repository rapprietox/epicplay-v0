-- Whether the batter swung at this pitch. Nullable/additive: existing rows
-- stay null (unknown), only pitches logged by the new sequential operator
-- flow populate it. Lets a future Chase Rate / Contact Rate / real Whiff
-- Rate be computed, unlike the outcome column alone (see CLAUDE.md).
alter table public.pitches add column if not exists swing boolean;
