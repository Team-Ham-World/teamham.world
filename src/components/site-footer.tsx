import Link from "next/link";

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
      <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4 border-t-2 border-ink pt-6 text-sm tracking-wide text-muted">
        <p>teamham.world &#183; made by HAM</p>
        <nav aria-label="Legal" className="flex items-center gap-4 font-bold">
          <Link
            href="/privacy"
            className="text-interactive-blue underline decoration-2 underline-offset-4"
          >
            Privacy
          </Link>
          <Link
            href="/terms"
            className="text-interactive-blue underline decoration-2 underline-offset-4"
          >
            Terms
          </Link>
        </nav>
      </div>
    </footer>
  );
}
