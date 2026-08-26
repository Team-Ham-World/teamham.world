import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  recordLegacyFallbackRender,
  resetLegacyFallbackDiagnostics,
} from "@/components/member-page-editor/legacy-fallback-diagnostic";

describe("legacy member-page fallback diagnostic", () => {
  beforeEach(() => {
    resetLegacyFallbackDiagnostics();
  });

  it("emits a slug-only diagnostic without member or account data", () => {
    const sink = vi.fn();

    const result = recordLegacyFallbackRender("hamfriend", sink);

    expect(result).toEqual({ slug: "hamfriend" });
    expect(sink).toHaveBeenCalledWith({ slug: "hamfriend" });
    expect(Object.keys(sink.mock.calls[0][0])).toEqual(["slug"]);
  });

  it("bounds noise to one event per slug and never breaks rendering", () => {
    const sink = vi.fn(() => {
      throw new Error("diagnostic unavailable");
    });

    expect(() => recordLegacyFallbackRender("hamfriend", sink)).not.toThrow();
    expect(() => recordLegacyFallbackRender("hamfriend", sink)).not.toThrow();
    expect(sink).toHaveBeenCalledOnce();
  });
});
