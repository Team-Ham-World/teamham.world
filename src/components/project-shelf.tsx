import Image from "next/image";

import { ProjectDisclosure } from "@/components/project-disclosure";
import {
  hasExpandableContent,
  PROJECTS,
  STATUS_LABELS,
  type Project,
  type ProjectStatus,
} from "@/data/projects";

/**
 * Per-status stamp treatment (BRAND.md §3).
 *
 * Every status is distinguished by shape — dashed, doubled, inverted, struck,
 * striped — so status is never carried by color alone. Rotation never exceeds
 * the ±4° limit.
 */
const STAMP_STYLES: Record<
  ProjectStatus,
  { className: string; rotation: string }
> = {
  planning: {
    className: "border-2 border-dashed border-ink bg-paper text-ink",
    rotation: "-3deg",
  },
  "in-development": {
    className: "border-2 border-ink bg-paper text-ink",
    rotation: "-2deg",
  },
  playable: {
    // Double outline: a paper gap ringed by a second ink stroke.
    className:
      "border-2 border-ink bg-paper text-ink shadow-[0_0_0_2px_var(--color-paper),0_0_0_4px_var(--color-ink)]",
    rotation: "2deg",
  },
  released: {
    className: "border-2 border-ink bg-ink text-paper",
    rotation: "-2deg",
  },
  paused: {
    className: "border-2 border-ink bg-paper text-ink",
    rotation: "3deg",
  },
  retired: {
    className: "border-2 border-ink/40 text-muted",
    rotation: "0deg",
  },
};

function StatusStamp({ status }: { status: ProjectStatus }) {
  const { className, rotation } = STAMP_STYLES[status];

  return (
    <span
      className={`relative inline-flex shrink-0 items-center px-3 py-1 text-xs font-bold tracking-[0.14em] ${className}`}
      style={{
        transform: `rotate(${rotation})`,
        ...(status === "retired"
          ? {
              backgroundImage:
                "repeating-linear-gradient(45deg, transparent 0 5px, color-mix(in srgb, var(--color-ink) 14%, transparent) 5px 7px)",
            }
          : null),
      }}
    >
      {status === "paused" ? (
        <>
          {/* Strike bar sits behind the label, which keeps a paper backdrop so
              the text stays fully legible through it. */}
          <span
            aria-hidden="true"
            className="absolute left-0 top-1/2 h-0.5 w-full -translate-y-1/2 bg-ink"
          />
          <span className="relative bg-paper px-1">
            {STATUS_LABELS[status]}
          </span>
        </>
      ) : (
        STATUS_LABELS[status]
      )}

      {status === "in-development" ? (
        <svg
          aria-hidden="true"
          viewBox="0 0 100 6"
          preserveAspectRatio="none"
          className="absolute -bottom-2.5 left-0 h-1.5 w-full text-decorative-red"
        >
          <path
            d="M1 4 C 18 1, 30 6, 48 3 S 80 1, 99 4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      ) : null}
    </span>
  );
}

/**
 * Standardized 16:9 placeholder (BRAND.md §4).
 *
 * Deliberately factual: a framed empty surface that says artwork is pending.
 * It must never imply gameplay, features, or a UI that does not exist.
 */
function ArtPendingTile() {
  return (
    <div className="relative aspect-video w-full border-2 border-ink bg-surface">
      <div aria-hidden="true" className="absolute inset-2">
        <svg
          viewBox="0 0 320 180"
          preserveAspectRatio="none"
          className="h-full w-full text-ink/25"
        >
          <path
            d="M4 6 C 90 2, 210 9, 315 4 C 318 60, 316 120, 317 176 C 220 179, 100 172, 5 177 C 2 120, 6 62, 4 6 Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>

      {/* Single tape-corner doodle, kept in the margin and clear of the text. */}
      <span
        aria-hidden="true"
        className="absolute -left-3 -top-2 h-6 w-14 -rotate-[24deg] border border-ink/20 bg-ink/10"
      />

      <div className="absolute inset-0 flex items-center justify-center">
        <span className="-rotate-2 border-2 border-dashed border-ink/60 px-3 py-1 text-xs font-bold tracking-[0.18em] text-muted">
          ART PENDING
        </span>
      </div>
    </div>
  );
}

function ProjectCard({ project }: { project: Project }) {
  const { slug, name, shortDescription, type, status, artwork } = project;
  const repository = project.links?.repository;
  const publicUrl = project.links?.publicUrl;

  return (
    <article
      id={slug}
      className="card-tilt border-2 border-ink bg-surface shadow-[6px_6px_0_0_var(--color-ink)]"
    >
      <div className="flex flex-col gap-6 p-5 md:flex-row md:gap-8 md:p-7">
        <div className="w-full shrink-0 md:w-[340px] lg:w-[400px]">
          {artwork ? (
            <div className="relative aspect-video w-full border-2 border-ink bg-surface">
              <Image
                src={artwork.src}
                alt={artwork.alt}
                fill
                sizes="(min-width: 1024px) 400px, (min-width: 768px) 340px, 100vw"
                className="object-cover"
              />
            </div>
          ) : (
            <ArtPendingTile />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 pb-1">
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

          {/*
            Content gate: the trigger appears only when there is approved
            content behind it. An empty panel must never render.
          */}
          {hasExpandableContent(project) ? (
            <ProjectDisclosure slug={slug} label="Details">
              {project.longDescription ? (
                <p className="max-w-prose leading-relaxed text-muted">
                  {project.longDescription}
                </p>
              ) : null}

              {project.makers.length > 0 ? (
                <p className="mt-4 text-sm text-muted">
                  <span className="font-bold tracking-wide text-ink">
                    Made by
                  </span>{" "}
                  {project.makers.join(", ")}
                </p>
              ) : null}

              {repository || publicUrl ? (
                <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
                  {publicUrl ? (
                    <li>
                      <a
                        href={publicUrl}
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
                        className="font-bold text-interactive-blue underline underline-offset-4"
                      >
                        Source
                      </a>
                    </li>
                  ) : null}
                </ul>
              ) : null}
            </ProjectDisclosure>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export function ProjectShelf() {
  return (
    <div className="flex flex-col gap-8">
      {PROJECTS.map((project) => (
        <ProjectCard key={project.slug} project={project} />
      ))}
    </div>
  );
}
