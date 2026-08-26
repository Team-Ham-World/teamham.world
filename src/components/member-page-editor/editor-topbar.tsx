"use client";

import Link from "next/link";

import { memberPath } from "@/lib/site";

import { AUTOSAVE_INVALID_MESSAGE } from "./autosave-controller";
import {
  EDITOR_PRIMARY_CONTROL,
  EDITOR_QUIET_CONTROL,
} from "./editor-controls";
import { ArrowLeftIcon } from "./editor-icons";
import type { useMemberPageEditor } from "./use-member-page-editor";

export const PUBLISH_CONTROL_ID = "member-page-publish";
export const MODE_EDIT_CONTROL_ID = "member-page-mode-edit";
export const MODE_PREVIEW_CONTROL_ID = "member-page-mode-preview";

export type EditorMode = "edit" | "preview";

type Editor = ReturnType<typeof useMemberPageEditor>;

const MODE_CONTROL = `${EDITOR_QUIET_CONTROL} border-0 px-3 aria-pressed:bg-ink aria-pressed:text-paper aria-pressed:hover:bg-interactive-blue aria-pressed:hover:text-paper`;

/** Rarely used next to Publish, so it gives up width first on small screens. */
const SECONDARY_CONTROL = `${EDITOR_QUIET_CONTROL} px-2 text-xs sm:px-3 sm:text-sm`;

/**
 * The editor's one persistent bar.
 *
 * Save state, the way out, the Edit/Preview switch, and publication all live
 * here and stay put while the canvas scrolls. Previously the save state and
 * Publish sat in a block at the top of the document, which scrolled away after
 * the first screen of a page that runs to dozens of them, and the Preview
 * switch existed only on narrow screens.
 */
export function EditorTopBar({
  slug,
  editor,
  mode,
  publishErrors,
  onModeChange,
  onPublish,
  onReset,
}: {
  slug: string;
  editor: Editor;
  mode: EditorMode;
  publishErrors: readonly string[];
  onModeChange: (mode: EditorMode) => void;
  onPublish: (invoker: HTMLButtonElement) => void;
  onReset: () => void;
}) {
  const { status } = editor;
  const publishBlocked =
    editor.moderationHold ||
    status.state === "failed" ||
    status.state === "conflict" ||
    editor.busy !== null;

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 border-b-2 border-ink bg-surface px-3 py-2 sm:gap-x-4 sm:px-5">
      <Link
        href={memberPath(slug)}
        aria-label="Done editing"
        className={`${EDITOR_QUIET_CONTROL} shrink-0 px-2 sm:px-3`}
      >
        <ArrowLeftIcon />
        <span className="hidden sm:inline">Done editing</span>
      </Link>

      <div className="flex min-w-0 items-center gap-2">
        {/*
          * The slug is orientation, not state. On a phone it is the first
          * thing to go: an owner can only ever edit their own page, and the
          * row it frees keeps Publish beside the Edit/Preview switch.
          */}
        <span className="hidden truncate text-sm font-bold text-ink sm:inline">
          /m/{slug}
        </span>
        <StateChip
          tone={editor.moderationHold ? "warn" : editor.isPublished ? "live" : "quiet"}
        >
          {editor.moderationHold
            ? "On hold"
            : editor.isPublished
              ? "Live"
              : "Private"}
        </StateChip>
        {/*
          * The chip is a glance; the sentence is the fact. Assistive tech gets
          * the sentence so nobody has to infer what a one-word badge means
          * before deciding whether to publish.
          */}
        <span className="sr-only">
          {editor.isPublished
            ? "This page is live."
            : "This page is private to you."}
        </span>
      </div>

      <p
        aria-live="polite"
        aria-atomic="true"
        role="status"
        data-autosave-state={status.state}
        className="min-w-0 truncate text-xs font-bold text-ink sm:text-sm"
      >
        {status.statusText}
      </p>

      {/*
        * On a phone the action group dissolves into the bar itself, so the
        * controls pack across the available rows instead of reserving a block
        * wide enough to push Publish onto a line of its own.
        */}
      <div className="contents sm:ml-auto sm:flex sm:flex-wrap sm:items-center sm:justify-end sm:gap-2">
        <div
          role="group"
          aria-label="Editor mode"
          className="flex shrink-0 border border-ink/45"
        >
          {(["edit", "preview"] as const).map((value) => (
            <button
              id={value === "edit" ? MODE_EDIT_CONTROL_ID : MODE_PREVIEW_CONTROL_ID}
              key={value}
              type="button"
              aria-pressed={mode === value}
              className={MODE_CONTROL}
              onClick={() => onModeChange(value)}
            >
              {value === "edit" ? "Edit" : "Preview"}
            </button>
          ))}
        </div>

        {status.canRetry ? (
          <button
            type="button"
            className={SECONDARY_CONTROL}
            onClick={() => editor.retrySave()}
          >
            Retry save
          </button>
        ) : null}
        {status.state === "conflict" ? (
          <button
            type="button"
            className={SECONDARY_CONTROL}
            onClick={() => window.location.reload()}
          >
            Reload editor
          </button>
        ) : null}
        {editor.hasPublishedSnapshot ? (
          <button
            type="button"
            className={SECONDARY_CONTROL}
            disabled={editor.busy !== null}
            onClick={onReset}
          >
            {editor.busy === "reset" ? "Resetting…" : "Reset to live"}
          </button>
        ) : null}
        {editor.isPublished ? (
          <button
            type="button"
            className={SECONDARY_CONTROL}
            disabled={editor.busy !== null}
            onClick={() => void editor.unpublish()}
          >
            Unpublish
          </button>
        ) : null}
        <button
          id={PUBLISH_CONTROL_ID}
          type="button"
          className={`${EDITOR_PRIMARY_CONTROL} px-3 py-2 text-xs sm:px-4 sm:text-sm`}
          disabled={publishBlocked}
          aria-describedby={
            publishErrors.length > 0 ? "publish-error-summary" : undefined
          }
          onClick={(event) => onPublish(event.currentTarget)}
        >
          {editor.busy === "publish" ? "Publishing…" : "Publish"}
        </button>
      </div>
    </div>
  );
}

