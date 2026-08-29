"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import type {
  MemberPageV2ActionFieldErrors,
  MemberPageV2AutosaveActionInput,
  MemberPageV2AutosaveActionResult,
  MemberPageV2PublishActionInput,
  MemberPageV2PublishActionResult,
  MemberPageV2ResetActionInput,
  MemberPageV2ResetActionResult,
  MemberPageV2UnpublishActionInput,
  MemberPageV2UnpublishActionResult,
} from "@/app/m/[member]/v2-actions";
import type { MemberBlock, MemberPageDocumentV2 } from "@/lib/members/v2/document";

import {
  AUTOSAVE_INVALID_MESSAGE,
  AutosaveController,
  type AutosaveRequestResult,
} from "./autosave-controller";
import {
  addBlock,
  deleteBlock,
  duplicateBlock,
  moveBlock,
  moveBlockToIndex,
  pairBlocks,
  replaceBlock,
  restoreBlock,
  setRowRatio,
  splitRow,
  swapRowSides,
  updateFrame,
  type BlockOperationResult,
} from "./document-ops";
import { createRandomIdGenerator, type MemberEditorIdGenerator } from "./ids";
import type { MemberBlockRowRatio } from "@/lib/members/v2/document";

export interface MemberEditorActions {
  autosave: (
    input: MemberPageV2AutosaveActionInput,
  ) => Promise<MemberPageV2AutosaveActionResult>;
  publish: (
    input: MemberPageV2PublishActionInput,
  ) => Promise<MemberPageV2PublishActionResult>;
  unpublish: (
    input: MemberPageV2UnpublishActionInput,
  ) => Promise<MemberPageV2UnpublishActionResult>;
  reset: (
    input: MemberPageV2ResetActionInput,
  ) => Promise<MemberPageV2ResetActionResult>;
  /**
   * Publication generation this editor loaded with: the server-issued
   * `publishedAt` boundary value, or null when the page has never been
   * published. The mount threads it through the actions object because that
   * is the one serializable channel from the server boundary to this hook.
   */
  initialPublishedAt?: string | null;
}

export type MemberPageEditorPublishResult =
  | MemberPageV2PublishActionResult
  | {
      status: "blocked" | "failed" | "invalid";
      message: string;
      fieldErrors: MemberPageV2ActionFieldErrors;
    };

export type MemberPageEditorUnpublishResult =
  | MemberPageV2UnpublishActionResult
  | { status: "failed"; message: string };

export type MemberPageEditorResetResult =
  | MemberPageV2ResetActionResult
  | { status: "cancelled" | "failed"; message: string };

export const RESET_CONFIRM_MESSAGE =
  "Reset replaces everything in this editor with your live page. Anything you have changed here will be gone. Continue?";

export interface UseMemberPageEditorOptions {
  slug: string;
  initialDocument: MemberPageDocumentV2;
  initialDraftRev: number;
  initialIsPublished: boolean;
  initialModerationHold: boolean;
  initialHasPublishedSnapshot: boolean;
  actions: MemberEditorActions;
  idGenerator?: MemberEditorIdGenerator;
  debounceMs?: number;
  /** Seam for the reset confirmation, so tests can answer it directly. */
  confirmReset?: (message: string) => boolean;
}

export type PublicationBusyKind = "publish" | "unpublish" | "reset" | null;

export interface UndoableDeletion {
  block: MemberBlock;
  index: number;
  label: string;
}

