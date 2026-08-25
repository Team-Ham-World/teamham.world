import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { MemberEditor } from "@/components/member-editor";
import { ProjectArtwork, StatusStamp } from "@/components/project-visuals";
import { SiteFooter } from "@/components/site-footer";
import { MemberSocialLinks } from "@/components/social-links";
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
    <div>
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

function MemberLinks({ member }: { member: MemberPublicPage }) {
  const hasSocialLinks = Object.keys(member.socialLinks).length > 0;
  if (!member.websiteUrl && !hasSocialLinks) return null;

  return (
    <div className="mt-9 flex flex-wrap items-start gap-4">
      {member.websiteUrl ? (
        <WebsiteCallToAction website={member.websiteUrl} />
      ) : null}
      {hasSocialLinks ? (
        <MemberSocialLinks
          displayName={member.displayName}
          links={member.socialLinks}
        />
      ) : null}
    </div>
  );
}

function EditPageLink({
  member,
  isEditing,
}: {
  member: MemberPublicPage;
  isEditing: boolean;
}) {
  const label = isEditing
    ? "Jump to the page editor"
    : `Edit ${member.displayName}'s page`;

  return (
    <Link
      href={isEditing ? "#edit-page" : `${memberPath(member.slug)}?edit=1#edit-page`}
      aria-label={label}
      title={label}
      className="inline-flex size-11 shrink-0 -rotate-2 items-center justify-center border-2 border-ink bg-surface text-interactive-blue shadow-[3px_3px_0_0_var(--color-ink)] transition-[transform,background-color,color,box-shadow] hover:-translate-y-0.5 hover:rotate-0 hover:bg-interactive-blue hover:text-paper active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="size-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m14.7 5.3 4 4" />
        <path d="M5 19l3.8-.8L19 8a1.9 1.9 0 0 0-3-3L5.8 15.2 5 19Z" />
      </svg>
    </Link>
  );
}

function MemberIdentity({
  member,
  canEdit = false,
  isEditing = false,
}: {
  member: MemberPublicPage;
  canEdit?: boolean;
  isEditing?: boolean;
}) {
  return (
    <div className="max-w-2xl">
      <p className="inline-flex -rotate-1 items-center border-2 border-ink bg-surface px-3 py-1 text-[0.7rem] font-bold tracking-[0.18em] text-ink uppercase shadow-[3px_3px_0_0_var(--color-ink)] sm:text-xs">
        HAM member
      </p>
      <div className="mt-7 flex flex-wrap items-center gap-4">
        <h1 className="font-display relative block w-fit text-4xl leading-[1.12] break-words sm:text-5xl">
          {member.displayName}
          <svg aria-hidden="true" viewBox="0 0 120 8" preserveAspectRatio="none" className="absolute -bottom-2 left-0 h-2 w-full text-decorative-red">
            <path d="M2 5 C 26 1, 42 8, 64 4 S 100 2, 118 6" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </svg>
        </h1>
        {canEdit ? <EditPageLink member={member} isEditing={isEditing} /> : null}
      </div>
      {member.blurb ? <p className="mt-8 text-lg leading-relaxed text-muted">{member.blurb}</p> : null}
      <MemberLinks member={member} />
    </div>
  );
}

export default async function MemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ member: string }>;
  searchParams: Promise<{ edit?: string | string[] }>;
}) {
  await connection();
  const { member: slug } = await params;
  const query = await searchParams;
  const result = await getMemberPageForViewer(slug);
  if (!result) notFound();

  const showcase = resolveShowcase(result.page.showcase);
  const isEditing = result.isOwner && query.edit === "1";
  return (
    <>
      <main className="mx-auto w-full max-w-5xl flex-1 px-5 pt-12 pb-20 sm:px-8 sm:pt-16">
        {showcase ? (
          <div className="lg:grid lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-start lg:gap-14">
            <MemberIdentity member={result.page} canEdit={result.isOwner} isEditing={isEditing} />
            <ShowcasePanel showcase={showcase} />
          </div>
        ) : (
          <MemberIdentity member={result.page} canEdit={result.isOwner} isEditing={isEditing} />
        )}

        {isEditing ? <MemberEditor member={result.page} /> : null}
      </main>
      <SiteFooter />
    </>
  );
}
