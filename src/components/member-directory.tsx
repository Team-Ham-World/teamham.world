import Link from "next/link";

import { MEMBERS } from "@/data/members";
import { memberPath } from "@/lib/site";

/**
 * The route into member pages.
 *
 * Without this the pages are unreachable: `/m/<slug>` is linked from nowhere
 * else on the site, so a visitor could only arrive by typing the URL. The shelf
 * answers "what is HAM making"; this answers "who is making it", and hands the
 * visitor onward to whatever that member runs themselves.
 *
 * Renders nothing when the catalog is empty, rather than an empty rail —
 * WEBSITE.md §10 forbids placeholder slots.
 */
export function MemberDirectory() {
  if (MEMBERS.length === 0) {
    return null;
  }

  return (
    <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
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
              `mt-auto` pins this to the bottom of the tallest card in the row,
              so the arrows line up across a grid of uneven blurbs.
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
  );
}