export function useMemberPageEditor(options: UseMemberPageEditorOptions) {
  const nextId = useMemo(
    () => options.idGenerator ?? createRandomIdGenerator(),
    [options.idGenerator],
  );

  const [document, setDocument] = useState(options.initialDocument);
  const [isPublished, setIsPublished] = useState(options.initialIsPublished);
  /**
   * The publication generation this tab may act on. Publish replaces it with
   * the new server-issued instant and unpublish clears it, so a tab that
   * missed another tab's publish sends a stale token and the server refuses
   * with a typed conflict instead of taking the newer page down.
   */
  const [publicationToken, setPublicationToken] = useState<string | null>(
    options.actions.initialPublishedAt ?? null,
  );
  const [hasPublishedSnapshot, setHasPublishedSnapshot] = useState(
    options.initialHasPublishedSnapshot,
  );
  const [announcement, setAnnouncement] = useState("");
  const [announcementSequence, setAnnouncementSequence] = useState(0);
  const [publicationMessage, setPublicationMessage] = useState("");
  const [busy, setBusy] = useState<PublicationBusyKind>(null);
  const [undoable, setUndoable] = useState<UndoableDeletion | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);

  const documentRef = useRef(document);
  useEffect(() => {
    documentRef.current = document;
  }, [document]);

  const controller = useMemo(
    () =>
      new AutosaveController({
        initialDraftRev: options.initialDraftRev,
        debounceMs: options.debounceMs,
        save: async ({ document: doc, expectedDraftRev }) => {
          const result = await options.actions.autosave({
            slug: options.slug,
            expectedDraftRev,
            document: doc,
          });
          return toAutosaveResult(result);
        },
      }),
    // The controller belongs to one mounted editor for one page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [options.slug],
  );

  /**
   * Reversible lifecycle.
   *
   * React replays effect cleanup and setup in development StrictMode, and can
   * do the same in production when it discards and restores a tree. Cleanup
   * therefore pauses the debounce clock rather than ending the controller: a
   * disposed controller would silently swallow every later edit and leave
   * Publish sending a stale revision.
   *
   * There is deliberately no `dispose` here. An effect cannot tell a replay
   * from a real unmount, so disposing in cleanup would reintroduce the same
   * bug. Pausing is enough for a real unmount too: it clears the timer, and
   * `useSyncExternalStore` drops its own listener, which leaves nothing
   * running and nothing able to touch React state afterwards.
   */
  useEffect(() => {
    controller.resume();
    return () => controller.pause();
  }, [controller]);

  const status = useSyncExternalStore(
    controller.subscribe,
    () => controller.snapshot(),
    () => controller.snapshot(),
  );

  useEffect(() => {
    if (!status.shouldWarnBeforeUnload) return;
    const handler = (event: BeforeUnloadEvent) => applyBeforeUnloadWarning(event);
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [status.shouldWarnBeforeUnload]);

  const commit = useCallback(
    (next: MemberPageDocumentV2) => {
      if (memberPageDocumentsEqual(documentRef.current, next)) return false;
      setDocument(next);
      documentRef.current = next;
      controller.queue(next);
      return true;
    },
    [controller],
  );

  const announce = useCallback((message: string) => {
    setAnnouncement(message);
    setAnnouncementSequence((current) => current + 1);
  }, []);

  const applyOperation = useCallback(
    (result: BlockOperationResult) => {
      if (result.status === "rejected") {
        announce(result.message);
        return false;
      }
      commit(result.document);
      announce(result.announcement);
      return true;
    },
    [announce, commit],
  );

  const api = {
    slug: options.slug,
    document,
    status,
    announcement,
    announcementSequence,
    publicationMessage,
    busy,
    undoable,
    selectedBlockId,
    isPublished,
    publicationToken,
    hasPublishedSnapshot,
    moderationHold: options.initialModerationHold,

    selectBlock: setSelectedBlockId,
    announce,

    updateFrameFields(patch: Partial<MemberPageDocumentV2["frame"]>) {
      commit(updateFrame(documentRef.current, patch));
    },

    updateBlock(block: MemberBlock) {
      commit(replaceBlock(documentRef.current, block));
    },

    addBlock(block: MemberBlock) {
      const result = addBlock(documentRef.current, block);
      if (applyOperation(result)) setSelectedBlockId(block.id);
      return result;
    },

    duplicateBlock(blockId: string) {
      const result = duplicateBlock(documentRef.current, blockId, nextId);
      if (applyOperation(result) && result.duplicatedId) {
        setSelectedBlockId(result.duplicatedId);
      }
      return result;
    },

    deleteBlock(blockId: string) {
      const result = deleteBlock(documentRef.current, blockId);
      if (result.status === "ok" && result.removed) {
        setUndoable({
          block: result.removed.block,
          index: result.removed.index,
          label: blockLabelFromResult(result.announcement),
        });
        if (selectedBlockId === blockId) {
          const nextIndex = Math.min(
            result.removed.index,
            result.document.blocks.length - 1,
          );
          const nextEntry = result.document.blocks[nextIndex];
          setSelectedBlockId(nextLeafId(nextEntry));
        }
      }
      applyOperation(result);
      return result;
    },

    undoDelete() {
      const pending = undoable;
      if (!pending) return undefined;
      const result = restoreBlock(documentRef.current, pending.block, pending.index);
      if (applyOperation(result)) {
        setUndoable(null);
        setSelectedBlockId(pending.block.id);
      }
      return result;
    },

    dismissUndo() {
      setUndoable(null);
    },

    moveBlock(blockId: string, direction: "up" | "down") {
      const moved = applyOperation(
        moveBlock(documentRef.current, blockId, direction),
      );
      if (moved) setSelectedBlockId(blockId);
      return moved;
    },

    reorderBlock(blockId: string, targetIndex: number) {
      const result = moveBlockToIndex(documentRef.current, blockId, targetIndex);
      if (applyOperation(result)) setSelectedBlockId(blockId);
      return result;
    },

    pairBlocks(blockId: string, side: "previous" | "next") {
      const result = pairBlocks(documentRef.current, blockId, side);
      if (applyOperation(result)) setSelectedBlockId(blockId);
      return result;
    },

    setRowRatio(blockId: string, ratio: MemberBlockRowRatio) {
      const result = setRowRatio(documentRef.current, blockId, ratio);
      if (applyOperation(result)) setSelectedBlockId(blockId);
      return result;
    },

    swapRowSides(blockId: string) {
      const result = swapRowSides(documentRef.current, blockId);
      if (applyOperation(result)) setSelectedBlockId(blockId);
      return result;
    },

    splitRow(blockId: string) {
      const result = splitRow(documentRef.current, blockId);
      if (applyOperation(result)) setSelectedBlockId(blockId);
      return result;
    },

    retrySave() {
      void controller.retry();
    },

    /**
     * Publish waits for the current revision to land first. A failed or
     * conflicted save blocks it outright rather than publishing stale content.
     */
    async publish(): Promise<MemberPageEditorPublishResult> {
      setBusy("publish");
      setPublicationMessage("");
      try {
        const flushed = await controller.flush();
        if (!flushed) {
          const message = publishBlockedMessage(controller.state);
          setPublicationMessage(message);
          return {
            status: controller.state === "invalid" ? "invalid" : "blocked",
            message,
            fieldErrors: actionFieldErrors(controller.snapshot().fieldErrors),
          };
        }

        const result = await options.actions.publish({
          slug: options.slug,
          expectedDraftRev: controller.draftRev,
        });
        if (result.status === "published") {
          setIsPublished(true);
          setHasPublishedSnapshot(true);
          setPublicationToken(result.publishedAt);
          setPublicationMessage("Published. Your page is live.");
          return result;
        }
        if (result.status === "conflict") {
          controller.markConflict(documentRef.current);
        }
        setPublicationMessage(result.message);
        return result;
      } catch {
        const message = "Publish could not reach the server. Try again.";
        setPublicationMessage(message);
        return { status: "failed", message, fieldErrors: {} };
      } finally {
        setBusy(null);
      }
    },

    async unpublish(): Promise<MemberPageEditorUnpublishResult> {
      setBusy("unpublish");
      setPublicationMessage("");
      try {
        const result = await options.actions.unpublish({
          slug: options.slug,
          expectedPublishedAt: publicationToken,
        });
        if (result.status === "unpublished") {
          setIsPublished(false);
          setPublicationToken(null);
          setPublicationMessage("Unpublished. Only you can see this page now.");
        } else {
          setPublicationMessage(result.message);
        }
        return result;
      } catch {
        const message = "Unpublish could not reach the server. Try again.";
        setPublicationMessage(message);
        return { status: "failed", message };
      } finally {
        setBusy(null);
      }
    },

    /**
     * Reset stays available under a moderation hold.
     *
     * It throws away everything in the editor, so it asks first. Queued local
     * work is discarded instead of autosaved; only a request already in flight
     * is allowed to settle so Reset can use the current known revision.
     */
    async reset(): Promise<MemberPageEditorResetResult> {
      setBusy("reset");
      setPublicationMessage("");
      try {
        const confirmed = (options.confirmReset ?? defaultConfirmReset)(
          RESET_CONFIRM_MESSAGE,
        );
        if (!confirmed) {
          const message = "Reset cancelled. Nothing changed.";
          setPublicationMessage(message);
          return { status: "cancelled", message };
        }

        const expectedDraftRev = await controller.prepareForReset();
        const result = await options.actions.reset({
          slug: options.slug,
          expectedDraftRev,
        });
        if (result.status === "reset") {
          setDocument(result.document);
          documentRef.current = result.document;
          setSelectedBlockId(null);
          setUndoable(null);
          controller.acceptServerDocument(result.draftRev);
          setPublicationMessage("Draft reset to your live page.");
        } else {
          controller.restoreAfterResetFailure(
            documentRef.current,
            result.status === "conflict",
          );
          setPublicationMessage(result.message);
        }
        return result;
      } catch {
        controller.restoreAfterResetFailure(documentRef.current);
        const message =
          "Reset could not reach the server. Your changes are still here. Try again.";
        setPublicationMessage(message);
        return { status: "failed", message };
      } finally {
        setBusy(null);
      }
    },
  };

  return api;
}

