import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";

import { MemberEditor } from "@/components/member-editor";
import { MemberPageV2View } from "@/components/member-page-v2";
import { ProjectArtwork, StatusStamp } from "@/components/project-visuals";
import { SiteFooter } from "@/components/site-footer";
import { MemberSocialLinks } from "@/components/social-links";
import { getPublishedMemberPageAssetMetadata } from "@/lib/members/assets/dal";
import { getMemberPageForViewer } from "@/lib/members/dal";
import {
  isValidMemberSlug,
  resolveShowcase,
  type MemberPublicPage,
  type ResolvedShowcase,
} from "@/lib/members/model";
import { extractMemberPageAssetIds } from "@/lib/members/v2/asset-references";
import { getPublishedMemberPageV2 } from "@/lib/members/v2/dal";
import type { MemberPageDocumentV2 } from "@/lib/members/v2/document";
import {
  isMemberPageV2Cohort,
  isMemberPageV2EditorEnabled,
} from "@/lib/members/v2/feature-flag";
import {
  resolveEnabledThemeAccent,
  type ResolvedMemberThemeAccent,
} from "@/lib/members/v2/themes";
import { displayHostname, memberPath } from "@/lib/site";

type PublishedV2Read =
  | {
      status: "success";
      slug: string;
      document: MemberPageDocumentV2;
      theme: ResolvedMemberThemeAccent;
    }
  | { status: "not-found" }
  | { status: "invalid" };

/**
 * Published V2 read, memoized per request.
 *
 * `generateMetadata` and the page body both need it, and React's request cache
 * keeps that to one query per render.
 */
const readPublishedV2 = cache(
  async (slug: string): Promise<PublishedV2Read> => {
    const result = await getPublishedMemberPageV2(slug);
    if (result.status === "not-found-or-forbidden") {
      return { status: "not-found" };
    }
    if (result.status === "invalid") return { status: "invalid" };

    const theme = resolveEnabledThemeAccent(
      result.data.document.frame.theme.id,
      result.data.document.frame.theme.accentId,
    );
    // A published row with an unavailable theme/accent is still a V2 row. It
    // must fail closed rather than becoming an excuse to expose stale V1 data.
    if (!theme) return { status: "invalid" };

    return {
      status: "success",
      slug: result.data.slug,
      document: result.data.document,
      theme,
    };
  },
);

async function failClosedPublishedV2(slug: string): Promise<never> {
  const { recordInvalidPublishedV2Read } = await import(
    "@/components/member-page-v2/invalid-published-diagnostic"
  );
  recordInvalidPublishedV2Read(slug);
  notFound();
}

/**
 * Coarse slug-only signal that a published page rendered with one or more
 * degraded assets. Follows the existing diagnostics: the public slug is the
 * entire payload, a slug is logged once per process, and the log is capped at
 * the first few distinct slugs so it can neither flood nor grow unbounded.
 * No asset IDs, document content, theme values, or viewer state.
 */
const DEGRADED_RENDER_SLUG_LOG_LIMIT = 20;
const degradedRenderSlugs = new Set<string>();

