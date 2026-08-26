import type {
  MemberImageRef,
  MemberProjectRef,
  ProjectStatus,
} from "@/lib/members/v2/document";
import type { AssetMetadata } from "../MemberPageV2View";

import { PROJECTS } from "@/data/projects";
import { ProjectArtwork, StatusStamp } from "@/components/project-visuals";
import { MemberPageV2Image } from "./MemberPageV2Image";

export interface ResolvedMemberPageProject {
  name: string;
  shortDescription: string;
  type: string;
  status: ProjectStatus;
  publicUrl?: string;
  repository?: string;
  artwork?:
    | {
        kind: "catalog";
        source: { src: string; alt: string };
      }
    | {
        kind: "member";
        imageRef: MemberImageRef;
      };
}

export function resolveMemberPageProject(
  ref: MemberProjectRef,
  assetMetadata: ReadonlyMap<string, AssetMetadata>,
): ResolvedMemberPageProject | null {
  if (ref.kind === "ham") {
    const project = PROJECTS.find((entry) => entry.slug === ref.projectSlug);
    if (!project) return null;

    return {
      name: project.name,
      shortDescription: project.shortDescription,
      type: project.type,
      status: project.status,
      publicUrl: project.links?.publicUrl,
      repository: project.links?.repository,
      // Registry artwork is reviewed static catalog data. It never becomes a
      // member asset ID and never depends on member-asset metadata.
      artwork: project.artwork
        ? { kind: "catalog", source: project.artwork }
        : undefined,
    };
  }

  return {
    name: ref.name,
    shortDescription: ref.shortDescription,
    type: ref.type,
    status: ref.status,
    publicUrl: ref.url,
    repository: ref.repository,
    // Missing metadata means the upload cannot be trusted for public output.
    // The shared art-pending tile is rendered instead.
    artwork:
      ref.artwork && assetMetadata.has(ref.artwork.assetId)
        ? { kind: "member", imageRef: ref.artwork }
        : undefined,
  };
}

interface MemberPageV2ProjectCardProps {
  project: ResolvedMemberPageProject;
  assetMetadata: ReadonlyMap<string, AssetMetadata>;
  variant: "featured" | "stacked" | "compact";
  artworkPlacement?: "before" | "after";
}

export function MemberPageV2ProjectCard({
  project,
  assetMetadata,
  variant,
  artworkPlacement = "before",
}: MemberPageV2ProjectCardProps) {
  if (variant === "compact") {
    return (
      <article
        className="border-l-4 border-ink pl-4"
        data-project-presentation="compact"
      >
        <ProjectFacts project={project} headingClassName="text-lg" />
        <ProjectLinks project={project} className="mt-3" />
      </article>
    );
  }

  const featured = variant === "featured";
  const artwork = (
    <ProjectVisual
      project={project}
      assetMetadata={assetMetadata}
      sizes={
        featured
          ? "(min-width: 1024px) 540px, calc(100vw - 4.5rem)"
          : "(min-width: 1024px) 720px, calc(100vw - 4rem)"
      }
    />
  );

  return (
    <article
      className={
        featured
          ? "card-tilt border-2 border-ink bg-surface p-5 shadow-[6px_6px_0_0_var(--color-ink)] sm:p-6"
          : "card-tilt border-2 border-ink bg-surface p-4 shadow-[4px_4px_0_0_var(--color-ink)] sm:p-5"
      }
      data-project-presentation={variant}
    >
      {artworkPlacement === "before" ? (
        <div className={featured ? "mb-6" : "mb-4"}>{artwork}</div>
      ) : null}

      <ProjectFacts
        project={project}
        headingClassName={
          featured ? "text-2xl md:text-3xl" : "text-xl sm:text-2xl"
        }
      />

      {artworkPlacement === "after" ? (
        <div className="mt-6">{artwork}</div>
      ) : null}

      <ProjectLinks project={project} className={featured ? "mt-5" : "mt-4"} />
    </article>
  );
}

function ProjectVisual({
  project,
  assetMetadata,
  sizes,
}: {
  project: ResolvedMemberPageProject;
  assetMetadata: ReadonlyMap<string, AssetMetadata>;
  sizes: string;
}) {
  if (project.artwork?.kind === "member") {
    return (
      <div data-project-artwork-source="member">
        <MemberPageV2Image
          imageRef={project.artwork.imageRef}
          assetMetadata={assetMetadata}
          sizes={sizes}
        />
      </div>
    );
  }

  return (
    <div
      data-project-artwork-source={
        project.artwork?.kind === "catalog" ? "catalog" : "pending"
      }
    >
      <ProjectArtwork
        artwork={
          project.artwork?.kind === "catalog"
            ? project.artwork.source
            : undefined
        }
        sizes={sizes}
      />
    </div>
  );
}

function ProjectFacts({
  project,
  headingClassName,
}: {
  project: ResolvedMemberPageProject;
  headingClassName: string;
}) {
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <h3 className={`font-display leading-tight ${headingClassName}`}>
          {project.name}
        </h3>
        <StatusStamp status={project.status} />
      </div>
      <p className="mt-2 text-xs font-bold tracking-[0.18em] text-muted uppercase">
        {project.type}
      </p>
      <p
        className={
          headingClassName === "text-lg"
            ? "mt-2 text-sm leading-relaxed text-muted"
            : "mt-4 max-w-prose leading-relaxed text-muted"
        }
      >
        {project.shortDescription}
      </p>
    </>
  );
}

function ProjectLinks({
  project,
  className,
}: {
  project: ResolvedMemberPageProject;
  className: string;
}) {
  if (!project.publicUrl && !project.repository) return null;

  return (
    <ul className={`${className} flex flex-wrap gap-x-6 gap-y-1 text-sm`}>
      {project.publicUrl ? (
        <li>
          <a
            href={project.publicUrl}
            rel="noopener noreferrer"
            className="inline-flex min-h-11 min-w-11 items-center font-bold text-interactive-blue underline underline-offset-4"
          >
            Visit
          </a>
        </li>
      ) : null}
      {project.repository ? (
        <li>
          <a
            href={project.repository}
            rel="noopener noreferrer"
            className="inline-flex min-h-11 min-w-11 items-center font-bold text-interactive-blue underline underline-offset-4"
          >
            Source
          </a>
        </li>
      ) : null}
    </ul>
  );
}
