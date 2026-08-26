"use client";

import { useActionState, useState } from "react";

import {
  createMemberPageAction,
  manageMemberPageAction,
  type AdminMemberActionState,
} from "@/app/admin/members/actions";
import { FormSubmitButton } from "@/components/form-submit-button";
import type {
  AdminAccountOption,
  AdminMemberPageRow,
} from "@/lib/members/dal";
import { MEMBER_LIMITS } from "@/lib/members/validation";

const INITIAL_STATE: AdminMemberActionState = {
  status: "idle",
  message: "",
  fieldErrors: {},
};

const INPUT_CLASS =
  "mt-2 min-h-11 w-full border-2 border-ink bg-paper px-3 py-2 text-ink outline-none transition-shadow focus:shadow-[3px_3px_0_0_var(--color-interactive-blue)]";
const BUTTON_CLASS =
  "min-h-11 border-2 border-ink bg-ink px-4 py-2 text-sm font-bold tracking-[0.1em] text-paper uppercase shadow-[3px_3px_0_0_var(--color-muted)] transition-transform hover:-translate-y-0.5 active:translate-x-0.5 active:translate-y-0.5";

function AccountLabel({ account }: { account: AdminAccountOption }) {
  return <>{account.username ? `@${account.username}` : `Member ${account.id.slice(0, 8)}`}</>;
}

export function AdminMemberCreateForm({ accounts }: { accounts: AdminAccountOption[] }) {
  const [state, action] = useActionState(createMemberPageAction, INITIAL_STATE);
  return (
    <form action={action} className="mt-6 grid gap-5 lg:grid-cols-2" noValidate>
      <div>
        <label htmlFor="ownerAccountId" className="font-bold">Owner</label>
        <select id="ownerAccountId" name="ownerAccountId" required className={INPUT_CLASS}>
          <option value="">Choose an eligible account</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id} disabled={account.hasPage}>
              {account.username ? `@${account.username}` : `Member ${account.id.slice(0, 8)}`}
              {account.assignedPageSlug
                ? ` — owns /m/${account.assignedPageSlug}`
                : ""}
            </option>
          ))}
        </select>
        {state.fieldErrors.ownerAccountId ? <p className="mt-2 text-sm font-bold text-decorative-red">{state.fieldErrors.ownerAccountId}</p> : null}
      </div>
      <div>
        <label htmlFor="slug" className="font-bold">Member address</label>
        <div className="mt-2 flex min-h-11 items-stretch">
          <span className="flex items-center border-2 border-r-0 border-ink bg-surface px-3 text-sm font-bold text-muted">/m/</span>
          <input id="slug" name="slug" required maxLength={63} pattern="[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?" className="min-w-0 flex-1 border-2 border-ink bg-paper px-3 py-2 outline-none focus:shadow-[3px_3px_0_0_var(--color-interactive-blue)]" />
        </div>
        {state.fieldErrors.slug ? <p className="mt-2 text-sm font-bold text-decorative-red">{state.fieldErrors.slug}</p> : null}
      </div>
      <div className="lg:col-span-2">
        <label htmlFor="displayName" className="font-bold">Display name</label>
        <input id="displayName" name="displayName" required maxLength={MEMBER_LIMITS.displayName} className={INPUT_CLASS} />
        {state.fieldErrors.displayName ? <p className="mt-2 text-sm font-bold text-decorative-red">{state.fieldErrors.displayName}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-4 lg:col-span-2">
        <FormSubmitButton className={BUTTON_CLASS} pendingLabel="Creating…">Create page</FormSubmitButton>
        <p role="status" aria-live="polite" className={state.status === "error" ? "font-bold text-decorative-red" : "font-bold text-muted"}>{state.message}</p>
      </div>
    </form>
  );
}

