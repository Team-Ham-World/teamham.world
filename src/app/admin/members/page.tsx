import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";

import { AdminMemberCreateForm, AdminMemberRowControls } from "@/components/admin-member-forms";
import { SiteFooter } from "@/components/site-footer";
import { getAdminMemberManagementData, MemberAccessError } from "@/lib/members/dal";
import { memberPath } from "@/lib/site";

export const metadata: Metadata = {
  title: "Manage member pages — HAM",
  robots: { index: false, follow: false },
};

export default async function AdminMembersPage() {
  await connection();
  let data;
  try {
    data = await getAdminMemberManagementData();
  } catch (error) {
    if (error instanceof MemberAccessError) {
      if (error.code === "unauthenticated") redirect("/account");
      notFound();
    }
    throw error;
  }

  return (
    <>
      <main className="mx-auto w-full max-w-5xl flex-1 px-5 pt-12 pb-20 sm:px-8 sm:pt-16">
        <p className="inline-flex -rotate-1 border-2 border-ink bg-surface px-3 py-1 text-xs font-bold tracking-[0.18em] uppercase shadow-[3px_3px_0_0_var(--color-ink)]">Admin desk</p>
        <h1 className="font-display mt-7 text-4xl sm:text-5xl">Member pages</h1>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted">Create each page, assign its owner, and control publication. Members edit the page content themselves.</p>

        <section aria-labelledby="create-page-heading" className="mt-12 border-2 border-ink bg-surface p-5 shadow-[6px_6px_0_0_var(--color-ink)] sm:p-7">
          <h2 id="create-page-heading" className="font-display text-2xl sm:text-3xl">Create a page</h2>
          <AdminMemberCreateForm accounts={data.accounts} />
        </section>

        <section aria-labelledby="existing-pages-heading" className="mt-16">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 id="existing-pages-heading" className="font-display text-3xl">Existing pages</h2>
            <p className="font-bold text-muted">{data.pages.length} total</p>
          </div>
          {data.pages.length === 0 ? (
            <p className="mt-7 border-2 border-dashed border-muted p-6 text-muted">No member pages have been created.</p>
          ) : (
            <ul className="mt-7 grid gap-6 lg:grid-cols-2">
              {data.pages.map((page) => {
                // Determine status badge
                let statusBadge: React.ReactNode;
                if (page.moderationHold) {
                  statusBadge = (
                    <span className="border-2 border-ink bg-decorative-red px-2 py-1 text-xs font-bold tracking-[0.12em] text-paper uppercase">
                      Held
                    </span>
                  );
                } else if (page.isPublished) {
                  statusBadge = (
                    <span className="border-2 border-ink bg-interactive-blue px-2 py-1 text-xs font-bold tracking-[0.12em] text-paper uppercase">
                      Published
                    </span>
                  );
                } else {
                  statusBadge = (
                    <span className="border-2 border-ink bg-surface px-2 py-1 text-xs font-bold tracking-[0.12em] text-ink uppercase">
                      Unpublished
                    </span>
                  );
                }

                return (
                  <li key={page.id} className="border-2 border-ink bg-paper p-5 shadow-[5px_5px_0_0_var(--color-ink)]">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <h3 className="font-display text-2xl">{page.displayName}</h3>
                        {page.isPublished && !page.moderationHold ? (
                          <Link href={memberPath(page.slug)} className="mt-1 inline-flex min-h-11 items-center font-bold text-interactive-blue underline underline-offset-4">/m/{page.slug}</Link>
                        ) : (
                          <p className="mt-2 font-bold text-muted">/m/{page.slug}</p>
                        )}
                      </div>
                      {statusBadge}
                    </div>
                    <p className="mt-3 text-sm text-muted">Owner: {page.ownerUsername ? `@${page.ownerUsername}` : `Member ${page.ownerAccountId.slice(0, 8)}`}</p>
                    <AdminMemberRowControls page={page} accounts={data.accounts} />
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
