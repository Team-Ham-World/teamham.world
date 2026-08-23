import Link from "next/link";

import { MEMBERS } from "@/data/members";
import { memberPath } from "@/lib/site";

/**
 * The `Who` section, and the route into member pages.
 *
 * Without this the pages are unreachable: `/m/<slug>` is linked from nowhere
 * else on the site, so a visitor could only arrive by typing the URL. The shelf
 * answers "what is HAM making"; this answers "who is making it", and hands the
 * visitor onward to whatever that member runs themselves.
 *
 * The section heading lives here rather than in `page.tsx` — unlike the shelf,
 * this one legitimately has nothing to show while the catalog is empty, and the
 * heading has to disappear with it. A "Who" rule over a blank rail is precisely
 * the placeholder WEBSITE.md §10 forbids, so the whole section is one unit that
 * either renders with content or does not render at all.
 */
export function MemberDirectory() {
  if (MEMBERS.length === 0) {
    return null;
  }

  return (
    <section id="who" aria-labelledby="who-heading" className="mt-20 sm:mt-28">
      <h2
        id="who-heading"
        className="font-display relative inline-block text-3xl sm:text-4xl"
      >
        Who
        {/* Hand-drawn underline — decorative accent, carries no meaning. */}
        <svg
          aria-hidden="true"
          viewBox="0 0 120 8"
          preserveAspectRatio="none"
          className="absolute -bottom-2 left-0 h-2 w-full text-decorative-red"
        >
          <path
            d="M2 5 C 26 1, 42 8, 64 4 S 100 2, 118 6"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </h2>

      <ul className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {MEMBERS.map((member) => (
          <li key={member.slug} className="flex">
            <Link
              href={memberPath(member.slug)}
              className="flex w-full flex-col border-2 border-ink bg-surface p-5 shadow-[6px_6px_0_0_var(--color-ink)] transition-[transform,background-color] hover:-translate-y-0.5 hover:bg-paper active:translate-x-0.5 active:translate-y-0.5"
            >
              <span className="font-display text-2xl leading-tight">
                {member.name}
              </span>

              {member.blurb ? (
                <span className="mt-3 line-clamp-3 text-sm leading-relaxed text-muted">
                  {member.blurb}
                </span>
              ) : null}

              {/*
                `mt-auto` pins this to the bottom of the tallest card in the
                row, so the arrows line up across a grid of uneven blurbs.
              */}
              <span className="mt-auto pt-5 text-xs font-bold tracking-[0.14em] text-interactive-blue uppercase">
                Their page{" "}
                <span aria-hidden="true" className="inline-block">
                  &#8594;
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
