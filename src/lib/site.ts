/**
 * Member page addressing.
 *
 * A member page is an ordinary page on the apex, at `/m/<slug>`. The matching
 * `<slug>.teamham.world` subdomain is delegated to the member's own deployment
 * and is not served by this app — so nothing here may assume the two are the
 * same origin.
 */
export function memberPath(slug: string): string {
  return `/m/${slug}`;
}

/**
 * The bare hostname of an absolute URL, for showing a visitor where an outbound
 * link actually goes. Returns null for anything unparseable, so a malformed
 * catalog entry drops the hint rather than throwing.
 */
export function displayHostname(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}
