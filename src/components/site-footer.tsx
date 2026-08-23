/**
 * The footer rule and credit line.
 *
 * The 2px rule above it mirrors the rule under the site header, which is what
 * makes the two ends of the page read as the same sheet of paper. Member pages
 * carry the identical line: a member subdomain is still teamham.world.
 */
export function SiteFooter() {
  return (
    <footer className="mx-auto w-full max-w-5xl px-5 pb-12 sm:px-8">
      <div className="border-t-2 border-ink pt-6 text-sm tracking-wide text-muted">
        teamham.world &#183; made by HAM
      </div>
    </footer>
  );
}
