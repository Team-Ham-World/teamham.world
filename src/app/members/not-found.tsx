import Link from "next/link";

import { SiteFooter } from "@/components/site-footer";

export default function MembersNotFound() {
  return (
    <>
      <main className="mx-auto flex w-full max-w-5xl flex-1 items-center px-5 py-20 sm:px-8">
        <div className="max-w-xl border-2 border-ink bg-surface p-7 shadow-[7px_7px_0_0_var(--color-ink)] sm:p-10">
          <p className="text-xs font-bold tracking-[0.18em] text-muted uppercase">The card table is empty</p>
          <h1 className="font-display mt-4 text-4xl">No public member pages yet.</h1>
          <p className="mt-4 leading-relaxed text-muted">When members publish their pages, this is where you’ll meet them.</p>
          <Link href="/" className="mt-7 inline-flex min-h-11 items-center font-bold text-interactive-blue underline underline-offset-4">Back to HAM</Link>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
