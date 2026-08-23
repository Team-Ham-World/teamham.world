import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ProjectArtwork, StatusStamp } from "@/components/project-visuals";
import { SiteFooter } from "@/components/site-footer";
import {
  findMember,
  MEMBERS,
  resolveShowcase,
  type Member,
  type ResolvedShowcase,
} from "@/data/members";
import { displayHostname, memberPath } from "@/lib/site";

/**
 * A member's page, at `/m/<slug>` on the apex.
 *
 * The matching `<slug>.teamham.world` subdomain is delegated to the member's
 * own deployment, so it is *their* site — the thing this page links out to, not
 * another address for this page.
 *
 * The layout is an editorial spread: identity on the left, the one showcase on
 * the right. Every part below the member's name is optional, because the
 * catalog only records facts a member has actually supplied — so the spread
 * collapses to a single centered column for a member with nothing but a name,
 * and never renders a placeholder standing in for missing content.
 */

/*
 * Catalogued members are prerendered by `generateStaticParams`; anything else
 * is rendered on demand so `notFound()` can reach `m/not-found.tsx`.
 *
 * `dynamicParams = false` was tried first and rejected: it refuses the param at
 * the routing layer, before the segment renders, so an unknown slug got the bare
 * global 404 instead of a page that says what went wrong and offers the shelf.
 * Serving that miss costs one lookup in an in-memory array.
 */
export const dynamicParams = true;

export function generateStaticParams() {
  return MEMBERS.map((member) => ({ member: member.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ member: string }>;
}): Promise<Metadata> {
  const { member: slug } = await params;
  const member = findMember(slug);

  if (!member) {
    return { title: "Member not found — HAM" };
  }

  // Falls back to the one fact that is always true of a catalog entry, rather
  // than to an invented summary.
  const description = member.blurb ?? `${member.name} is a member of HAM.`;
  // Resolved against `metadataBase` in the root layout.
  const url = memberPath(member.slug);

  return {
    title: `${member.name} — HAM`,
    description,
    alternates: { canonical: url },
    openGraph: {
      title: `${member.name} — HAM`,
      description,
      url,
      siteName: "HAM",
      type: "profile",
    },
  };
}

function ShowcasePanel({ showcase }: { showcase: ResolvedShowcase }) {
  const { name, shortDescription, type, status, publicUrl, repository } =
    showcase;

  return (
    <section aria-labelledby="showcase-heading" className="mt-16 lg:mt-0">
      <h2
        id="showcase-heading"
        className="text-xs font-bold tracking-[0.18em] text-muted uppercase"
      >
        Showcase
      </h2>

      <article className="card-tilt mt-4 border-2 border-ink bg-surface p-5 shadow-[6px_6px_0_0_var(--color-ink)] sm:p-6">
        <ProjectArtwork
          artwork={showcase.artwork}
          sizes="(min-width: 1024px) 540px, 100vw"
        />

        <div className="mt-6 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <h3 className="font-display text-2xl leading-tight md:text-3xl">
            {name}
          </h3>
          <StatusStamp status={status} />
        </div>

        <p className="mt-2 text-xs font-bold tracking-[0.18em] text-muted uppercase">
          {type}
        </p>

        <p className="mt-4 max-w-prose leading-relaxed text-muted">
          {shortDescription}
        </p>

        {publicUrl || repository ? (
          <ul className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            {publicUrl ? (
              <li>
                <a
                  href={publicUrl}
                  rel="noopener noreferrer"
                  className="font-bold text-interactive-blue underline underline-offset-4"
                >
                  Visit
                </a>
              </li>
            ) : null}
            {repository ? (
              <li>
                <a
                  href={repository}
                  rel="noopener noreferrer"
                  className="font-bold text-interactive-blue underline underline-offset-4"
                >
                  Source
                </a>
              </li>
            ) : null}
          </ul>
        ) : null}
      </article>
    </section>
  );
}

function WebsiteCallToAction({ website }: { website: string }) {
  const hostname = displayHostname(website);

  return (
    <div className="mt-9">
      <a
        href={website}
        rel="noopener noreferrer"
        // The visible label opens the accessible name, so naming the
        // destination here satisfies WCAG 2.5.3 while telling a screen reader
        // user where the link goes before they follow it.
        aria-label={hostname ? `Visit site: ${hostname}` : undefined}
        className="inline-flex items-center gap-2 border-2 border-ink bg-ink px-6 py-3 text-sm font-bold tracking-wider text-paper uppercase shadow-[4px_4px_0_0_var(--color-muted)] transition-[transform,background-color,color] hover:-translate-y-0.5 hover:bg-surface hover:text-ink active:translate-x-0.5 active:translate-y-0.5"
      >
        Visit site
        <span aria-hidden="true">&#8594;</span>
      </a>

      {hostname ? (
        <p className="mt-3 text-xs font-bold tracking-[0.14em] text-muted lowercase">
          {hostname}
        </p>
      ) : null}
    </div>
  );
}

function MemberIdentity({ member }: { member: Member }) {
  return (
    <div className="max-w-2xl">
      {/* Torn-tag eyebrow, the same one the home hero uses. */}
      <p className="inline-flex -rotate-1 items-center border-2 border-ink bg-surface px-3 py-1 text-[0.7rem] font-bold tracking-[0.18em] text-ink uppercase shadow-[3px_3px_0_0_var(--color-ink)] sm:text-xs">
        HAM member
      </p>

      {/*
        `block w-fit`, not `inline-block`: the eyebrow above is an inline-flex
        tag, so an inline-level heading shares its line and the two collide.
        Staying block-level keeps them stacked, and shrinking to fit keeps the
        underline the width of the name rather than the width of the column.
      */}
      <h1 className="font-display relative mt-7 block w-fit text-4xl leading-[1.12] break-words sm:text-5xl">
        {member.name}
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
      </h1>

      {member.blurb ? (
        <p className="mt-8 text-lg leading-relaxed text-muted">
          {member.blurb}
        </p>
      ) : null}

      {member.website ? <WebsiteCallToAction website={member.website} /> : null}
    </div>
  );
}

export default async function MemberPage({
  params,
}: {
  params: Promise<{ member: string }>;
}) {
  const { member: slug } = await params;
  const member = findMember(slug);

  if (!member) {
    notFound();
  }

  const showcase = resolveShowcase(member);

  return (
    <>
      <main className="mx-auto w-full max-w-5xl flex-1 px-5 pt-12 pb-20 sm:px-8 sm:pt-16">
        {showcase ? (
          <div className="lg:grid lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-start lg:gap-14">
            <MemberIdentity member={member} />
            <ShowcasePanel showcase={showcase} />
          </div>
        ) : (
          <MemberIdentity member={member} />
        )}
      </main>

      <SiteFooter />
    </>
  );
}
