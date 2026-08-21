import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";

import { HamWordmark } from "@/components/ham-wordmark";

export const metadata: Metadata = {
  title: "Member Portal — HAM",
  description: "Member access and session management for HAM.",
};

export default async function AccountPage() {
  const headerList = await headers();
  const isAuthenticated = headerList.get("x-teamham-authenticated") === "1";

  return (
    <>
      <main className="mx-auto w-full max-w-5xl flex-1 px-5 pt-12 pb-16 sm:px-8 sm:pt-20">
        <header className="max-w-2xl">
          <div className="flex items-center gap-4">
            <Link href="/" aria-label="HAM Home">
              <HamWordmark className="h-auto w-32 text-ink sm:w-40" />
            </Link>
          </div>
          <h1 className="font-display mt-8 text-3xl leading-tight sm:text-4xl md:text-5xl">
            {isAuthenticated ? "Member Portal" : "Member Access"}
          </h1>
          <p className="mt-4 text-base leading-relaxed text-muted sm:text-lg">
            {isAuthenticated
              ? "Your membership is active. You have access to HAM member features."
              : "HAM is a private group of friends. Community members can sign in with Discord to verify access."}
          </p>
        </header>

        <section
          aria-labelledby="account-status-heading"
          className="mt-10 max-w-2xl"
        >
          {isAuthenticated ? (
            <div className="card-tilt border-2 border-ink bg-surface p-6 shadow-[6px_6px_0_0_var(--color-ink)] sm:p-8 md:p-10">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b-2 border-ink pb-5">
                <h2
                  id="account-status-heading"
                  className="font-display text-2xl sm:text-3xl"
                >
                  Access Active
                </h2>
                <span className="inline-flex -rotate-1 items-center border-2 border-ink bg-ink px-3 py-1 text-xs font-bold tracking-[0.14em] text-paper">
                  VERIFIED MEMBER
                </span>
              </div>

              <div className="mt-6 space-y-4 text-base leading-relaxed text-muted">
                <p>
                  Your membership has been checked and verified against your role
                  in the HAM Discord server.
                </p>
                <p className="text-sm">
                  Sessions remain valid for up to 24 hours. To keep access secure,
                  each member has one active session at a time—signing in on
                  another browser or device will replace this session.
                </p>
              </div>

              <div className="mt-8 flex flex-col gap-4 border-t-2 border-ink pt-6 sm:flex-row sm:items-center sm:justify-between">
                <form method="post" action="/api/auth/logout">
                  <button
                    type="submit"
                    className="inline-flex cursor-pointer items-center justify-center border-2 border-ink bg-paper px-6 py-2.5 text-sm font-bold tracking-wider text-ink uppercase shadow-[3px_3px_0_0_var(--color-ink)] transition-[transform,background-color,color] hover:-translate-y-0.5 hover:bg-ink hover:text-paper active:translate-x-0.5 active:translate-y-0.5"
                  >
                    Log out
                  </button>
                </form>

                <Link
                  href="/"
                  className="text-sm font-bold text-interactive-blue underline underline-offset-4"
                >
                  Return to shelf &#8594;
                </Link>
              </div>
            </div>
          ) : (
            <div className="card-tilt border-2 border-ink bg-surface p-6 shadow-[6px_6px_0_0_var(--color-ink)] sm:p-8 md:p-10">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b-2 border-ink pb-5">
                <h2
                  id="account-status-heading"
                  className="font-display text-2xl sm:text-3xl"
                >
                  Sign In
                </h2>
                <span className="inline-flex -rotate-1 items-center border-2 border-dashed border-ink bg-paper px-3 py-1 text-xs font-bold tracking-[0.14em] text-ink">
                  MEMBER ACCESS
                </span>
              </div>

              <section
                aria-labelledby="privacy-disclosure-heading"
                className="mt-6 border-2 border-ink bg-paper p-5 sm:p-6"
              >
                <h3
                  id="privacy-disclosure-heading"
                  className="font-display text-lg sm:text-xl text-ink"
                >
                  Before you sign in
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  Signing in verifies your membership in the HAM community:
                </p>
                <ul className="mt-4 space-y-2.5 text-sm leading-relaxed text-muted list-disc pl-5">
                  <li>
                    <strong className="text-ink">Membership check:</strong> TeamHam
                    will check your Discord identity and confirm you hold the
                    required member role in the HAM Discord server.
                  </li>
                  <li>
                    <strong className="text-ink">Data storage:</strong> We store
                    only your Discord user ID and membership eligibility flags in
                    our database. We do not store your profile, username, email,
                    avatar, or IP address.
                  </li>
                  <li>
                    <strong className="text-ink">Purpose:</strong> Stored data is
                    used solely for access control to member features.
                  </li>
                  <li>
                    <strong className="text-ink">Sessions:</strong> We issue a
                    single session lasting up to 24 hours. A new login replaces any
                    existing session.
                  </li>
                  <li>
                    <strong className="text-ink">Requests &amp; deletion:</strong> Discord
                    and Vercel process request data to complete authentication. To
                    request deletion of your stored ID, contact CyR1en (@cyr1en on
                    Discord) or contact TeamHam.
                  </li>
                </ul>
              </section>

              <div className="mt-8 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
                <a
                  href="/api/auth/discord/login"
                  className="inline-flex cursor-pointer items-center justify-center border-2 border-ink bg-ink px-6 py-3 text-sm font-bold tracking-wider text-paper uppercase shadow-[4px_4px_0_0_var(--color-muted)] transition-[transform,background-color,color] hover:-translate-y-0.5 hover:bg-surface hover:text-ink active:translate-x-0.5 active:translate-y-0.5"
                >
                  Sign in with Discord
                </a>

                <Link
                  href="/"
                  className="text-sm font-bold text-interactive-blue underline underline-offset-4"
                >
                  Return to shelf &#8594;
                </Link>
              </div>
            </div>
          )}
        </section>
      </main>

      <footer className="mx-auto w-full max-w-5xl px-5 pb-12 sm:px-8">
        <div className="border-t-2 border-ink pt-6 text-sm tracking-wide text-muted">
          teamham.world &#183; made by HAM
        </div>
      </footer>
    </>
  );
}
