import Link from "next/link";

import { SiteFooter } from "@/components/site-footer";

/**
 * Shown when `/m/<slug>` names nobody in the member catalog.
 *
 * It states only what is true — that there is no such page — and does not guess
 * at what the visitor meant. There is no member index to send them to yet, so
 * the shelf is the useful destination.
 */
export default function MemberNotFound() {
  return (
    <>
      <main className="mx-auto w-full max-w-5xl flex-1 px-5 pt-12 pb-20 sm:px-8 sm:pt-16">
        <div className="max-w-2xl">
          <p className="inline-flex -rotate-1 items-center border-2 border-dashed border-ink bg-paper px-3 py-1 text-[0.7rem] font-bold tracking-[0.18em] text-ink uppercase sm:text-xs">
            No such page
          </p>

          <h1 className="font-display mt-7 text-3xl leading-tight sm:text-4xl md:text-5xl">
            There&#8217;s no member page here.
          </h1>

          <p className="mt-6 text-lg leading-relaxed text-muted">
            This address doesn&#8217;t belong to a HAM member. It may have been
            mistyped, or the page may never have existed.
          </p>

          <Link
            href="/"
            className="mt-8 inline-flex items-center gap-2 border-2 border-ink bg-paper px-6 py-2.5 text-sm font-bold tracking-wider text-ink uppercase shadow-[3px_3px_0_0_var(--color-ink)] transition-[transform,background-color,color] hover:-translate-y-0.5 hover:bg-ink hover:text-paper active:translate-x-0.5 active:translate-y-0.5"
          >
            Back to the shelf
            <span aria-hidden="true">&#8594;</span>
          </Link>
        </div>
      </main>

      <SiteFooter />
    </>
  );
}