function recordDegradedAssetRender(slug: string): void {
  if (degradedRenderSlugs.has(slug)) return;
  if (degradedRenderSlugs.size >= DEGRADED_RENDER_SLUG_LOG_LIMIT) return;
  degradedRenderSlugs.add(slug);
  try {
    console.warn(
      "[member-page] published V2 page rendered with degraded assets",
      { slug },
    );
  } catch {
    // A diagnostic is never worth failing a page render for.
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ member: string }>;
}): Promise<Metadata> {
  const { member: slug } = await params;

  // Reject malformed and reserved route segments before any V2 diagnostic.
  // They are ordinary invalid requests, not evidence of corrupt published data.
  if (!isValidMemberSlug(slug)) notFound();

  const inCohort = isMemberPageV2Cohort(slug);

  // Metadata comes from published state only: never a draft, and never a
  // value visible just because the viewer happens to own the page.
  const publishedV2 = await readPublishedV2(slug);
  if (publishedV2.status === "invalid") {
    return failClosedPublishedV2(slug);
  }
  if (publishedV2.status === "success") {
    return buildMemberMetadata({
      slug: publishedV2.slug,
      displayName: publishedV2.document.frame.displayName,
      description: publishedV2.document.frame.summary,
    });
  }

  // Once a slug is assigned to V2, a transient no-row read must never expose
  // stale V1 metadata. This is intentionally a server-side cohort decision so
  // both explicit slug cohorts and the `all` cohort fail closed during races.
  // Metadata cannot decide whether the viewer owns an unpublished page:
  // throwing `notFound()` here would terminate the whole route before the
  // viewer-aware page body can render the private owner editor.
  if (inCohort) return privateMemberMetadata();

  const legacy = await getMemberPageForViewer(slug);
  if (!legacy?.isPublished) return privateMemberMetadata();

  return buildMemberMetadata({
    slug: legacy.page.slug,
    displayName: legacy.page.displayName,
    description: legacy.page.blurb,
  });
}

function privateMemberMetadata(): Metadata {
  return {
    title: "Member not found — HAM",
    robots: { index: false, follow: false },
  };
}