/**
 * Canonical V2 documents have deterministic key and array order. Comparing the
 * serialized value prevents editor transactions that make no semantic change
 * from consuming an autosave revision.
 */
export function memberPageDocumentsEqual(
  left: MemberPageDocumentV2,
  right: MemberPageDocumentV2,
): boolean {
  if (left === right) return true;
  return JSON.stringify(left) === JSON.stringify(right);
}

export type MemberPageEditorApi = ReturnType<typeof useMemberPageEditor>;

/** Says why publishing stopped, in terms of the next useful action. */
function publishBlockedMessage(state: string): string {
  if (state === "conflict") {
    return "Reload the editor before publishing. Your page changed somewhere else.";
  }
  if (state === "invalid") {
    return "Publishing needs a saved page. Fix the highlighted field first.";
  }
  return "Your latest change has not saved yet. Retry the save, then publish.";
}

/** Native confirm, guarded for the server pass where there is no window. */
function defaultConfirmReset(message: string): boolean {
  if (typeof window === "undefined") return false;
  return window.confirm(message);
}

/** Applies both browser signals required for a before-unload warning. */
export function applyBeforeUnloadWarning(
  event: Pick<BeforeUnloadEvent, "preventDefault" | "returnValue">,
): void {
  event.preventDefault();
  event.returnValue = "";
}

