import Link from "next/link";

import { StatusStamp } from "@/components/project-visuals";
import { renderPuff } from "@/lib/puff/render";

/**
 * The Puffcade catalog. One metadata entry per real game; the card markup is
 * shared so listings cannot drift apart in treatment. Nothing on this page
 * imports game code — each card is a plain link to the owning route.
 */
interface PuffcadeGameListing {
  title: string;
  href: string;
  detail: string;
  description: string;
  /** Static ASCII preview settings; artwork stays decorative. */
  art: {
    cols: number;
    rows: number;
    cellAspect: number;
    pose: Parameters<typeof renderPuff>[3];
    view: Parameters<typeof renderPuff>[4];
  };
}

const GAME_LISTINGS: PuffcadeGameListing[] = [
  {
    title: "Flappy Puff",
    href: "/puffcade/flappy-puff",
    detail: "ASCII arcade · 1 player",
    description:
      "Flap through toner-stack openings and keep the print run going.",
    art: {
      cols: 42,
      rows: 28,
      cellAspect: 0.6 / 0.74,
      pose: {
        time: 1.2,
        bob: 0,
        squash: 0,
        blink: 1,
        gazeX: 0.045,
        gazeY: 0,
      },
      view: { yaw: 0.42, pitch: 0 },
    },
  },
  {
    title: "Puff Print Run",
    href: "/puffcade/puff-print-run",
    detail: "ASCII arcade · 1 player",
    description:
      "Collect each letter in order. Finish the word to pull the proof and shorten your trail.",
    art: {
      cols: 42,
      rows: 28,
      cellAspect: 0.6 / 0.74,
      pose: {
        time: 2.1,
        bob: 0,
        squash: 0,
        blink: 1,
        gazeX: 0.1,
        gazeY: 0.06,
      },
      view: { yaw: 0.18, pitch: 0.1 },
    },
  },
];

function PuffcadeGameCard({ listing }: Readonly<{ listing: PuffcadeGameListing }>) {
  const art = renderPuff(
    listing.art.cols,
    listing.art.rows,
    listing.art.cellAspect,
    listing.art.pose,
    listing.art.view,
  );

  return (
    <Link
      href={listing.href}
      prefetch={false}
      aria-label={`Play ${listing.title}`}
      className="grid w-full cursor-pointer gap-6 border-2 border-ink bg-surface p-5 text-left shadow-[6px_6px_0_0_var(--color-ink)] transition-[transform,background-color,box-shadow] hover:-translate-y-0.5 hover:bg-paper active:translate-x-1 active:translate-y-1 active:shadow-none sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] sm:gap-8 sm:p-7"
    >
      <span
        aria-hidden="true"
        className="flex min-h-52 items-center justify-center overflow-hidden border-2 border-ink bg-paper p-3"
      >
        <span className="grid">
          <span className="font-mono col-start-1 row-start-1 whitespace-pre text-[0.42rem] leading-[0.74] text-ink sm:text-[0.5rem]">
            {art.ink}
          </span>
          <span className="font-mono col-start-1 row-start-1 whitespace-pre text-[0.42rem] leading-[0.74] text-decorative-red sm:text-[0.5rem]">
            {art.accent}
          </span>
        </span>
      </span>

      <span className="min-w-0 self-center">
        <span className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 pb-1">
          <span className="font-display text-3xl leading-tight sm:text-4xl">
            {listing.title}
          </span>
          <StatusStamp status="playable" />
        </span>

        <span className="mt-3 block text-xs font-bold tracking-[0.18em] text-muted uppercase">
          {listing.detail}
        </span>

        <span className="mt-5 block max-w-prose leading-relaxed text-muted">
          {listing.description}
        </span>

        <span className="mt-6 inline-flex items-center gap-2 font-bold text-interactive-blue underline decoration-2 underline-offset-4">
          Play <span aria-hidden="true">&#8594;</span>
        </span>
      </span>
    </Link>
  );
}

export function PuffcadeGamePicker() {
  return (
    <div className="mt-12 grid max-w-5xl gap-8">
      {GAME_LISTINGS.map((listing) => (
        <PuffcadeGameCard key={listing.href} listing={listing} />
      ))}
    </div>
  );
}
