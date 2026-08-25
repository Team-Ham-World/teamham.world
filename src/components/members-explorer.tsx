"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { useMemo, useState } from "react";

import styles from "@/app/members/members.module.css";
import type { MemberDirectoryItem } from "@/lib/members/model";
import { memberPath } from "@/lib/site";

function signature(slug: string): number {
  let hash = 0;
  for (const character of slug) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return hash % 4;
}

export function MembersExplorer({ members }: { members: MemberDirectoryItem[] }) {
  const [query, setQuery] = useState("");
  const visibleMembers = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return members;
    return members.filter((member) =>
      `${member.displayName} ${member.blurb ?? ""}`
        .toLocaleLowerCase()
        .includes(normalized),
    );
  }, [members, query]);

  return (
    <>
      <div className="mt-10 max-w-xl">
        <label htmlFor="member-search" className="font-bold">Find a member</label>
        <div className="relative mt-2">
          <span aria-hidden="true" className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-xl">⌕</span>
          <input
            id="member-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search names and introductions"
            className="min-h-12 w-full border-2 border-ink bg-surface py-3 pr-4 pl-11 outline-none shadow-[4px_4px_0_0_var(--color-ink)] transition-shadow focus:shadow-[4px_4px_0_0_var(--color-interactive-blue)]"
          />
        </div>
      </div>

      <p className="mt-6 text-sm font-bold tracking-[0.12em] text-muted uppercase" aria-live="polite">
        {visibleMembers.length} {visibleMembers.length === 1 ? "member" : "members"}
      </p>

      {visibleMembers.length > 0 ? (
        <ul className="mt-8 grid gap-x-7 gap-y-10 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visibleMembers.map((member, index) => (
            <li
              key={member.slug}
              data-variant={signature(member.slug)}
              className={styles.card}
              style={{ "--member-delay": `${Math.min(index, 8) * 45}ms` } as CSSProperties}
            >
              <Link
                href={memberPath(member.slug)}
                className={`${styles.link} flex min-h-56 w-full flex-col border-2 border-ink bg-paper p-5 shadow-[5px_5px_0_0_var(--color-ink)] focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-interactive-blue`}
              >
                <span aria-hidden="true" className="mb-5 inline-flex h-10 w-10 items-center justify-center rounded-full border-2 border-ink bg-surface font-display text-xl">
                  {member.displayName.slice(0, 1).toLocaleUpperCase()}
                </span>
                <span className="font-display text-2xl leading-tight">{member.displayName}</span>
                {member.blurb ? <span className="mt-3 line-clamp-4 text-sm leading-relaxed text-muted">{member.blurb}</span> : null}
                <span className="mt-auto pt-5 text-xs font-bold tracking-[0.14em] text-interactive-blue uppercase">
                  Explore their page <span aria-hidden="true">&#8594;</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-8 max-w-xl border-2 border-dashed border-muted bg-surface p-6">
          <p className="font-display text-xl">No match in this pile.</p>
          <p className="mt-2 text-muted">Try a shorter name or clear the search.</p>
        </div>
      )}
    </>
  );
}
