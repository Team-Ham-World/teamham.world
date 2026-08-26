import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hookRuntime = vi.hoisted(() => {
  type Cleanup = void | (() => void);
  type Slot =
    | { kind: "state"; value: unknown }
    | { kind: "memo"; value: unknown; deps: readonly unknown[] | undefined }
    | { kind: "ref"; value: { current: unknown } }
    | {
        kind: "effect";
        deps: readonly unknown[] | undefined;
        cleanup: Cleanup;
      }
    | { kind: "external-store" };

  let slots: Slot[] = [];
  let cursor = 0;

  function sameDeps(
    left: readonly unknown[] | undefined,
    right: readonly unknown[] | undefined,
  ): boolean {
    if (left === undefined || right === undefined) return left === right;
    return (
      left.length === right.length &&
      left.every((value, index) => Object.is(value, right[index]))
    );
  }

  function reset(): void {
    for (const slot of slots) {
      if (slot.kind === "effect") slot.cleanup?.();
    }
    slots = [];
    cursor = 0;
  }

  function render<T>(callback: () => T): T {
    cursor = 0;
    return callback();
  }

  function useState<T>(initial: T | (() => T)) {
    const index = cursor;
    cursor += 1;
    let slot = slots[index];
    if (!slot) {
      slot = {
        kind: "state",
        value: typeof initial === "function" ? (initial as () => T)() : initial,
      };
      slots[index] = slot;
    }
    if (slot.kind !== "state") throw new Error("hook order changed");
    const setValue = (next: T | ((current: T) => T)) => {
      const current = slot.value as T;
      slot.value =
        typeof next === "function"
          ? (next as (value: T) => T)(current)
          : next;
    };
    return [slot.value as T, setValue] as const;
  }

  function memoValue<T>(factory: () => T, deps: readonly unknown[] | undefined): T {
    const index = cursor;
    cursor += 1;
    const slot = slots[index];
    if (slot?.kind === "memo" && sameDeps(slot.deps, deps)) {
      return slot.value as T;
    }
    const value = factory();
    slots[index] = { kind: "memo", value, deps };
    return value;
  }

  function useMemo<T>(factory: () => T, deps: readonly unknown[] | undefined): T {
    return memoValue(factory, deps);
  }

  function useRef<T>(initial: T): { current: T } {
    const index = cursor;
    cursor += 1;
    let slot = slots[index];
    if (!slot) {
      slot = { kind: "ref", value: { current: initial } };
      slots[index] = slot;
    }
    if (slot.kind !== "ref") throw new Error("hook order changed");
    return slot.value as { current: T };
  }

  function useEffect(
    effect: () => Cleanup,
    deps: readonly unknown[] | undefined,
  ): void {
    const index = cursor;
    cursor += 1;
    const slot = slots[index];
    if (slot?.kind === "effect" && sameDeps(slot.deps, deps)) return;
    if (slot?.kind === "effect") slot.cleanup?.();

    let cleanup = effect();
    if (!slot) {
      // Development StrictMode mount replay: setup, cleanup, setup.
      cleanup?.();
      cleanup = effect();
    }
    slots[index] = { kind: "effect", deps, cleanup };
  }

  function useSyncExternalStore<T>(
    _subscribe: (listener: () => void) => () => void,
    getSnapshot: () => T,
  ): T {
    const index = cursor;
    cursor += 1;
    slots[index] ??= { kind: "external-store" };
    return getSnapshot();
  }

  return {
    reset,
    render,
    useState,
    useMemo,
    useRef,
    useEffect,
    useSyncExternalStore,
    useCallback: <T>(callback: T, deps: readonly unknown[] | undefined) =>
      memoValue(() => callback, deps),
  };
});

vi.mock("react", () => ({
  useState: hookRuntime.useState,
  useMemo: hookRuntime.useMemo,
  useRef: hookRuntime.useRef,
  useEffect: hookRuntime.useEffect,
  useSyncExternalStore: hookRuntime.useSyncExternalStore,
  useCallback: hookRuntime.useCallback,
}));

