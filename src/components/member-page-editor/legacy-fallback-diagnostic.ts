import "server-only";

/**
 * Coarse signal for how often the member route still falls back to the V1
 * presentation.
 *
 * The V2 rollout needs a way to tell whether the legacy path is dead before it
 * is deleted, and route-level tests cannot answer that for real traffic. This
 * records the fact and nothing else.
 *
 * What it is allowed to contain: the slug, which is already in the public URL.
 * No path copy, display name, summary, blocks, socials, account id, session, or
 * any other member content. A diagnostic that quietly grows into a content log
 * is a privacy problem, so the payload is constructed here rather than passed
 * in.
 *
 * Noise is bounded two ways: a slug is counted once per process, and the log
 * line is emitted only for the first few distinct slugs.
 */

const LOGGED_SLUG_LIMIT = 20;

const seenSlugs = new Set<string>();

export interface LegacyFallbackDiagnostic {
  slug: string;
}

export type LegacyFallbackSink = (event: LegacyFallbackDiagnostic) => void;

const defaultSink: LegacyFallbackSink = (event) => {
  console.info("[member-page] legacy V1 fallback rendered", {
    slug: event.slug,
  });
};

/**
 * Records one V1 fallback render.
 *
 * Never throws and never blocks the render: a broken diagnostic must not take
 * a member's page down with it.
 */
export function recordLegacyFallbackRender(
  slug: string,
  sink: LegacyFallbackSink = defaultSink,
): LegacyFallbackDiagnostic {
  const firstTimeForSlug = !seenSlugs.has(slug);
  if (firstTimeForSlug) seenSlugs.add(slug);

  const event: LegacyFallbackDiagnostic = { slug };

  if (firstTimeForSlug && seenSlugs.size <= LOGGED_SLUG_LIMIT) {
    try {
      sink(event);
    } catch {
      // A diagnostic is never worth failing a page render for.
    }
  }

  return event;
}

/** Test seam. Not used by the route. */
export function resetLegacyFallbackDiagnostics(): void {
  seenSlugs.clear();
}
