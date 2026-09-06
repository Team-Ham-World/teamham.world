import type { Metadata } from "next";
import Link from "next/link";


import { PuffdleGame } from "@/components/puffdle/puffdle-game";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  title: "Puffdle — Team HAM",
  description:
    "A 5-letter word decoding challenge for Team HAM. Play the deterministic daily puzzle or unlimited runs.",
  alternates: { canonical: "/puffcade/puffdle" },
  robots: { index: false, follow: false },
  openGraph: {
    title: "Puffdle — Team HAM",
    description:
      "A 5-letter word decoding challenge for Team HAM. Play the deterministic daily puzzle or unlimited runs.",
    type: "website",
    url: "https://teamham.world/puffcade/puffdle",
  },
};

export default function PuffdlePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <main className="mx-auto w-full max-w-7xl flex-1 px-3 py-4 sm:px-6 sm:py-8 lg:px-8">
        <Link
          href="/puffcade"
          className="mb-4 inline-flex font-bold text-interactive-blue underline decoration-2 underline-offset-4"
        >
          ← Back to Puffcade
        </Link>
        <PuffdleGame />
      </main>
      <SiteFooter />
    </div>
  );
}
