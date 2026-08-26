import type { MemberPageDocumentV2 } from "@/lib/members/v2/document";

/**
 * Autosave state machine for the owner editor.
 *
 * Deliberately framework-free so its timing rules are testable with fake
 * timers and fake actions. Rules it enforces:
 *
 * - local edits are immediate; the server request is debounced;
 * - single-flight: one save in flight, later edits coalesce into the next one;
 * - a failure keeps the local document and exposes Retry;
 * - a conflict stops all automatic saving, keeps the local document, and waits
 *   for the owner to reload the editor. There is no silent merge.
 */

export type AutosaveState =
  | "saved"
  | "unsaved"
  | "saving"
  | "failed"
  | "invalid"
  | "conflict";

export const AUTOSAVE_STATUS_TEXT: Record<AutosaveState, string> = {
  saved: "Saved",
  unsaved: "Unsaved changes",
  saving: "Saving…",
  failed: "Save failed",
  invalid: "Not saved yet",
  conflict: "Conflict detected",
};

export const AUTOSAVE_DEBOUNCE_MS = 800;

/**
 * Shown when the server refused the document itself.
 *
 * Resending the same content would fail the same way, so this state offers no
 * Retry. It asks for the one thing that will actually help.
 */
export const AUTOSAVE_INVALID_MESSAGE =
  "Fix the highlighted field, then it will save.";

export type AutosaveRequestResult =
  | { status: "saved"; draftRev: number }
  | { status: "conflict" }
  | {
      status: "invalid";
      message?: string;
      fieldErrors?: Partial<Record<string, string>>;
    }
  | { status: "failed" };

export interface AutosaveSnapshot {
  state: AutosaveState;
  statusText: string;
  draftRev: number;
  /** True while a local edit has not yet reached the server. */
  hasPendingWork: boolean;
  /** True when navigating away would lose work. */
  shouldWarnBeforeUnload: boolean;
  canRetry: boolean;
  /** Set only for `invalid`, where the fix is a field edit, not a resend. */
  invalidMessage: string | null;
  /** Server field errors retained while the rejected local document is shown. */
  fieldErrors: Partial<Record<string, string>>;
}

export interface AutosaveControllerOptions {
  initialDraftRev: number;
  save: (input: {
    document: MemberPageDocumentV2;
    expectedDraftRev: number;
  }) => Promise<AutosaveRequestResult>;
  debounceMs?: number;
  scheduler?: {
    setTimeout: (fn: () => void, ms: number) => unknown;
    clearTimeout: (handle: unknown) => void;
  };
}

type ResetRestoreState = "saved" | "failed" | "invalid" | "conflict";

interface ResetContext {
  discardedDocument: MemberPageDocumentV2 | null;
  restoreState: ResetRestoreState;
  invalidMessage: string | null;
  fieldErrors: Partial<Record<string, string>>;
  waiters: Array<() => void>;
}

const defaultScheduler = {
  setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
  clearTimeout: (handle: unknown) => clearTimeout(handle as never),
};

export class AutosaveController {
  #state: AutosaveState = "saved";
  #draftRev: number;
  #pending: MemberPageDocumentV2 | null = null;
  #inFlight: MemberPageDocumentV2 | null = null;
  #timer: unknown = null;
  #flushWaiters: Array<(ok: boolean) => void> = [];
  #disposed = false;
  #paused = false;
  #invalidMessage: string | null = null;
  #fieldErrors: Partial<Record<string, string>> = {};
  #resetContext: ResetContext | null = null;
  #listeners = new Set<() => void>();
  #cachedSnapshot: AutosaveSnapshot;

  readonly #save: AutosaveControllerOptions["save"];
  readonly #debounceMs: number;
  readonly #scheduler: NonNullable<AutosaveControllerOptions["scheduler"]>;

  constructor(options: AutosaveControllerOptions) {
    this.#draftRev = options.initialDraftRev;
    this.#save = options.save;
    this.#debounceMs = options.debounceMs ?? AUTOSAVE_DEBOUNCE_MS;
    this.#scheduler = options.scheduler ?? defaultScheduler;
    this.#cachedSnapshot = this.#buildSnapshot();
  }