import {
  RESET_CONFIRM_MESSAGE,
  applyBeforeUnloadWarning,
  toAutosaveResult,
  useMemberPageEditor,
  type MemberEditorActions,
  type UseMemberPageEditorOptions,
} from "@/components/member-page-editor/use-member-page-editor";
import type { MemberBlock, MemberPageDocumentV2 } from "@/lib/members/v2/document";
import { parseMemberPageDocumentV2 } from "@/lib/members/v2/validation";

import {
  externalProject,
  minimalMemberPageDocument,
} from "../fixtures/member-v2/documents";

const ACTION_TIME = "2026-08-25T00:00:00.000Z";

type AutosaveActionResult = Awaited<
  ReturnType<MemberEditorActions["autosave"]>
>;
type PublishActionResult = Awaited<ReturnType<MemberEditorActions["publish"]>>;
type UnpublishActionResult = Awaited<
  ReturnType<MemberEditorActions["unpublish"]>
>;
type ResetActionResult = Awaited<ReturnType<MemberEditorActions["reset"]>>;

function savedResult(
  draftRev: number,
): Extract<AutosaveActionResult, { status: "saved" }> {
  return {
    status: "saved",
    message: "Saved.",
    fieldErrors: {},
    draftRev,
    draftUpdatedAt: ACTION_TIME,
  };
}

function publishedResult(
  draftRev = 1,
): Extract<PublishActionResult, { status: "published" }> {
  return {
    status: "published",
    message: "Published.",
    fieldErrors: {},
    slug: "hamfriend",
    draftRev,
    publishedAt: ACTION_TIME,
  };
}

function unpublishedResult(): Extract<
  UnpublishActionResult,
  { status: "unpublished" }
> {
  return {
    status: "unpublished",
    message: "Unpublished.",
    fieldErrors: {},
    slug: "hamfriend",
    unpublishedAt: ACTION_TIME,
  };
}

function resetResult(
  document: MemberPageDocumentV2,
  draftRev: number,
): Extract<ResetActionResult, { status: "reset" }> {
  return {
    status: "reset",
    message: "Draft reset.",
    fieldErrors: {},
    document,
    draftRev,
    draftUpdatedAt: ACTION_TIME,
  };
}

function documentWithName(name: string): MemberPageDocumentV2 {
  const document = minimalMemberPageDocument();
  return {
    ...document,
    frame: { ...document.frame, displayName: name },
  };
}

function featuredBlock(id: string): MemberBlock {
  return {
    id,
    type: "featuredProject",
    variant: "card",
    project: externalProject("released", id),
  };
}

function calloutBlock(id: string): MemberBlock {
  return {
    id,
    type: "calloutQuote",
    variant: "note",
    text: `Text ${id}`,
    attribution: null,
  };
}

function createActions(
  overrides: Partial<MemberEditorActions> = {},
): MemberEditorActions {
  return {
    autosave: vi.fn(async ({ expectedDraftRev }) =>
      savedResult(expectedDraftRev + 1),
    ),
    publish: vi.fn(async () => publishedResult()),
    unpublish: vi.fn(async () => unpublishedResult()),
    reset: vi.fn(async ({ expectedDraftRev }) =>
      resetResult(minimalMemberPageDocument(), expectedDraftRev + 1),
    ),
    ...overrides,
  };
}

function createOptions(
  actions: MemberEditorActions,
  overrides: Partial<UseMemberPageEditorOptions> = {},
): UseMemberPageEditorOptions {
  return {
    slug: "hamfriend",
    initialDocument: minimalMemberPageDocument(),
    initialDraftRev: 1,
    initialIsPublished: false,
    initialModerationHold: false,
    initialHasPublishedSnapshot: true,
    actions,
    debounceMs: 800,
    confirmReset: vi.fn(() => true),
    ...overrides,
  };
}

function renderEditor(options: UseMemberPageEditorOptions) {
  return hookRuntime.render(() => useMemberPageEditor(options));
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((release) => {
    resolve = release;
  });
  return { promise, resolve };
}