export function AdminMemberRowControls({
  page,
  accounts,
}: {
  page: AdminMemberPageRow;
  accounts: AdminAccountOption[];
}) {
  const [state, action] = useActionState(manageMemberPageAction, INITIAL_STATE);
  const [isReassigning, setIsReassigning] = useState(false);
  const reassignPanelId = `reassign-owner-${page.id}`;
  const reassignToggle = (
    <button
      type="button"
      className={BUTTON_CLASS}
      aria-controls={reassignPanelId}
      aria-expanded={isReassigning}
      onClick={() => setIsReassigning((visible) => !visible)}
    >
      {isReassigning ? "Cancel reassign" : "Reassign"}
    </button>
  );

  return (
    <div className="mt-5 border-t border-muted/40 pt-5">
      {/* Moderation: Take down and hold / Clear hold */}
      {page.moderationHold ? (
        <div className="border-2 border-ink bg-surface p-4">
          <p className="text-sm font-bold text-ink">
            Moderation hold active
          </p>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            The owner can continue editing, uploading, and resetting their draft,
            but cannot publish while the hold is active. Clearing the hold leaves
            the page unpublished.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <form action={action}>
              <input type="hidden" name="slug" value={page.slug} />
              <input type="hidden" name="operation" value="clear-hold" />
              <FormSubmitButton className={BUTTON_CLASS} pendingLabel="Clearing…">
                Clear hold
              </FormSubmitButton>
            </form>
            {reassignToggle}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <form
            action={action}
            onSubmit={(event) => {
              const confirmed = window.confirm(
                `Take down /m/${page.slug} and place it on moderation hold?\n\nThis will immediately remove the page from public view. The owner can continue editing their draft but cannot publish while the hold is active.`
              );
              if (!confirmed) {
                event.preventDefault();
              }
            }}
          >
            <input type="hidden" name="slug" value={page.slug} />
            <input type="hidden" name="operation" value="take-down-and-hold" />
            <FormSubmitButton className={BUTTON_CLASS} pendingLabel="Taking down…">
              Take down and hold
            </FormSubmitButton>
          </form>
          {reassignToggle}
        </div>
      )}

      {isReassigning ? (
        <div
          id={reassignPanelId}
          className="mt-5 border-2 border-ink bg-surface p-4 shadow-[3px_3px_0_0_var(--color-muted)]"
        >
          <form
            action={action}
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
          >
            <input type="hidden" name="pageId" value={page.id} />
            <input type="hidden" name="operation" value="reassign" />
            <label className="min-w-0 flex-1 font-bold">
              New owner
              <select
                name="ownerAccountId"
                defaultValue={page.ownerAccountId}
                className={INPUT_CLASS}
              >
                {accounts.map((account) => (
                  <option
                    key={account.id}
                    value={account.id}
                    disabled={account.hasPage && account.id !== page.ownerAccountId}
                  >
                    <AccountLabel account={account} />
                    {account.id === page.ownerAccountId
                      ? " — current owner"
                      : account.assignedPageSlug
                        ? ` — owns /m/${account.assignedPageSlug}`
                        : ""}
                  </option>
                ))}
              </select>
            </label>
            <FormSubmitButton className={BUTTON_CLASS} pendingLabel="Reassigning…">
              Confirm reassign
            </FormSubmitButton>
          </form>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            Reassignment transfers the page&apos;s private draft and page-scoped
            assets to the new owner.
          </p>
        </div>
      ) : null}

      {/* Legacy publication controls: bridge period, non-cohort pages only. */}
      {!page.isV2Cohort ? (
        <details className="mt-5 border-2 border-dashed border-muted/60 p-4">
          <summary className="cursor-pointer text-sm font-bold text-muted">
            Legacy controls (bridge period)
          </summary>
          <form action={action} className="mt-4 flex flex-wrap items-end gap-3">
            <input type="hidden" name="pageId" value={page.id} />
            <input
              type="hidden"
              name="operation"
              value={page.isPublished ? "unpublish" : "publish"}
            />
            <FormSubmitButton className={BUTTON_CLASS} pendingLabel="Updating…">
              {page.isPublished ? "Unpublish" : "Publish"}
            </FormSubmitButton>
          </form>
        </details>
      ) : null}

      <p
        role="status"
        aria-live="polite"
        className={`mt-3 text-sm ${
          state.status === "error"
            ? "font-bold text-decorative-red"
            : "font-bold text-muted"
        }`}
      >
        {state.message}
      </p>
    </div>
  );
}
