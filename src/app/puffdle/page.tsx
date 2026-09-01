import type { Metadata } from "next";

import { PuffdleGame } from "@/components/puffdle/puffdle-game";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  title: "Puffdle — Team HAM",
  description:
    "A 5-letter word decoding challenge for Team HAM. Play the deterministic daily puzzle or unlimited runs.",
  openGraph: {
    title: "Puffdle — Team HAM",
    description:
      "A 5-letter word decoding challenge for Team HAM. Play the deterministic daily puzzle or unlimited runs.",
    type: "website",
    url: "https://teamham.world/puffdle",
  },
};

export default function PuffdlePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <main className="mx-auto w-full max-w-7xl flex-1 px-3 py-4 sm:px-6 sm:py-8 lg:px-8">
        <PuffdleGame />
      </main>
      <SiteFooter />
    </div>
  );
}
