-- At-bats now have a draft/confirmed lifecycle: a row is created the
-- moment a new batter steps up (before any pitch), so pitches always have
-- a valid at_bat_id to attach to immediately. "Confirm At-Bat" updates the
-- same row (result, hit_type, etc.) and stamps confirmed_at. Anything
-- reading at_bats for stats must filter `confirmed_at is not null` --
-- draft rows are logging-in-progress noise, not real plate appearances yet.
alter table public.at_bats
  alter column player_id drop not null,
  alter column result drop not null,
  add column if not exists confirmed_at timestamptz,
  -- 'hitting': player_id is our batter (pitcher_id null -- we don't track
  -- opposing pitchers). 'pitching': player_id is null (the batter is an
  -- opposing player -- tracked for on-screen display only, never
  -- persisted, since no stat we compute needs it), pitcher_id is our
  -- pitcher.
  add column if not exists mode text not null default 'hitting' check (mode in ('hitting', 'pitching'));

alter table public.at_bats drop constraint if exists at_bats_result_check;
alter table public.at_bats add constraint at_bats_result_check
  check (
    result is null or result in (
      'single', 'double', 'triple', 'hr', 'flyout', 'groundout',
      'lineout', 'strikeout', 'walk', 'hbp', 'error', 'fc'
    )
  );

create index if not exists at_bats_confirmed_at_idx on public.at_bats (game_id, confirmed_at);