function buildMemberMetadata({
  slug,
  displayName,
  description,
}: {
  slug: string;
  displayName: string;
  description: string | null;
}): Metadata {
  const summary = description ?? `${displayName} is a member of HAM.`;
  const url = memberPath(slug);
  return {
    title: `${displayName} — HAM`,
    description: summary,
    alternates: { canonical: url },
    openGraph: {
      title: `${displayName} — HAM`,
      description: summary,
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
            {showcase.publicUrl ? <li><a href={showcase.publicUrl} rel="noopener noreferrer" className="inline-flex min-h-11 min-w-11 items-center font-bold text-interactive-blue underline underline-offset-4">Visit</a></li> : null}
            {showcase.repository ? <li><a href={showcase.repository} rel="noopener noreferrer" className="inline-flex min-h-11 min-w-11 items-center font-bold text-interactive-blue underline underline-offset-4">Source</a></li> : null}
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

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <main className="mx-auto w-full max-w-5xl flex-1 px-5 pt-12 pb-20 sm:px-8 sm:pt-16">
        {children}
      </main>
      <SiteFooter />
    </>
  );
}

/**
 * Owner entry point for their own page.
 *
 * The copy has to match reality: telling the owner of a live page that it is
 * "not public yet" is simply wrong, and could push them into republishing
 * something that is already published. The link is the only way in; there is
 * no token and no preview route, so nothing here is reachable by anyone else.
 */
function OwnerDraftNotice({
  slug,
  isLive,
}: {
  slug: string;
  isLive: boolean;
}) {
  return (
    <div className="border-2 border-ink bg-surface p-5 shadow-[4px_4px_0_0_var(--color-ink)]">
      <p className="text-xs font-bold tracking-[0.18em] text-muted uppercase">
        {isLive ? "Your page" : "Private to you"}
      </p>
      <p className="mt-3 max-w-prose leading-relaxed text-muted">
        {isLive
          ? "This page is live and anyone can see it. Open the editor to change it."
          : "This page is not public yet. You are the only person who can see it."}
      </p>
      <Link
        href={`${memberPath(slug)}?edit=1#edit-page`}
        className="mt-5 inline-flex min-h-11 items-center border-2 border-ink bg-ink px-5 py-3 text-sm font-bold tracking-wider text-paper uppercase shadow-[4px_4px_0_0_var(--color-muted)] transition-[transform,background-color,color] hover:-translate-y-0.5 hover:bg-surface hover:text-ink"
      >
        Open the editor
      </Link>
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

  // Invalid route segments are plain 404s. In particular, do not feed them to
  // the invalid-published-row diagnostic, whose input is reserved for valid
  // public slugs with unsafe stored V2 state.
  if (!isValidMemberSlug(slug)) notFound();

  // Cohort membership is a server fact and must be resolved independently of
  // the first published-row read. That read can legitimately miss while a
  // publish is racing, but a V2 cohort slug must still never bridge to V1.
  const inCohort = isMemberPageV2Cohort(slug);

  // Resolve public truth before consulting V1 or owner state. Only a definite
  // no-row result for a non-cohort slug may proceed to the legacy bridge.
  const publishedV2 = await readPublishedV2(slug);
  if (publishedV2.status === "invalid") {
    return failClosedPublishedV2(slug);
  }

  const viewer = await getMemberPageForViewer(slug);
  const isOwner = viewer?.isOwner === true;
  const wantsEditor = query.edit === "1";

  const editorEnabled = inCohort && isMemberPageV2EditorEnabled(slug);
  const showV2Editor = isOwner && wantsEditor && editorEnabled;

  if (showV2Editor) {
    // Imported only on this branch, so no visitor render pulls the editor,
    // its state machine, or the owner server actions into the graph.
    const [{ getOwnedMemberPageDraftV2 }, { default: MemberPageEditorMount }] =
      await Promise.all([
        import("@/lib/members/v2/dal"),
        import("@/components/member-page-editor/editor-mount"),
      ]);

    const draft = await getOwnedMemberPageDraftV2(slug);
    if (draft.status === "success") {
      const theme = resolveEnabledThemeAccent(
        draft.data.draft.frame.theme.id,
        draft.data.draft.frame.theme.accentId,
      );
      if (theme) {
        const { getOwnedMemberPageAssetsForEditor } = await import(
          "@/components/member-page-editor/owner-asset-metadata"
        );
        const editorAssets = await getOwnedMemberPageAssetsForEditor(
          draft.data,
        );
        // Deliberately outside PageShell: the editor is a workbench, not an
        // article. It owns the full width below the site header and supplies
        // its own scrolling regions, so the reading column and the footer
        // would only shrink the canvas and add a dead end below it.
        return (
          <MemberPageEditorMount
            draft={draft.data}
            theme={theme}
            assetMetadata={editorAssets.assetMetadata}
            initialAssets={editorAssets.assets}
          />
        );
      }
    }
  }

  // During the bridge, non-cohort pages remain legacy-authoritative for owner
  // edits even though migration 0007 backfills a V2 published snapshot for
  // every live page. Give the explicit owner edit request precedence over the
  // read-only V2 public renderer so the pilot cannot strand non-pilot owners.
  if (!inCohort && isOwner && wantsEditor && viewer) {
    const showcase = resolveShowcase(viewer.page.showcase);
    return (
      <PageShell>
        {showcase ? (
          <div className="lg:grid lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-start lg:gap-14">
            <MemberIdentity member={viewer.page} canEdit isEditing />
            <ShowcasePanel showcase={showcase} />
          </div>
        ) : (
          <MemberIdentity member={viewer.page} canEdit isEditing />
        )}
        <MemberEditor member={viewer.page} />
      </PageShell>
    );
  }

  if (publishedV2.status === "success") {
    const assetMetadataResult = await getPublishedMemberPageAssetMetadata(
      publishedV2.slug,
      extractMemberPageAssetIds(publishedV2.document),
    );
    if (assetMetadataResult.status === "invalid") {
      return failClosedPublishedV2(publishedV2.slug);
    }
    if (assetMetadataResult.status === "unavailable") {
      // A storage or database outage is a service failure, not content state.
      // Report it as an error response instead of a branded 404 so operators
      // can tell an incident apart from an unavailable medium (the degraded
      // path below is only for content-level asset problems).
      throw new Error("Member page asset metadata is temporarily unavailable.");
    }
    if (assetMetadataResult.degradedAssetIds.size > 0) {
      // Content-level degradation: some referenced assets are missing,
      // deletion-claimed, or stored with invalid metadata. The unaffected
      // content stays at HTTP 200 and degraded media take the safe leaf
      // fallbacks (omit image/portrait/gallery item, project artwork tile).
      recordDegradedAssetRender(publishedV2.slug);
    }
    return (
      <PageShell>
        <MemberPageV2View
          document={publishedV2.document}
          theme={publishedV2.theme}
          assetMetadata={assetMetadataResult.metadata}
        />
        {isOwner ? (
          <div className="mt-14 border-t-2 border-ink pt-8">
            <OwnerPageTools
              slug={publishedV2.slug}
              editorEnabled={editorEnabled}
              isLive
            />
          </div>
        ) : null}
      </PageShell>
    );
  }

  // A cohort slug with no published V2 row is either genuinely private or was
  // observed during a publish transition. Owners retain their V2 entry point,
  // but nobody receives stale V1 content and no legacy diagnostic is emitted.
  if (inCohort) {
    if (isOwner) {
      return (
        <PageShell>
          <OwnerPageTools
            slug={slug}
            editorEnabled={editorEnabled}
            isLive={false}
          />
        </PageShell>
      );
    }
    notFound();
  }

  // Temporary bridge: reached only when the V2 reader definitively found no
  // published row for a non-cohort slug, and only for a V1 page that is
  // genuinely published. V1 data never renders inside the V2 frame.
  if (viewer?.isPublished) {
    // Coarse signal for how much traffic still needs this path, so the
    // rollout can tell when it is safe to delete. Public slug only.
    const { recordLegacyFallbackRender } = await import(
      "@/components/member-page-editor/legacy-fallback-diagnostic"
    );
    recordLegacyFallbackRender(viewer.page.slug);

    const showcase = resolveShowcase(viewer.page.showcase);
    const isEditingLegacy = isOwner && wantsEditor;
    return (
      <PageShell>
        {showcase ? (
          <div className="lg:grid lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-start lg:gap-14">
            <MemberIdentity
              member={viewer.page}
              canEdit={isOwner}
              isEditing={isEditingLegacy}
            />
            <ShowcasePanel showcase={showcase} />
          </div>
        ) : (
          <MemberIdentity
            member={viewer.page}
            canEdit={isOwner}
            isEditing={isEditingLegacy}
          />
        )}

        {isEditingLegacy ? <MemberEditor member={viewer.page} /> : null}
      </PageShell>
    );
  }

  // Owner of a page with nothing public yet: their own private entry point.
  if (isOwner) {
    const showcase = resolveShowcase(viewer.page.showcase);
    const isEditingLegacy = wantsEditor;
    return (
      <PageShell>
        <MemberIdentity
          member={viewer.page}
          canEdit
          isEditing={isEditingLegacy}
        />
        {showcase ? <ShowcasePanel showcase={showcase} /> : null}
        {isEditingLegacy ? <MemberEditor member={viewer.page} /> : null}
      </PageShell>
    );
  }

  notFound();
}

/**
 * Owner-only tools panel for a cohort page.
 *
 * When the kill switch is on, this states that editing is paused instead of
 * dropping the owner into the legacy editor, which would write V1 columns for a
 * page whose truth is its V2 document.
 */
function OwnerPageTools({
  slug,
  editorEnabled,
  isLive,
}: {
  slug: string;
  editorEnabled: boolean;
  isLive: boolean;
}) {
  if (!editorEnabled) {
    return (
      <div className="border-2 border-ink bg-surface p-5">
        <p className="text-xs font-bold tracking-[0.18em] text-muted uppercase">
          Owner tools
        </p>
        <p className="mt-3 max-w-prose leading-relaxed text-muted">
          {isLive
            ? "Page editing is paused for a short while. Your page is still live and unchanged, and nothing you have saved is affected."
            : "Page editing is paused for a short while. Your page and its content are unchanged, and nothing you have saved is affected."}
        </p>
      </div>
    );
  }
  return <OwnerDraftNotice slug={slug} isLive={isLive} />;
}
