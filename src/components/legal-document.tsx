import type { ReactNode } from "react";

import { SiteFooter } from "@/components/site-footer";

export interface LegalSection {
  id: string;
  title: string;
  content: ReactNode;
}

interface LegalDocumentProps {
  documentCode: string;
  eyebrow: string;
  title: string;
  summary: string;
  lastUpdated: string;
  lastUpdatedIso: string;
  sections: LegalSection[];
}

/**
 * Shared long-form treatment for HAM's legal pages.
 *
 * The index card, numbered sections, hard rules, and offset shadow keep policy
 * copy inside the site's cut-and-paste visual system without sacrificing the
 * calm reading rhythm a long document needs.
 */
export function LegalDocument({
  documentCode,
  eyebrow,
  title,
  summary,
  lastUpdated,
  lastUpdatedIso,
  sections,
}: LegalDocumentProps) {
  return (
    <>
      <main className="mx-auto w-full max-w-5xl flex-1 px-5 pt-12 pb-24 sm:px-8 sm:pt-16">
        <header className="relative overflow-hidden border-2 border-ink bg-surface px-6 py-8 shadow-[7px_7px_0_0_var(--color-ink)] sm:px-10 sm:py-11">
          <p className="inline-flex -rotate-1 border-2 border-ink bg-paper px-3 py-1 text-[0.7rem] font-bold tracking-[0.18em] uppercase shadow-[3px_3px_0_0_var(--color-ink)] sm:text-xs">
            {eyebrow}
          </p>
          <h1 className="font-display mt-7 max-w-3xl text-4xl leading-none sm:text-5xl md:text-6xl">
            {title}
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted sm:text-xl">
            {summary}
          </p>
          <p className="mt-7 text-xs font-bold tracking-[0.16em] text-muted uppercase">
            Last updated{" "}
            <time dateTime={lastUpdatedIso} className="text-ink">
              {lastUpdated}
            </time>
          </p>

          <svg
            aria-hidden="true"
            viewBox="0 0 220 22"
            className="absolute right-5 bottom-5 hidden h-6 w-48 -rotate-2 text-decorative-red sm:block"
          >
            <path
              d="M3 14 C45 2 70 22 110 10 S180 5 217 15"
              fill="none"
              stroke="currentColor"
              strokeWidth="5"
              strokeLinecap="round"
            />
          </svg>
        </header>

        <div className="mt-16 lg:grid lg:grid-cols-[14rem_minmax(0,1fr)] lg:items-start lg:gap-12">
          <aside className="lg:sticky lg:top-8">
            <nav
              aria-label={`${title} contents`}
              className="border-2 border-ink bg-paper p-5 shadow-[4px_4px_0_0_var(--color-ink)]"
            >
              <p className="border-b-2 border-ink pb-3 text-xs font-bold tracking-[0.18em] text-muted uppercase">
                {documentCode}
              </p>
              <ol className="mt-4 space-y-3 text-sm leading-snug">
                {sections.map((section, index) => (
                  <li key={section.id} className="flex items-baseline gap-2.5">
                    <span
                      aria-hidden="true"
                      className="font-display w-5 shrink-0 text-xs text-decorative-red"
                    >
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <a
                      href={`#${section.id}`}
                      className="font-bold text-interactive-blue underline decoration-2 underline-offset-4"
                    >
                      {section.title}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          </aside>

          <article className="mt-14 border-t-2 border-ink pt-2 lg:mt-0 lg:border-t-0 lg:border-l-2 lg:pt-0 lg:pl-12">
            {sections.map((section, index) => (
              <section
                key={section.id}
                id={section.id}
                aria-labelledby={`${section.id}-heading`}
                className="scroll-mt-8 border-b-2 border-dashed border-ink/35 py-10 first:pt-4 last:border-b-0 last:pb-0 lg:first:pt-0"
              >
                <div className="flex items-baseline gap-4">
                  <span
                    aria-hidden="true"
                    className="font-display text-lg text-decorative-red"
                  >
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <h2
                    id={`${section.id}-heading`}
                    className="font-display text-2xl leading-tight sm:text-3xl"
                  >
                    {section.title}
                  </h2>
                </div>
                <div className="legal-copy mt-5 text-base leading-relaxed text-muted">
                  {section.content}
                </div>
              </section>
            ))}
          </article>
        </div>
      </main>

      <SiteFooter />
    </>
  );
}
