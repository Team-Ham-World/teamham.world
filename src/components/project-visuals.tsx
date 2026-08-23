import Image from "next/image";

import { STATUS_LABELS, type ProjectStatus } from "@/data/projects";

/**
 * The shared visual vocabulary for a project, wherever one is shown.
 *
 * The shelf on the home page and a member's showcase render the same status
 * stamp and the same framed 16:9 tile. They live here rather than in
 * `project-shelf.tsx` so the two surfaces cannot drift apart — a status whose
 * stamp differs between pages would read as two different statuses.
 */

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

export function StatusStamp({ status }: { status: ProjectStatus }) {
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

/**
 * The framed 16:9 tile: approved artwork when it exists, the pending frame when
 * it does not. `sizes` is a prop because the tile is laid out differently on the
 * shelf (a fixed-width column) than on a member page (a spread column).
 */
export function ProjectArtwork({
  artwork,
  sizes,
}: {
  artwork?: { src: string; alt: string };
  sizes: string;
}) {
  if (!artwork) {
    return <ArtPendingTile />;
  }

  return (
    <div className="relative aspect-video w-full border-2 border-ink bg-surface">
      <Image
        src={artwork.src}
        alt={artwork.alt}
        fill
        sizes={sizes}
        className="object-cover"
      />
    </div>
  );
}