/**
 * Maps a server action result onto the controller's vocabulary.
 *
 * `invalid` is kept separate from `failed`: one means the document was refused
 * and needs an edit, the other means the request did not get through and is
 * worth another attempt.
 */
export function toAutosaveResult(
  result: MemberPageV2AutosaveActionResult,
): AutosaveRequestResult {
  switch (result.status) {
    case "saved":
      return { status: "saved", draftRev: result.draftRev };
    case "conflict":
      return { status: "conflict" };
    case "invalid": {
      // Prefer the server's own words about the field it refused; the generic
      // wording is a fallback, not a replacement.
      const detail = result.fieldErrors.document;
      return {
        status: "invalid",
        message: detail ? `${AUTOSAVE_INVALID_MESSAGE} ${detail}` : undefined,
        fieldErrors: result.fieldErrors,
      };
    }
    case "rate-limit":
    case "unavailable":
      return { status: "failed" };
  }
}

function actionFieldErrors(
  errors: Partial<Record<string, string>>,
): MemberPageV2ActionFieldErrors {
  return {
    ...(errors.slug ? { slug: errors.slug } : {}),
    ...(errors.expectedDraftRev
      ? { expectedDraftRev: errors.expectedDraftRev }
      : {}),
    ...(errors.document ? { document: errors.document } : {}),
  };
}

function blockLabelFromResult(announcement: string): string {
  return announcement.replace(/^Deleted /u, "").replace(/\. Undo.*$/u, "");
}

function nextLeafId(
  entry: MemberPageDocumentV2["blocks"][number] | undefined,
): string | null {
  if (!entry) return null;
  return entry.type === "row" ? entry.blocks[0].id : entry.id;
}
