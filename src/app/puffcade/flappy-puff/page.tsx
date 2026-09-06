import type { Metadata } from "next";

import { FlappyPuffGame } from "./flappy-puff-game";

export const metadata: Metadata = {
  title: "Flappy Puff",
  description: "Flap through toner-stack openings and keep the print run going.",
  alternates: { canonical: "/puffcade/flappy-puff" },
  robots: { index: false, follow: false },
};

export default function FlappyPuffPage() {
  return <FlappyPuffGame exitHref="/puffcade" />;
}
