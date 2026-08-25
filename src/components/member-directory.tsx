"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { MemberDirectoryItem } from "@/lib/members/model";
import { memberPath } from "@/lib/site";

function parseDirectory(data: unknown): MemberDirectoryItem[] | null {
  if (typeof data !== "object" || data === null) return null;
  const members = (data as Record<string, unknown>).members;
  if (!Array.isArray(members)) return null;
  const parsed: MemberDirectoryItem[] = [];
  for (const member of members) {
    if (typeof member !== "object" || member === null) return null;
    const row = member as Record<string, unknown>;
    if (
      typeof row.slug !== "string" ||
      typeof row.displayName !== "string" ||
      (row.blurb !== null && typeof row.blurb !== "string")
    ) {
      return null;
    }
    parsed.push({
      slug: row.slug,
      displayName: row.displayName,
      blurb: row.blurb as string | null,
    });
  }
  return parsed;
}

/** Keeps the homepage static while progressively loading its public preview. */
export function MemberDirectory() {
  const [members, setMembers] = useState<MemberDirectoryItem[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    async function loadMembers() {
      try {
        const response = await fetch("/api/members", {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        if (!response.ok) return;
        const parsed = parseDirectory(await response.json());
        if (parsed) setMembers(parsed);
      } catch {
        // The public homepage remains complete without a member preview.
      }
    }
    loadMembers();
    return () => controller.abort();
  }, []);

  if (members.length === 0) return null;

  return (
    <section id="who" aria-labelledby="who-heading" className="mt-20 sm:mt-28">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h2 id="who-heading" className="font-display relative inline-block text-3xl sm:text-4xl">
          Who
          <svg aria-hidden="true" viewBox="0 0 120 8" preserveAspectRatio="none" className="absolute -bottom-2 left-0 h-2 w-full text-decorative-red">
            <path d="M2 5 C 26 1, 42 8, 64 4 S 100 2, 118 6" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </svg>
        </h2>
        <Link href="/members" className="inline-flex min-h-11 items-center font-bold text-interactive-blue underline underline-offset-4">
          Meet everyone <span aria-hidden="true" className="ml-2">&#8594;</span>
        </Link>
      </div>

      <ul className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {members.slice(0, 3).map((member) => (
          <li key={member.slug} className="flex">
            <Link href={memberPath(member.slug)} className="flex min-h-48 w-full flex-col border-2 border-ink bg-surface p-5 shadow-[6px_6px_0_0_var(--color-ink)] transition-[transform,background-color] hover:-translate-y-0.5 hover:bg-paper active:translate-x-0.5 active:translate-y-0.5">
              <span className="font-display text-2xl leading-tight">{member.displayName}</span>
              {member.blurb ? <span className="mt-3 line-clamp-3 text-sm leading-relaxed text-muted">{member.blurb}</span> : null}
              <span className="mt-auto pt-5 text-xs font-bold tracking-[0.14em] text-interactive-blue uppercase">Their page <span aria-hidden="true">&#8594;</span></span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
