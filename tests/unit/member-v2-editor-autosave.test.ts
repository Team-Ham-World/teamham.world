import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AutosaveController,
  type AutosaveRequestResult,
} from "@/components/member-page-editor/autosave-controller";
import type { MemberPageDocumentV2 } from "@/lib/members/v2/document";

import { minimalMemberPageDocument } from "../fixtures/member-v2/documents";

function docWithName(name: string): MemberPageDocumentV2 {
  const doc = minimalMemberPageDocument();
  return { ...doc, frame: { ...doc.frame, displayName: name } };
}

type SaveInput = { document: MemberPageDocumentV2; expectedDraftRev: number };

interface Harness {
  controller: AutosaveController;
  save: ReturnType<typeof vi.fn<(input: SaveInput) => Promise<AutosaveRequestResult>>>;
  states: () => string[];
}

function harness(save: (input: SaveInput) => Promise<AutosaveRequestResult>): Harness {
  const spy = vi.fn(save);
  const controller = new AutosaveController({
    initialDraftRev: 1,
    debounceMs: 800,
    save: spy,
  });
  const seen: string[] = [];
  controller.subscribe(() => {
    seen.push(controller.snapshot().state);
  });
  return { controller, save: spy, states: () => seen };
}

describe("autosave debouncing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    return () => vi.useRealTimers();
  });

  it("waits for the typing to settle before saving once", async () => {
    const h = harness(async () => ({ status: "saved", draftRev: 2 }));

    h.controller.queue(docWithName("A"));
    h.controller.queue(docWithName("AB"));
    h.controller.queue(docWithName("ABC"));

    expect(h.save).not.toHaveBeenCalled();
    expect(h.controller.snapshot().statusText).toBe("Unsaved changes");

    await vi.advanceTimersByTimeAsync(800);

    expect(h.save).toHaveBeenCalledTimes(1);
    expect(h.save.mock.calls[0][0].document.frame.displayName).toBe("ABC");
    expect(h.controller.snapshot().state).toBe("saved");
    expect(h.controller.draftRev).toBe(2);
  });

  it("keeps one save in flight and follows it with the newest text", async () => {
    const gate: { release: (() => void) | null } = { release: null };
    let rev = 1;
    const h = harness(async () => {
      await new Promise<void>((resolve) => {
        gate.release = resolve;
      });
      rev += 1;
      return { status: "saved", draftRev: rev };
    });

    h.controller.queue(docWithName("first"));
    await vi.advanceTimersByTimeAsync(800);
    expect(h.save).toHaveBeenCalledTimes(1);

    // More typing while the request is still open.
    h.controller.queue(docWithName("second"));
    h.controller.queue(docWithName("third"));
    await vi.advanceTimersByTimeAsync(800);
    expect(h.save).toHaveBeenCalledTimes(1);

    gate.release?.();
    await vi.advanceTimersByTimeAsync(800);

    expect(h.save).toHaveBeenCalledTimes(2);
    expect(h.save.mock.calls[1][0].document.frame.displayName).toBe("third");
    expect(h.save.mock.calls[1][0].expectedDraftRev).toBe(2);
  });

  it("reports a failure and can retry the same text", async () => {
    let attempt = 0;
    const h = harness(async () => {
      attempt += 1;
      return attempt === 1 ? { status: "failed" } : { status: "saved", draftRev: 2 };
    });

    h.controller.queue(docWithName("A"));
    await vi.advanceTimersByTimeAsync(800);

    expect(h.controller.snapshot().state).toBe("failed");
    expect(h.controller.snapshot().statusText).toBe("Save failed");
    expect(h.controller.snapshot().canRetry).toBe(true);
    expect(h.controller.snapshot().shouldWarnBeforeUnload).toBe(true);

    await h.controller.retry();

    expect(h.controller.snapshot().state).toBe("saved");
    expect(h.save).toHaveBeenCalledTimes(2);
  });

  it("pauses reversibly for StrictMode cleanup and saves edits after resume", async () => {
    const h = harness(async () => ({ status: "saved", draftRev: 2 }));

    // React StrictMode replays setup -> cleanup -> setup on mount.
    h.controller.resume();
    h.controller.pause();
    h.controller.resume();

    h.controller.queue(docWithName("Strict mode edit"));
    await vi.advanceTimersByTimeAsync(800);

    expect(h.controller.disposed).toBe(false);
    expect(h.controller.paused).toBe(false);
    expect(h.save).toHaveBeenCalledOnce();
    expect(h.save.mock.calls[0][0].document.frame.displayName).toBe(
      "Strict mode edit",
    );
    expect(h.controller.draftRev).toBe(2);
  });

  it("clears the debounce timer while paused and re-arms it on resume", async () => {
    const h = harness(async () => ({ status: "saved", draftRev: 2 }));

    h.controller.queue(docWithName("waiting"));
    h.controller.pause();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.save).not.toHaveBeenCalled();

    h.controller.resume();
    await vi.advanceTimersByTimeAsync(800);

    expect(h.save).toHaveBeenCalledOnce();
    expect(h.save.mock.calls[0][0].document.frame.displayName).toBe("waiting");
  });
});

describe("autosave conflict", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    return () => vi.useRealTimers();
  });

  it("stops saving and stops overwriting after a conflict", async () => {
    const h = harness(async () => ({ status: "conflict" }));

    h.controller.queue(docWithName("mine"));
    await vi.advanceTimersByTimeAsync(800);

    expect(h.controller.snapshot().state).toBe("conflict");
    expect(h.save).toHaveBeenCalledTimes(1);

    // Later edits must not be pushed over the other version.
    h.controller.queue(docWithName("mine again"));
    await vi.advanceTimersByTimeAsync(5000);

    expect(h.save).toHaveBeenCalledTimes(1);
    expect(h.controller.snapshot().state).toBe("conflict");
    expect(h.controller.snapshot().canRetry).toBe(false);
  });

  it("refuses to flush after a conflict", async () => {
    const h = harness(async () => ({ status: "conflict" }));

    h.controller.queue(docWithName("mine"));
    await vi.advanceTimersByTimeAsync(800);

    await expect(h.controller.flush()).resolves.toBe(false);
    expect(h.save).toHaveBeenCalledTimes(1);
  });
});

