import "server-only";

import { isValidMemberSlug } from "@/lib/members/model";

/**
 * Coarse signal that a published V2 row could not be rendered safely.
 *
 * The public slug is the entire payload. Do not add document content, theme
 * values, account details, validation errors, or viewer state here.
 */

export const INVALID_PUBLISHED_V2_DIAGNOSTIC_CAP = 20;

// Insertion order is recency order. A Map gives us a tiny LRU without allowing
// a process that sees unbounded distinct slugs to retain them forever.
const recentSlugs = new Map<string, true>();

export interface InvalidPublishedV2Diagnostic {
  slug: string;
}

export type InvalidPublishedV2Sink = (
  event: InvalidPublishedV2Diagnostic,
) => void;

const defaultSink: InvalidPublishedV2Sink = (event) => {
  console.error("[member-page] published V2 page failed closed", {
    slug: event.slug,
  });
};

export function recordInvalidPublishedV2Read(
  slug: string,
  sink: InvalidPublishedV2Sink = defaultSink,
): InvalidPublishedV2Diagnostic {
  const event = { slug };

  // Invalid route segments are not published-row failures and must not enter
  // either process memory or logs. The route checks this too; keeping the guard
  // here makes the diagnostic safe when called from another server path.
  if (!isValidMemberSlug(slug)) return event;

  const seen = recentSlugs.has(slug);
  if (seen) {
    recentSlugs.delete(slug);
    recentSlugs.set(slug, true);
  } else {
    if (recentSlugs.size >= INVALID_PUBLISHED_V2_DIAGNOSTIC_CAP) {
      const oldest = recentSlugs.keys().next().value;
      if (oldest !== undefined) recentSlugs.delete(oldest);
    }
    recentSlugs.set(slug, true);
  }

  if (!seen) {
    try {
      sink(event);
    } catch {
      // Diagnostics must never replace the branded not-found response.
    }
  }

  return event;
}

/** Test seam. Not used by the route. */
export function resetInvalidPublishedV2Diagnostics(): void {
  recentSlugs.clear();
}
