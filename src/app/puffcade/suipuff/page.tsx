import type { Metadata } from "next";

import { SuipuffGame } from "./suipuff-game";

export const metadata: Metadata = {
  title: "Suipuff",
  description: "Drop Puffs into the tray and merge matching pairs all the way to THE PUFF.",
  alternates: { canonical: "/puffcade/suipuff" },
  robots: { index: false, follow: false },
};

export default function SuipuffPage() {
  return <SuipuffGame exitHref="/puffcade" />;
}
