import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  INVALID_PUBLISHED_V2_DIAGNOSTIC_CAP,
  recordInvalidPublishedV2Read,
  resetInvalidPublishedV2Diagnostics,
} from "@/components/member-page-v2/invalid-published-diagnostic";

describe("invalid published V2 diagnostic", () => {
  beforeEach(() => {
    resetInvalidPublishedV2Diagnostics();
  });

  it("logs a valid public slug and nothing else", () => {
    const sink = vi.fn();

    const result = recordInvalidPublishedV2Read("hamfriend", sink);

    expect(result).toEqual({ slug: "hamfriend" });
    expect(sink).toHaveBeenCalledWith({ slug: "hamfriend" });
    expect(Object.keys(sink.mock.calls[0][0])).toEqual(["slug"]);
  });

  it("does not retain or log invalid request slugs", () => {
    const sink = vi.fn();

    recordInvalidPublishedV2Read("not/a/member", sink);
    recordInvalidPublishedV2Read("not/a/member", sink);

    expect(sink).not.toHaveBeenCalled();
  });

  it("uses a capped LRU so distinct traffic cannot grow process memory forever", () => {
    const sink = vi.fn();

    for (let index = 0; index <= INVALID_PUBLISHED_V2_DIAGNOSTIC_CAP; index += 1) {
      recordInvalidPublishedV2Read(`member-${index}`, sink);
    }
    expect(sink).toHaveBeenCalledTimes(
      INVALID_PUBLISHED_V2_DIAGNOSTIC_CAP + 1,
    );

    // The oldest slug was evicted when the cap was crossed, so it is accepted
    // once more. A never-evicting Set would suppress this call and grow forever.
    recordInvalidPublishedV2Read("member-0", sink);
    expect(sink).toHaveBeenCalledTimes(
      INVALID_PUBLISHED_V2_DIAGNOSTIC_CAP + 2,
    );
  });
});
