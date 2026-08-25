import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { MembersExplorer } from "@/components/members-explorer";
import { SiteFooter } from "@/components/site-footer";
import { listPublishedMembers } from "@/lib/members/dal";

export const metadata: Metadata = {
  title: "Meet HAM",
  description: "Explore the people of HAM and their personalized pages.",
  alternates: { canonical: "/members" },
};

export default async function MembersPage() {
  await connection();
  const members = await listPublishedMembers();
  if (members.length === 0) notFound();

  return (
    <>
      <main className="mx-auto w-full max-w-6xl flex-1 px-5 pt-12 pb-24 sm:px-8 sm:pt-16">
        <div className="relative max-w-3xl">
          <p className="inline-flex rotate-1 border-2 border-ink bg-surface px-3 py-1 text-xs font-bold tracking-[0.18em] uppercase shadow-[3px_3px_0_0_var(--color-ink)]">People make the place</p>
          <h1 className="font-display mt-7 text-5xl leading-none sm:text-6xl lg:text-7xl">Meet HAM</h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted sm:text-xl">Pick a card and wander in. Every page is shaped by the member who lives there.</p>
          <svg aria-hidden="true" viewBox="0 0 220 22" className="mt-5 h-6 w-52 text-decorative-red">
            <path d="M3 14 C45 2 70 22 110 10 S180 5 217 15" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
          </svg>
        </div>
        <MembersExplorer members={members} />
      </main>
      <SiteFooter />
    </>
  );
}
