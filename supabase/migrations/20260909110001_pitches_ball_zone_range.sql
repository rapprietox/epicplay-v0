-- Fix 2: the strike zone grid grew a 16-cell outer "ball zone" ring
-- around the original 9-cell strike zone (see strike-zone-grid.tsx). A
-- tap in the ring stores a coordinate outside the original 0-100 range,
-- rather than remapping 0-100 to mean something new -- that would corrupt
-- every zone_x/zone_y value already on disk, all of which mean "position
-- within the strike zone." -50/150 comfortably covers the ring's actual
-- span (-16.67 to 116.67) with headroom.
alter table public.pitches drop constraint if exists pitches_zone_x_check;
alter table public.pitches add constraint pitches_zone_x_check
  check (zone_x is null or (zone_x >= -50 and zone_x <= 150));

alter table public.pitches drop constraint if exists pitches_zone_y_check;
alter table public.pitches add constraint pitches_zone_y_check
  check (zone_y is null or (zone_y >= -50 and zone_y <= 150));