describe("member page editor lifecycle and transitions", () => {
  beforeEach(() => {
    hookRuntime.reset();
    vi.useFakeTimers();
    vi.stubGlobal("window", {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      confirm: vi.fn(() => true),
      location: { reload: vi.fn() },
    });
  });

  afterEach(() => {
    hookRuntime.reset();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("survives StrictMode effect replay, saves the edit, and blocks stale publish", async () => {
    const saveGate = deferred();
    const autosave = vi.fn(async (
      input: Parameters<MemberEditorActions["autosave"]>[0],
    ) => {
      void input;
      await saveGate.promise;
      return savedResult(2);
    });
    const publish = vi.fn(async () => publishedResult(2));
    const actions = createActions({ autosave, publish });
    const options = createOptions(actions);
    const editor = renderEditor(options);

    editor.updateFrameFields({ displayName: "Strict mode edit" });
    const publishing = editor.publish();
    await Promise.resolve();

    expect(autosave).toHaveBeenCalledOnce();
    expect(autosave.mock.calls[0][0]).toMatchObject({
      slug: "hamfriend",
      expectedDraftRev: 1,
      document: {
        frame: { displayName: "Strict mode edit" },
      },
    });
    expect(publish).not.toHaveBeenCalled();

    saveGate.resolve();
    await publishing;

    expect(publish).toHaveBeenCalledWith({
      slug: "hamfriend",
      expectedDraftRev: 2,
    });
  });

  it("keeps the local version and warns on a publish revision conflict", async () => {
    const publish = vi.fn(async () => ({
      status: "conflict" as const,
      message: "Conflict detected." as const,
      fieldErrors: {},
    }));
    const actions = createActions({ publish });
    const options = createOptions(actions);

    const result = await renderEditor(options).publish();
    const after = renderEditor(options);

    expect(result.status).toBe("conflict");
    expect(after.status).toMatchObject({
      state: "conflict",
      shouldWarnBeforeUnload: true,
      hasPendingWork: true,
    });
    expect(after.publicationMessage).toBe("Conflict detected.");
  });

  it("keeps a curated theme change in the draft until explicit publish", async () => {
    const autosave = vi.fn(
      async ({ expectedDraftRev }: Parameters<MemberEditorActions["autosave"]>[0]) =>
        savedResult(expectedDraftRev + 1),
    );
    const publish = vi.fn(async () => publishedResult(2));
    const actions = createActions({ autosave, publish });
    const options = createOptions(actions);
    const editor = renderEditor(options);

    editor.updateFrameFields({
      theme: { id: "blueprint", accentId: "survey-orange" },
    });
    await vi.advanceTimersByTimeAsync(800);

    expect(autosave).toHaveBeenCalledOnce();
    expect(autosave.mock.calls[0][0].document.frame.theme).toEqual({
      id: "blueprint",
      accentId: "survey-orange",
    });
    expect(publish).not.toHaveBeenCalled();

    await renderEditor(options).publish();
    expect(publish).toHaveBeenCalledWith({
      slug: "hamfriend",
      expectedDraftRev: 2,
    });
  });

  it("confirms, then waits for an in-flight save before resetting", async () => {
    const saveGate = deferred();
    const autosave = vi.fn(async (
      input: Parameters<MemberEditorActions["autosave"]>[0],
    ) => {
      void input;
      await saveGate.promise;
      return savedResult(2);
    });
    const reset = vi.fn(async () =>
      resetResult(documentWithName("Live document"), 3),
    );
    const confirmReset = vi.fn(() => true);
    const actions = createActions({ autosave, reset });
    const options = createOptions(actions, { confirmReset });
    const editor = renderEditor(options);

    editor.updateFrameFields({ displayName: "Pending edit" });
    await vi.advanceTimersByTimeAsync(800);
    expect(autosave).toHaveBeenCalledOnce();

    const resetting = editor.reset();
    await Promise.resolve();
    expect(confirmReset).toHaveBeenCalledWith(RESET_CONFIRM_MESSAGE);
    expect(reset).not.toHaveBeenCalled();

    saveGate.resolve();
    await resetting;

    expect(reset).toHaveBeenCalledWith({
      slug: "hamfriend",
      expectedDraftRev: 2,
    });
    expect(confirmReset.mock.invocationCallOrder[0]).toBeLessThan(
      reset.mock.invocationCallOrder[0],
    );
    expect(autosave.mock.invocationCallOrder[0]).toBeLessThan(
      reset.mock.invocationCallOrder[0],
    );
  });

  it("cancels a pending autosave and resets without persisting the local edit", async () => {
    const autosave = vi.fn(async () => savedResult(2));
    const reset = vi.fn(async () =>
      resetResult(documentWithName("Live document"), 2),
    );
    const actions = createActions({ autosave, reset });
    const options = createOptions(actions);
    const editor = renderEditor(options);

    editor.updateFrameFields({ displayName: "Discard this edit" });
    await editor.reset();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(autosave).not.toHaveBeenCalled();
    expect(reset).toHaveBeenCalledWith({
      slug: "hamfriend",
      expectedDraftRev: 1,
    });
    expect(renderEditor(options).document.frame.displayName).toBe("Live document");
  });

  it.each([
    {
      label: "failed",
      result: {
        status: "unavailable",
        message: "Save unavailable.",
        fieldErrors: {},
      } satisfies AutosaveActionResult,
    },
    {
      label: "invalid",
      result: {
        status: "invalid",
        message: "Save failed.",
        fieldErrors: { document: "Review the page content and try again." },
      } satisfies AutosaveActionResult,
    },
  ])("resets from a $label autosave state", async ({ result }) => {
    const autosave = vi.fn(async () => result);
    const reset = vi.fn(async () =>
      resetResult(documentWithName("Live after failure"), 2),
    );
    const actions = createActions({ autosave, reset });
    const options = createOptions(actions);

    const editor = renderEditor(options);
    editor.updateFrameFields({ displayName: "Local rejected edit" });
    await vi.advanceTimersByTimeAsync(800);
    await renderEditor(options).reset();

    expect(reset).toHaveBeenCalledWith({
      slug: "hamfriend",
      expectedDraftRev: 1,
    });
    expect(renderEditor(options).document.frame.displayName).toBe(
      "Live after failure",
    );
  });

  it("resets while publishing is held", async () => {
    const reset = vi.fn(async () =>
      resetResult(documentWithName("Held live document"), 2),
    );
    const actions = createActions({ reset });
    const options = createOptions(actions, { initialModerationHold: true });

    await renderEditor(options).reset();

    expect(reset).toHaveBeenCalledOnce();
    expect(renderEditor(options).document.frame.displayName).toBe(
      "Held live document",
    );
  });

  it("keeps local work and exposes a conflict when reset is refused", async () => {
    const reset = vi.fn(async () => ({
      status: "conflict" as const,
      message: "Conflict detected." as const,
      fieldErrors: {},
    }));
    const actions = createActions({ reset });
    const options = createOptions(actions);
    const editor = renderEditor(options);

    editor.updateFrameFields({ displayName: "Keep this local edit" });
    await editor.reset();

    const after = renderEditor(options);
    expect(after.document.frame.displayName).toBe("Keep this local edit");
    expect(after.status.state).toBe("conflict");
    expect(after.publicationMessage).toBe("Conflict detected.");
  });

  it("maps every exact autosave action union member", () => {
    expect(toAutosaveResult(savedResult(7))).toEqual({
      status: "saved",
      draftRev: 7,
    });
    expect(
      toAutosaveResult({
        status: "conflict",
        message: "Conflict detected.",
        fieldErrors: {},
      }),
    ).toEqual({ status: "conflict" });
    expect(
      toAutosaveResult({
        status: "invalid",
        message: "Save failed.",
        fieldErrors: { document: "Rich text is required." },
      }),
    ).toEqual({
      status: "invalid",
      message:
        "Fix the highlighted field, then it will save. Rich text is required.",
      fieldErrors: { document: "Rich text is required." },
    });
    expect(
      toAutosaveResult({
        status: "unavailable",
        message: "Save unavailable.",
        fieldErrors: {},
      }),
    ).toEqual({ status: "failed" });
  });

  it("turns rejected autosave and publication promises into visible recovery states", async () => {
    const autosave = vi.fn(async () => {
      throw new Error("offline");
    });
    const publish = vi.fn(async () => {
      throw new Error("offline");
    });
    const unpublish = vi.fn(async () => {
      throw new Error("offline");
    });
    const actions = createActions({ autosave, publish, unpublish });
    const options = createOptions(actions, { initialIsPublished: true });

    const editor = renderEditor(options);
    editor.updateFrameFields({ displayName: "Local offline edit" });
    await vi.advanceTimersByTimeAsync(800);

    let after = renderEditor(options);
    expect(after.document.frame.displayName).toBe("Local offline edit");
    expect(after.status.state).toBe("failed");
    expect(after.status.canRetry).toBe(true);

    // Use a clean editor so the failed autosave does not intentionally block
    // the publication actions themselves.
    hookRuntime.reset();
    const cleanOptions = createOptions(actions, { initialIsPublished: true });
    const publishResult = await renderEditor(cleanOptions).publish();
    expect(publishResult.status).toBe("failed");
    after = renderEditor(cleanOptions);
    expect(after.publicationMessage).toMatch(/Publish could not reach/i);

    const unpublishResult = await after.unpublish();
    expect(unpublishResult.status).toBe("failed");
    after = renderEditor(cleanOptions);
    expect(after.isPublished).toBe(true);
    expect(after.publicationMessage).toMatch(/Unpublish could not reach/i);
  });

  it("catches a rejected reset, preserves local work, and keeps Retry available", async () => {
    const autosave = vi.fn(async () => ({
      status: "unavailable" as const,
      message: "Save unavailable." as const,
      fieldErrors: {},
    }));
    const reset = vi.fn(async () => {
      throw new Error("offline");
    });
    const actions = createActions({ autosave, reset });
    const options = createOptions(actions);

    const editor = renderEditor(options);
    editor.updateFrameFields({ displayName: "Keep after reset rejection" });
    await vi.advanceTimersByTimeAsync(800);
    const result = await renderEditor(options).reset();

    expect(result.status).toBe("failed");
    const after = renderEditor(options);
    expect(after.document.frame.displayName).toBe("Keep after reset rejection");
    expect(after.status.state).toBe("failed");
    expect(after.status.canRetry).toBe(true);
    expect(after.publicationMessage).toMatch(/Reset could not reach/i);
  });

  it("keeps invalid action field errors and resumes after a corrected edit", async () => {
    let attempt = 0;
    const autosave = vi.fn(async (
      input: Parameters<MemberEditorActions["autosave"]>[0],
    ) => {
      attempt += 1;
      return attempt === 1
        ? {
            status: "invalid" as const,
            message: "Save failed." as const,
            fieldErrors: { document: "Project name is required." },
          }
        : savedResult(input.expectedDraftRev + 1);
    });
    const actions = createActions({ autosave });
    const options = createOptions(actions);

    const first = renderEditor(options);
    first.updateFrameFields({ displayName: "Local invalid edit" });
    await vi.advanceTimersByTimeAsync(800);

    const rejected = renderEditor(options);
    expect(rejected.document.frame.displayName).toBe("Local invalid edit");
    expect(rejected.status).toMatchObject({
      state: "invalid",
      canRetry: false,
      fieldErrors: { document: "Project name is required." },
    });

    rejected.updateFrameFields({ displayName: "Corrected edit" });
    await vi.advanceTimersByTimeAsync(800);

    const saved = renderEditor(options);
    expect(saved.document.frame.displayName).toBe("Corrected edit");
    expect(saved.status.state).toBe("saved");
    expect(saved.status.fieldErrors).toEqual({});
    expect(autosave).toHaveBeenCalledTimes(2);
  });

  it("does not queue an invalid autosave when featured-project undo is rejected", async () => {
    const autosave = vi.fn(
      async ({ expectedDraftRev }: Parameters<MemberEditorActions["autosave"]>[0]) =>
        savedResult(expectedDraftRev + 1),
    );
    const actions = createActions({ autosave });
    const initialDocument = {
      ...minimalMemberPageDocument(),
      blocks: [featuredBlock("old-featured")],
    };
    const options = createOptions(actions, { initialDocument });

    const first = renderEditor(options);
    first.deleteBlock("old-featured");

    const afterDelete = renderEditor(options);
    afterDelete.addBlock(featuredBlock("new-featured"));

    const afterAdd = renderEditor(options);
    afterAdd.undoDelete();
    const afterUndo = renderEditor(options);

    expect(afterUndo.document.blocks.map((block) => block.id)).toEqual([
      "new-featured",
    ]);
    expect(afterUndo.announcement).toMatch(/one featured project/i);

    await vi.advanceTimersByTimeAsync(800);

    expect(autosave).toHaveBeenCalledOnce();
    const savedDocument = autosave.mock.calls[0][0].document;
    expect(savedDocument.blocks.map((block) => block.id)).toEqual([
      "new-featured",
    ]);
    expect(parseMemberPageDocumentV2(savedDocument).success).toBe(true);
  });

  it("does not queue an autosave for a semantically unchanged block", async () => {
    const autosave = vi.fn(
      async ({ expectedDraftRev }: Parameters<MemberEditorActions["autosave"]>[0]) =>
        savedResult(expectedDraftRev + 1),
    );
    const actions = createActions({ autosave });
    const initialDocument = {
      ...minimalMemberPageDocument(),
      blocks: [featuredBlock("same")],
    };
    const editor = renderEditor(createOptions(actions, { initialDocument }));
    const existing = editor.document.blocks[0];

    editor.updateBlock(structuredClone(existing));
    await vi.advanceTimersByTimeAsync(5_000);

    expect(autosave).not.toHaveBeenCalled();
    expect(renderEditor(createOptions(actions, { initialDocument })).status.state).toBe(
      "saved",
    );
  });

  it("keeps a logical selection target after delete, undo, add, and reorder", () => {
    const actions = createActions();
    const initialDocument = {
      ...minimalMemberPageDocument(),
      blocks: [calloutBlock("a"), calloutBlock("b")],
    };
    const options = createOptions(actions, { initialDocument });

    let editor = renderEditor(options);
    editor.selectBlock("a");
    editor = renderEditor(options);
    editor.deleteBlock("a");
    editor = renderEditor(options);
    expect(editor.selectedBlockId).toBe("b");

    editor.undoDelete();
    editor = renderEditor(options);
    expect(editor.selectedBlockId).toBe("a");

    editor.reorderBlock("a", 1);
    editor = renderEditor(options);
    expect(editor.selectedBlockId).toBe("a");

    editor.addBlock(calloutBlock("c"));
    editor = renderEditor(options);
    expect(editor.selectedBlockId).toBe("c");
  });

  it("increments the live-region sequence when the same message repeats", () => {
    const options = createOptions(createActions());
    let editor = renderEditor(options);

    editor.announce("Moved Gallery to position 2 of 3.");
    editor = renderEditor(options);
    const firstSequence = editor.announcementSequence;
    expect(editor.announcement).toBe("Moved Gallery to position 2 of 3.");

    editor.announce("Moved Gallery to position 2 of 3.");
    editor = renderEditor(options);
    expect(editor.announcement).toBe("Moved Gallery to position 2 of 3.");
    expect(editor.announcementSequence).toBe(firstSequence + 1);
  });

  it("sets both beforeunload cancellation signals", () => {
    const preventDefault = vi.fn();
    const event = { preventDefault, returnValue: undefined as unknown };

    applyBeforeUnloadWarning(event as never);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(event.returnValue).toBe("");
  });
});
