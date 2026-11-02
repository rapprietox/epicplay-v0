-- Free preview batch: a lifetime (not monthly) counter for the free
-- KAIROS access offered to locked players while src/lib/free-preview.ts's
-- isFreePreviewActive() is true. Deliberately separate from
-- kairos_messages_used/kairos_messages_reset_date (the Pro 20/month
-- counter, 20260929120001_players_kairos_and_atbats_situational.sql) --
-- the free preview's cap is a flat FREE_PREVIEW_KAIROS_MESSAGES for the
-- whole preview window and never resets, so it can't share a column with
-- a counter that resets monthly. See src/lib/kairos-credits.ts.
alter table public.players add column if not exists free_preview_kairos_used integer not null default 0;

comment on column public.players.free_preview_kairos_used is
  'Messages sent to KAIROS via the free preview (locked players, while src/lib/free-preview.ts''s isFreePreviewActive() is true), capped at FREE_PREVIEW_KAIROS_MESSAGES. Never resets -- a one-time allowance for the life of the preview window, not a monthly credit.';
