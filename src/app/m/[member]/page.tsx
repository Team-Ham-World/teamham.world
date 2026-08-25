import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { MemberEditor } from "@/components/member-editor";
import { ProjectArtwork, StatusStamp } from "@/components/project-visuals";
import { SiteFooter } from "@/components/site-footer";
import { getMemberPageForViewer } from "@/lib/members/dal";
import {
  resolveShowcase,
  type MemberPublicPage,
  type ResolvedShowcase,
} from "@/lib/members/model";
import { displayHostname, memberPath } from "@/lib/site";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ member: string }>;
}): Promise<Metadata> {
  const { member: slug } = await params;
  const result = await getMemberPageForViewer(slug);
  if (!result) return { title: "Member not found — HAM" };

  const { page } = result;
  const description = page.blurb ?? `${page.displayName} is a member of HAM.`;
  const url = memberPath(page.slug);
  return {
    title: `${page.displayName} — HAM`,
    description,
    alternates: { canonical: url },
    openGraph: {
      title: `${page.displayName} — HAM`,
      description,
      url,
      siteName: "HAM",
      type: "profile",
    },
  };
}
function ShowcasePanel({ showcase }: { showcase: ResolvedShowcase }) {
  return (
    <section aria-labelledby="showcase-heading" className="mt-16 lg:mt-0">
      <h2 id="showcase-heading" className="text-xs font-bold tracking-[0.18em] text-muted uppercase">
        Showcase
      </h2>
      <article className="card-tilt mt-4 border-2 border-ink bg-surface p-5 shadow-[6px_6px_0_0_var(--color-ink)] sm:p-6">
        <ProjectArtwork artwork={showcase.artwork} sizes="(min-width: 1024px) 540px, 100vw" />
        <div className="mt-6 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <h3 className="font-display text-2xl leading-tight md:text-3xl">{showcase.name}</h3>
          <StatusStamp status={showcase.status} />
        </div>
        <p className="mt-2 text-xs font-bold tracking-[0.18em] text-muted uppercase">{showcase.type}</p>
        <p className="mt-4 max-w-prose leading-relaxed text-muted">{showcase.shortDescription}</p>
        {showcase.publicUrl || showcase.repository ? (
          <ul className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            {showcase.publicUrl ? <li><a href={showcase.publicUrl} rel="noopener noreferrer" className="font-bold text-interactive-blue underline underline-offset-4">Visit</a></li> : null}
            {showcase.repository ? <li><a href={showcase.repository} rel="noopener noreferrer" className="font-bold text-interactive-blue underline underline-offset-4">Source</a></li> : null}
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
        aria-label={hostname ? `Visit site: ${hostname}` : undefined}
        className="inline-flex min-h-11 items-center gap-2 border-2 border-ink bg-ink px-6 py-3 text-sm font-bold tracking-wider text-paper uppercase shadow-[4px_4px_0_0_var(--color-muted)] transition-[transform,background-color,color] hover:-translate-y-0.5 hover:bg-surface hover:text-ink active:translate-x-0.5 active:translate-y-0.5"
      >
        Visit site <span aria-hidden="true">&#8594;</span>
      </a>
      {hostname ? <p className="mt-3 text-xs font-bold tracking-[0.14em] text-muted lowercase">{hostname}</p> : null}
    </div>
  );
}

function MemberIdentity({ member }: { member: MemberPublicPage }) {
  return (
    <div className="max-w-2xl">
      <p className="inline-flex -rotate-1 items-center border-2 border-ink bg-surface px-3 py-1 text-[0.7rem] font-bold tracking-[0.18em] text-ink uppercase shadow-[3px_3px_0_0_var(--color-ink)] sm:text-xs">
        HAM member
      </p>
      <h1 className="font-display relative mt-7 block w-fit text-4xl leading-[1.12] break-words sm:text-5xl">
        {member.displayName}
        <svg aria-hidden="true" viewBox="0 0 120 8" preserveAspectRatio="none" className="absolute -bottom-2 left-0 h-2 w-full text-decorative-red">
          <path d="M2 5 C 26 1, 42 8, 64 4 S 100 2, 118 6" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
      </h1>
      {member.blurb ? <p className="mt-8 text-lg leading-relaxed text-muted">{member.blurb}</p> : null}
      {member.websiteUrl ? <WebsiteCallToAction website={member.websiteUrl} /> : null}
    </div>
  );
}

export default async function MemberPage({
  params,
}: {
  params: Promise<{ member: string }>;
}) {
  await connection();
  const { member: slug } = await params;
  const result = await getMemberPageForViewer(slug);
  if (!result) notFound();

  const showcase = resolveShowcase(result.page.showcase);
  return (
    <>
      <main className="mx-auto w-full max-w-5xl flex-1 px-5 pt-12 pb-20 sm:px-8 sm:pt-16">
        {result.isOwner ? (
          <div className="mb-10 flex flex-wrap items-center justify-between gap-4 border-2 border-ink bg-surface px-4 py-3 shadow-[4px_4px_0_0_var(--color-ink)]">
            <p className="font-bold">
              {result.isPublished ? "This page is public." : "Only you and administrators can see this unpublished page."}
            </p>
            <a href="#edit-page" className="inline-flex min-h-11 items-center font-bold text-interactive-blue underline underline-offset-4">Edit page</a>
          </div>
        ) : null}

        {showcase ? (
          <div className="lg:grid lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-start lg:gap-14">
            <MemberIdentity member={result.page} />
            <ShowcasePanel showcase={showcase} />
          </div>
        ) : (
          <MemberIdentity member={result.page} />
        )}

        {result.isOwner ? <MemberEditor member={result.page} /> : null}
      </main>
      <SiteFooter />
    </>
  );
}