describe("autosave flush", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    return () => vi.useRealTimers();
  });

  it("sends pending text immediately instead of waiting out the delay", async () => {
    const h = harness(async () => ({ status: "saved", draftRev: 2 }));

    h.controller.queue(docWithName("pending"));
    expect(h.save).not.toHaveBeenCalled();

    const flushed = h.controller.flush();
    await vi.advanceTimersByTimeAsync(0);

    await expect(flushed).resolves.toBe(true);
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(h.controller.snapshot().state).toBe("saved");
  });

  it("is a no-op when everything is already saved", async () => {
    const h = harness(async () => ({ status: "saved", draftRev: 2 }));

    await expect(h.controller.flush()).resolves.toBe(true);
    expect(h.save).not.toHaveBeenCalled();
  });
});

describe("invalid autosave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    return () => vi.useRealTimers();
  });

  it("keeps the rejected document and field errors without offering Retry", async () => {
    const h = harness(async () => ({
      status: "invalid",
      message: "Fix the highlighted field.",
      fieldErrors: { document: "Project name is required." },
    }));

    h.controller.queue(docWithName("Local work"));
    await vi.advanceTimersByTimeAsync(800);

    expect(h.controller.snapshot()).toMatchObject({
      state: "invalid",
      statusText: "Not saved yet",
      canRetry: false,
      invalidMessage: "Fix the highlighted field.",
      fieldErrors: { document: "Project name is required." },
      hasPendingWork: true,
    });
    await expect(h.controller.retry()).resolves.toBe(false);
    expect(h.save).toHaveBeenCalledOnce();
    expect(h.save.mock.calls[0][0].document.frame.displayName).toBe("Local work");
  });

  it("resumes autosave after a corrected local edit", async () => {
    let attempt = 0;
    const h = harness(async () => {
      attempt += 1;
      return attempt === 1
        ? {
            status: "invalid",
            fieldErrors: { document: "Project name is required." },
          }
        : { status: "saved", draftRev: 2 };
    });

    h.controller.queue(docWithName("Invalid local work"));
    await vi.advanceTimersByTimeAsync(800);
    expect(h.controller.snapshot().state).toBe("invalid");

    h.controller.queue(docWithName("Corrected local work"));
    expect(h.controller.snapshot().state).toBe("unsaved");
    expect(h.controller.snapshot().fieldErrors).toEqual({});
    await vi.advanceTimersByTimeAsync(800);

    expect(h.save).toHaveBeenCalledTimes(2);
    expect(h.save.mock.calls[1][0].document.frame.displayName).toBe(
      "Corrected local work",
    );
    expect(h.controller.snapshot().state).toBe("saved");
  });

  it("validates a newer coalesced edit after the in-flight version is rejected", async () => {
    let releaseFirst!: () => void;
    let attempt = 0;
    const h = harness(async ({ expectedDraftRev }) => {
      attempt += 1;
      if (attempt === 1) {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        return {
          status: "invalid",
          fieldErrors: { document: "The older version is invalid." },
        };
      }
      return { status: "saved", draftRev: expectedDraftRev + 1 };
    });

    h.controller.queue(docWithName("Older invalid edit"));
    await vi.advanceTimersByTimeAsync(800);
    h.controller.queue(docWithName("Newer corrected edit"));

    releaseFirst();
    await vi.advanceTimersByTimeAsync(0);

    expect(h.save).toHaveBeenCalledTimes(2);
    expect(h.save.mock.calls[1][0].document.frame.displayName).toBe(
      "Newer corrected edit",
    );
    expect(h.controller.snapshot()).toMatchObject({
      state: "saved",
      draftRev: 2,
      fieldErrors: {},
    });
  });
});

describe("reset ordering", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    return () => vi.useRealTimers();
  });

  it("cancels the debounce timer and discards queued work without saving it", async () => {
    const h = harness(async () => ({ status: "saved", draftRev: 2 }));
    h.controller.queue(docWithName("Discard me"));

    await expect(h.controller.prepareForReset()).resolves.toBe(1);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(h.save).not.toHaveBeenCalled();
    h.controller.acceptServerDocument(2);
    expect(h.controller.snapshot().state).toBe("saved");
  });

  it("waits for an in-flight request and returns its successful revision", async () => {
    let release!: () => void;
    const h = harness(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { status: "saved", draftRev: 2 };
    });
    h.controller.queue(docWithName("Already sending"));
    await vi.advanceTimersByTimeAsync(800);

    const prepared = h.controller.prepareForReset();
    let settled = false;
    void prepared.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    release();
    await expect(prepared).resolves.toBe(2);
    expect(h.save).toHaveBeenCalledOnce();
  });

  it("restores failed local work when the reset action does not land", async () => {
    const h = harness(async () => ({ status: "failed" }));
    const local = docWithName("Keep me");
    h.controller.queue(local);
    await vi.advanceTimersByTimeAsync(800);
    expect(h.controller.snapshot().state).toBe("failed");

    await h.controller.prepareForReset();
    h.controller.restoreAfterResetFailure(local);

    expect(h.controller.snapshot()).toMatchObject({
      state: "failed",
      canRetry: true,
      hasPendingWork: true,
    });
  });
});
