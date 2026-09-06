import type { Metadata } from "next";

import { PuffPrintRunGame } from "./puff-print-run-game";

export const metadata: Metadata = {
  title: "Puff Print Run",
  description:
    "Steer Puff around the sheet, collect each letter in order, and pull the proof before the paper jams.",
  alternates: { canonical: "/puffcade/puff-print-run" },
  robots: { index: false, follow: false },
};

export default function PuffPrintRunPage() {
  return <PuffPrintRunGame exitHref="/puffcade" />;
}
