/**
 * Durable per-page mutation limits enforced by migration 0007.
 *
 * These are intentionally generous relative to the editor's normal cadence:
 * they bound direct/replayed requests without throttling the 800 ms autosave
 * loop or a small burst of upload finalization retries.
 */
export const MEMBER_PAGE_AUTOSAVE_RATE_LIMIT = {
  attempts: 120,
  windowSeconds: 60,
} as const;

export const MEMBER_PAGE_PUBLISH_RATE_LIMIT = {
  attempts: 10,
  windowSeconds: 300,
} as const;

export const MEMBER_PAGE_ASSET_FINALIZE_RATE_LIMIT = {
  attempts: 20,
  windowSeconds: 300,
} as const;
