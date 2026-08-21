"use client";

import { useEffect, useState } from "react";

/**
 * Sign-in control for the home page.
 *
 * The home page is statically prerendered and deliberately excluded from the
 * auth proxy, so it cannot know who is visiting at render time. This component
 * asks `/api/auth/session` after hydration instead, which keeps `/` cacheable
 * and free of any `Vary: Cookie` response.
 *
 * Three outcomes, and only two of them are visible: a signed-in member, a
 * signed-out visitor, or nothing at all when the endpoint is unreachable or
 * auth is switched off entirely — an unknown session is never rendered as an
 * invitation to sign in.
 */

interface SessionStatus {
  authenticated: boolean;
  username: string | null;
}

function parseSessionStatus(data: unknown): SessionStatus | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }
  const { authenticated, username } = data as Record<string, unknown>;
  if (typeof authenticated !== "boolean") {
    return null;
  }
  return {
    authenticated,
    username: typeof username === "string" ? username : null,
  };
}

export function MemberBadge() {
  const [status, setStatus] = useState<SessionStatus | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function loadSessionStatus() {
      try {
        const response = await fetch("/api/auth/session", {
          signal: controller.signal,
          credentials: "same-origin",
          headers: { Accept: "application/json" },
        });
        if (!response.ok) {
          return;
        }
        const parsed = parseSessionStatus(await response.json());
        if (parsed) {
          setStatus(parsed);
        }
      } catch {
        // Offline, aborted, or an unreadable body: stay hidden.
      }
    }

    loadSessionStatus();
    return () => controller.abort();
  }, []);

  // The row holds its height from the first paint, so resolving the session
  // swaps content in without shifting the wordmark below it.
  return (
    <div className="flex min-h-9 items-center justify-end">
      {status === null ? null : status.authenticated ? (
        <a
          href="/account"
          className="inline-flex max-w-full items-center gap-2.5 border-2 border-ink bg-surface px-3 py-1.5 shadow-[3px_3px_0_0_var(--color-ink)] transition-[transform,background-color] hover:-translate-y-0.5 hover:bg-paper active:translate-x-0.5 active:translate-y-0.5"
        >
          <span className="shrink-0 text-[0.65rem] font-bold tracking-[0.14em] text-muted uppercase">
            Signed in
          </span>
          {/* Discord allows 32 characters, which outgrows a narrow phone. */}
          <span className="truncate text-sm font-bold text-ink">
            {status.username ? `@${status.username}` : "Member"}
          </span>
        </a>
      ) : (
        <a
          href="/api/auth/discord/login"
          className="inline-flex items-center justify-center border-2 border-ink bg-paper px-4 py-2 text-xs font-bold tracking-[0.14em] text-ink uppercase shadow-[3px_3px_0_0_var(--color-ink)] transition-[transform,background-color,color] hover:-translate-y-0.5 hover:bg-ink hover:text-paper active:translate-x-0.5 active:translate-y-0.5"
        >
          Member sign in
        </a>
      )}
    </div>
  );
}