  get state(): AutosaveState {
    return this.#state;
  }

  get draftRev(): number {
    return this.#draftRev;
  }

  /**
   * Stable snapshot for `useSyncExternalStore`.
   *
   * The object identity changes only when state actually changes, so React can
   * compare snapshots without looping.
   */
  snapshot(): AutosaveSnapshot {
    return this.#cachedSnapshot;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  #buildSnapshot(): AutosaveSnapshot {
    const pendingWork =
      this.#pending !== null || this.#inFlight !== null || this.#state === "failed";
    return {
      state: this.#state,
      statusText: AUTOSAVE_STATUS_TEXT[this.#state],
      draftRev: this.#draftRev,
      hasPendingWork: pendingWork,
      shouldWarnBeforeUnload:
        this.#state === "conflict" ||
        this.#state === "failed" ||
        this.#state === "invalid" ||
        pendingWork ||
        this.#state === "unsaved",
      // A rejected document is not a transport problem, so resending it
      // unchanged would only fail again.
      canRetry: this.#state === "failed",
      invalidMessage: this.#state === "invalid" ? this.#invalidMessage : null,
      fieldErrors: this.#state === "invalid" ? this.#fieldErrors : {},
    };
  }

  /** Records a local edit. Never blocks the caller's immediate UI update. */
  queue(document: MemberPageDocumentV2): void {
    if (this.#disposed) return;
    // Reset owns the request ordering while it is active. Keep the newest local
    // document only as recovery data in case Reset itself fails; never let it
    // start an autosave ahead of the destructive action.
    if (this.#resetContext) {
      this.#resetContext.discardedDocument = document;
      if (this.#resetContext.restoreState !== "conflict") {
        this.#resetContext.restoreState = "failed";
        this.#resetContext.invalidMessage = null;
        this.#resetContext.fieldErrors = {};
        this.#state = "unsaved";
      }
      this.#emit();
      return;
    }
    // A conflict must not be overwritten automatically.
    if (this.#state === "conflict") {
      this.#pending = document;
      this.#emit();
      return;
    }

    this.#pending = document;
    // A fresh edit is the fix for a rejected document, so saving resumes.
    if (this.#state === "invalid") {
      this.#invalidMessage = null;
      this.#fieldErrors = {};
    }
    if (this.#state !== "saving") this.#state = "unsaved";
    if (!this.#paused) this.#restartTimer();
    this.#emit();
  }

  /** Sends the pending edit now and resolves once the draft is current. */
  async flush(): Promise<boolean> {
    if (this.#disposed) return false;
    // Neither a conflict nor a rejected document is fixed by sending again.
    if (this.#state === "conflict" || this.#state === "invalid") return false;
    this.#clearTimer();

    if (this.#pending === null && this.#inFlight === null) {
      return this.#state !== "failed";
    }

    const settled = new Promise<boolean>((resolve) => {
      this.#flushWaiters.push(resolve);
    });
    if (this.#inFlight === null) void this.#run();
    return settled;
  }

  /** Explicit Retry, offered only after a transport failure. */
  async retry(): Promise<boolean> {
    if (this.#disposed) return false;
    if (this.#state === "conflict" || this.#state === "invalid") return false;
    if (this.#pending === null) {
      this.#state = "saved";
      this.#emit();
      return true;
    }
    return this.flush();
  }

  /**
   * Adopts a document the server just handed back, as Reset does.
   *
   * Nothing is queued: the local document already equals the stored draft at
   * this revision, so the editor returns to a clean saved state.
   */
  acceptServerDocument(draftRev: number): void {
    this.#clearTimer();
    this.#pending = null;
    this.#resetContext = null;
    this.#invalidMessage = null;
    this.#fieldErrors = {};
    this.#draftRev = draftRev;
    this.#state = "saved";
    this.#emit();
  }

  /**
   * Stops automatic writes after a publication transition discovers that the
   * server draft moved beyond this editor's known revision.
   *
   * Publish runs only after `flush()`, so there is normally no queued
   * autosave work left when this happens. Retaining the document explicitly
   * still matters: it keeps the unload warning active and makes the local
   * version recoverable instead of incorrectly reporting `Saved`.
   */
  markConflict(document: MemberPageDocumentV2): void {
    if (this.#disposed) return;
    this.#clearTimer();
    this.#pending = document;
    this.#invalidMessage = null;
    this.#fieldErrors = {};
    this.#state = "conflict";
    this.#emit();
    this.#settleFlush(false);
  }

  /**
   * Cancels queued autosave work before Reset and waits only for the request
   * that is already impossible to cancel.
   *
   * The returned revision includes a successful in-flight save. Queued,
   * failed, invalid, or conflicted local work is deliberately not sent first.
   */
  async prepareForReset(): Promise<number> {
    if (this.#disposed) return this.#draftRev;
    if (this.#resetContext) {
      if (this.#inFlight !== null) {
        await new Promise<void>((resolve) => {
          this.#resetContext?.waiters.push(resolve);
        });
      }
      return this.#draftRev;
    }

    this.#clearTimer();
    this.#resetContext = {
      discardedDocument: this.#pending,
      restoreState: resetRestoreState(this.#state),
      invalidMessage: this.#invalidMessage,
      fieldErrors: this.#fieldErrors,
      waiters: [],
    };
    this.#pending = null;

    if (this.#inFlight !== null) {
      await new Promise<void>((resolve) => {
        this.#resetContext?.waiters.push(resolve);
      });
    }
    return this.#draftRev;
  }

  /** Restores recoverable autosave state when the Reset action did not land. */
  restoreAfterResetFailure(
    document: MemberPageDocumentV2,
    forceConflict = false,
  ): void {
    const context = this.#resetContext;
    if (!context) return;
    this.#resetContext = null;
    this.#clearTimer();

    const restoreState = forceConflict ? "conflict" : context.restoreState;
    if (restoreState === "saved" && context.discardedDocument === null) {
      this.#pending = null;
      this.#invalidMessage = null;
      this.#fieldErrors = {};
      this.#state = "saved";
      this.#emit();
      return;
    }

    this.#pending = document;
    this.#state = restoreState === "saved" ? "failed" : restoreState;
    this.#invalidMessage =
      this.#state === "invalid"
        ? context.invalidMessage ?? AUTOSAVE_INVALID_MESSAGE
        : null;
    this.#fieldErrors = this.#state === "invalid" ? context.fieldErrors : {};
    this.#emit();
  }

  /**
   * Stops the debounce clock without ending the controller's life.
   *
   * React runs effect cleanup and setup again in development StrictMode, and
   * it can do the same in production when it discards and restores a tree.
   * Pausing there is reversible; disposing is not, which is why cleanup uses
   * this and only a genuine teardown calls `dispose`.
   *
   * Pending work is kept. A request already in flight is left to settle, since
   * it is the current document on its way to the server.
   */
  pause(): void {
    if (this.#disposed || this.#paused) return;
    this.#paused = true;
    this.#clearTimer();
  }

  /** Re-arms the debounce clock if an edit is still waiting to be saved. */
  resume(): void {
    if (this.#disposed || !this.#paused) return;
    this.#paused = false;
    if (
      this.#pending !== null &&
      this.#inFlight === null &&
      this.#state !== "conflict" &&
      this.#state !== "invalid"
    ) {
      this.#restartTimer();
    }
  }

  get paused(): boolean {
    return this.#paused;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  /** Permanent teardown. Leaves no timer and no listeners behind. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#clearTimer();
    this.#listeners.clear();
    this.#settleFlush(this.#state === "saved");
  }

  #restartTimer(): void {
    this.#clearTimer();
    this.#timer = this.#scheduler.setTimeout(() => {
      this.#timer = null;
      if (this.#inFlight === null) void this.#run();
    }, this.#debounceMs);
  }

  #clearTimer(): void {
    if (this.#timer !== null) {
      this.#scheduler.clearTimeout(this.#timer);
      this.#timer = null;
    }
  }

  async #run(): Promise<void> {
    if (this.#inFlight !== null) return;
    const document = this.#pending;
    if (document === null) {
      this.#settleFlush(this.#state !== "failed");
      return;
    }

    this.#pending = null;
    this.#inFlight = document;
    this.#state = "saving";
    this.#emit();

    let result: AutosaveRequestResult;
    try {
      result = await this.#save({
        document,
        expectedDraftRev: this.#draftRev,
      });
    } catch {
      result = { status: "failed" };
    }

    this.#inFlight = null;

    if (this.#resetContext) {
      const context = this.#resetContext;
      if (result.status === "saved") {
        this.#draftRev = result.draftRev;
        if (context.discardedDocument === null) {
          context.restoreState = "saved";
          context.invalidMessage = null;
          context.fieldErrors = {};
          this.#state = "saved";
        } else if (context.restoreState !== "conflict") {
          context.restoreState = "failed";
          this.#state = "failed";
        }
      } else if (result.status === "conflict") {
        context.discardedDocument ??= document;
        context.restoreState = "conflict";
        context.invalidMessage = null;
        context.fieldErrors = {};
        this.#state = "conflict";
      } else if (result.status === "invalid") {
        context.discardedDocument ??= document;
        context.restoreState = "invalid";
        context.invalidMessage = result.message ?? AUTOSAVE_INVALID_MESSAGE;
        context.fieldErrors = result.fieldErrors ?? {};
        this.#invalidMessage = context.invalidMessage;
        this.#fieldErrors = context.fieldErrors;
        this.#state = "invalid";
      } else {
        context.discardedDocument ??= document;
        context.restoreState = "failed";
        context.invalidMessage = null;
        context.fieldErrors = {};
        this.#state = "failed";
      }
      this.#emit();
      this.#settleFlush(false);
      const waiters = context.waiters;
      context.waiters = [];
      for (const resolve of waiters) resolve();
      return;
    }

    if (result.status === "saved") {
      this.#draftRev = result.draftRev;
      if (this.#pending !== null) {
        // Coalesced edits arrived while this request was in flight.
        this.#state = "unsaved";
        this.#emit();
        // While paused there is no editor on screen to save for; the work is
        // kept and picked up by `resume`.
        if (!this.#paused && !this.#disposed) void this.#run();
        return;
      }
      this.#state = "saved";
      this.#emit();
      this.#settleFlush(true);
      return;
    }

    if (result.status === "conflict") {
      // Keep the local document; stop saving automatically.
      this.#pending = this.#pending ?? document;
      this.#state = "conflict";
      this.#clearTimer();
      this.#emit();
      this.#settleFlush(false);
      return;
    }

    if (result.status === "invalid") {
      if (this.#pending !== null) {
        // This rejection describes the older in-flight document, not the
        // newer coalesced edit. Let that newer version run through validation
        // instead of stranding it behind a stale `invalid` state.
        this.#invalidMessage = null;
        this.#fieldErrors = {};
        this.#state = "unsaved";
        this.#emit();
        if (!this.#paused && !this.#disposed) void this.#run();
        return;
      }
      // The server refused this content. Keep it on screen so the owner can
      // correct it, but stop the clock: another attempt would be refused too.
      this.#pending = document;
      this.#invalidMessage = result.message ?? AUTOSAVE_INVALID_MESSAGE;
      this.#fieldErrors = result.fieldErrors ?? {};
      this.#state = "invalid";
      this.#clearTimer();
      this.#emit();
      this.#settleFlush(false);
      return;
    }

    // Failure: keep local content for Retry.
    this.#pending = this.#pending ?? document;
    this.#state = "failed";
    this.#emit();
    this.#settleFlush(false);
  }

  #settleFlush(ok: boolean): void {
    const waiters = this.#flushWaiters;
    this.#flushWaiters = [];
    for (const resolve of waiters) resolve(ok);
  }

  #emit(): void {
    this.#cachedSnapshot = this.#buildSnapshot();
    for (const listener of this.#listeners) listener();
  }
}

function resetRestoreState(state: AutosaveState): ResetRestoreState {
  if (state === "conflict") return "conflict";
  if (state === "invalid") return "invalid";
  if (state === "failed" || state === "unsaved") return "failed";
  return "saved";
}
