-- Feature 1 (fielding-play logging batch): standard scorebook notation
-- ("6-4-3 DP", "5-3", "F8", "L7", "E5"), computed client-side from the new
-- tap-based fielding flow and stored once per play, on the batter's own
-- at_bats row.
alter table at_bats add column if not exists scorebook_notation text;
