// Free preview batch: everything the preview touches (spray chart,
// KAIROS, the banner) reads from this one file, so the window can be
// changed or ended by editing these two constants in one place.
export const FREE_PREVIEW_ENDS = "2026-11-14";
export const FREE_PREVIEW_KAIROS_MESSAGES = 5;

// Dubai (Asia/Dubai) is UTC+4 year-round, no DST -- a fixed offset is
// exact and needs no timezone library.
const DUBAI_UTC_OFFSET = "+04:00";

export function isFreePreviewActive(now: Date = new Date()): boolean {
  const endOfDayDubai = new Date(`${FREE_PREVIEW_ENDS}T23:59:59.999${DUBAI_UTC_OFFSET}`);
  return now.getTime() <= endOfDayDubai.getTime();
}