function StateChip({
  tone,
  children,
}: {
  tone: "live" | "quiet" | "warn";
  children: React.ReactNode;
}) {
  const skin =
    tone === "live"
      ? "border-ink bg-ink text-paper"
      : tone === "warn"
        ? "border-decorative-red bg-paper text-ink"
        : "border-ink/45 bg-paper text-muted";
  return (
    <span
      aria-hidden="true"
      className={`shrink-0 border px-2 py-0.5 text-[0.6rem] font-bold tracking-[0.14em] uppercase ${skin}`}
    >
      {children}
    </span>
  );
}

/**
 * Everything the owner must read before publishing, in one strip.
 *
 * These messages used to be stacked inside the publication block. Pinned
 * directly under the bar they stay visible for as long as they apply, and the
 * bar itself never changes height as they come and go.
 */
export function EditorNoticeStrip({
  editor,
  publishErrors,
  onFocusFirstError,
}: {
  editor: Editor;
  publishErrors: readonly string[];
  onFocusFirstError: () => void;
}) {
  const { status } = editor;
  const hasNotice =
    publishErrors.length > 0 ||
    editor.moderationHold ||
    status.state === "conflict" ||
    status.state === "invalid" ||
    Boolean(editor.publicationMessage);
  if (!hasNotice) return null;

  return (
    <div className="min-w-0 space-y-2 border-b-2 border-ink bg-paper px-4 py-3 sm:px-5">
      {publishErrors.length > 0 ? (
        <section
          id="publish-error-summary"
          aria-labelledby="publish-error-heading"
          className="border-2 border-decorative-red bg-surface p-3"
        >
          <h3
            id="publish-error-heading"
            className="flex items-center gap-2 text-sm font-bold"
          >
            <span aria-hidden="true">&#9888;</span> Fix this before publishing
          </h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink">
            {publishErrors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
          <button
            type="button"
            className={`${EDITOR_QUIET_CONTROL} mt-3`}
            onClick={onFocusFirstError}
          >
            Go to first problem
          </button>
        </section>
      ) : null}

      {editor.moderationHold ? (
        <Notice tone="alert">
          An administrator placed this page on hold, so publishing is off for
          now. You can keep editing and you can still reset to your last live
          version.
        </Notice>
      ) : null}

      {status.state === "conflict" ? (
        <Notice tone="plain">
          Your page changed somewhere else, so saving stopped to protect both
          versions. Your text here is untouched. Reload the editor to pick up
          the stored draft.
        </Notice>
      ) : null}

      {status.state === "invalid" ? (
        <Notice tone="alert">
          {status.invalidMessage ?? AUTOSAVE_INVALID_MESSAGE} Your work is still
          here and will save as soon as it is valid.
        </Notice>
      ) : null}

      {editor.publicationMessage ? (
        <p
          aria-live="polite"
          aria-atomic="true"
          className="text-sm font-bold text-ink"
        >
          {editor.publicationMessage}
        </p>
      ) : null}
    </div>
  );
}

function Notice({
  tone,
  children,
}: {
  tone: "alert" | "plain";
  children: React.ReactNode;
}) {
  return (
    <p
      className={`flex items-start gap-2 border-2 bg-surface p-3 text-sm ${
        tone === "alert"
          ? "border-decorative-red font-bold text-ink"
          : "border-ink text-ink"
      }`}
    >
      <span aria-hidden="true">&#9888;</span>
      <span>{children}</span>
    </p>
  );
}
