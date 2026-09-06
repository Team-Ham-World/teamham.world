import type { Metadata } from "next";

import { PuffcadeGamePicker } from "@/components/puffcade-game-picker";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  title: "Puffcade",
  description: "Puffcade is where HAM's Puff-related games live.",
  alternates: { canonical: "/puffcade" },
  robots: { index: false, follow: false },
};

export default function PuffcadePage() {
  return (
    <>
      <main className="mx-auto w-full max-w-5xl flex-1 px-5 pt-12 pb-20 sm:px-8 sm:pt-16">
        <div className="max-w-3xl">
          <p className="inline-flex -rotate-1 items-center border-2 border-ink bg-surface px-3 py-1 text-[0.7rem] font-bold tracking-[0.18em] text-ink uppercase shadow-[3px_3px_0_0_var(--color-ink)] sm:text-xs">
            PUFF TRANSMISSION // ARCADE
          </p>

          <h1 className="font-display relative mt-7 w-fit text-5xl leading-none sm:text-6xl lg:text-7xl">
            Puffcade
            <svg
              aria-hidden="true"
              viewBox="0 0 220 12"
              preserveAspectRatio="none"
              className="absolute -bottom-3 left-0 h-3 w-full text-decorative-red"
            >
              <path
                d="M3 8 C 45 2, 75 12, 112 6 S 180 3, 217 9"
                fill="none"
                stroke="currentColor"
                strokeWidth="4"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          </h1>

          <p className="mt-8 max-w-2xl text-lg leading-relaxed text-muted sm:text-xl">
            Puff-related games live here.
          </p>
        </div>

        <PuffcadeGamePicker />
      </main>

      <SiteFooter />
    </>
  );
}
