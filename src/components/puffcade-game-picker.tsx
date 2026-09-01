"use client";

import { useCallback, useRef, useState } from "react";

import { PuffGame } from "@/components/puff-game";
import { StatusStamp } from "@/components/project-visuals";
import { renderPuff } from "@/lib/puff/render";

const FLAPPY_PUFF_ART = renderPuff(
  42,
  28,
  0.6 / 0.74,
  {
    time: 1.2,
    bob: 0,
    squash: 0,
    blink: 1,
    gazeX: 0.045,
    gazeY: 0,
  },
  { yaw: 0.42, pitch: 0 },
);

export function PuffcadeGamePicker() {
  const cardRef = useRef<HTMLButtonElement>(null);
  const [gameOpen, setGameOpen] = useState(false);

  const closeGame = useCallback(() => {
    setGameOpen(false);
    requestAnimationFrame(() => cardRef.current?.focus());
  }, []);

  return (
    <>
      <div className="card-tilt mt-12 max-w-3xl">
        <button
          ref={cardRef}
          type="button"
          aria-label="Play Flappy Puff"
          onClick={() => setGameOpen(true)}
          className="grid w-full cursor-pointer gap-6 border-2 border-ink bg-surface p-5 text-left shadow-[6px_6px_0_0_var(--color-ink)] transition-[transform,background-color,box-shadow] hover:-translate-y-0.5 hover:bg-paper active:translate-x-1 active:translate-y-1 active:shadow-none sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] sm:gap-8 sm:p-7"
        >
          <span
            aria-hidden="true"
            className="flex min-h-52 items-center justify-center overflow-hidden border-2 border-ink bg-paper p-3"
          >
            <span className="grid">
              <span className="font-mono col-start-1 row-start-1 whitespace-pre text-[0.42rem] leading-[0.74] text-ink sm:text-[0.5rem]">
                {FLAPPY_PUFF_ART.ink}
              </span>
              <span className="font-mono col-start-1 row-start-1 whitespace-pre text-[0.42rem] leading-[0.74] text-decorative-red sm:text-[0.5rem]">
                {FLAPPY_PUFF_ART.accent}
              </span>
            </span>
          </span>

          <span className="min-w-0 self-center">
            <span className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 pb-1">
              <span className="font-display text-3xl leading-tight sm:text-4xl">
                Flappy Puff
              </span>
              <StatusStamp status="playable" />
            </span>

            <span className="mt-3 block text-xs font-bold tracking-[0.18em] text-muted uppercase">
              ASCII arcade &#183; 1 player
            </span>

            <span className="mt-5 block max-w-prose leading-relaxed text-muted">
              Flap through toner-stack openings and keep the print run going.
            </span>

            <span className="mt-6 inline-flex items-center gap-2 font-bold text-interactive-blue underline decoration-2 underline-offset-4">
              Play <span aria-hidden="true">&#8594;</span>
            </span>
          </span>
        </button>
      </div>

      {gameOpen ? <PuffGame onExit={closeGame} /> : null}
    </>
  );
}
