import Link from "next/link";

import { HamWordmark } from "@/components/ham-wordmark";
import { MemberBadge } from "@/components/member-badge";

/**
 * Site header.
 *
 * The wordmark sits here rather than inside the hero so the mark — and a way
 * back home — travels with every page. The 2px rule under it mirrors the rule
 * above the footer, which is what makes the two ends of the page read as the
 * same sheet of paper.
 *
 * `MemberBadge` resolves the session in the browser, so putting it in the
 * shared layout does not make the pages under it dynamic.
 */
export function SiteNav() {
  return (
    <header className="mx-auto w-full max-w-5xl px-5 sm:px-8">
      <div className="flex items-center justify-between gap-4 border-b-2 border-ink py-4">
        <Link
          href="/"
          aria-label="HAM &#8212; home"
          className="shrink-0 transition-transform hover:-translate-y-0.5"
        >
          <HamWordmark className="h-11 w-auto text-ink sm:h-[3.25rem]" />
        </Link>

        <MemberBadge />
      </div>
    </header>
  );
}
