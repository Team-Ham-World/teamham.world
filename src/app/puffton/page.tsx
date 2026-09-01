import type { Metadata } from "next";
import { PufftonGame } from "@/components/puffton/puffton-game";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  title: "Puffton — HAM",
  description:
    "Settlers of Team HAM: Free hexagonal territory strategy game with map choices, expansions, custom color themes, and Discord member leaderboards.",
  alternates: { canonical: "/puffton" },
};

export default function PufftonPage() {
  return (
    <>
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-4 py-6 sm:px-6 lg:px-8">
        <PufftonGame />
      </main>
      <SiteFooter />
    </>
  );
}
