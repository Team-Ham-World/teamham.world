import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/members/route";
import * as memberDal from "@/lib/members/dal";

vi.mock("@/lib/members/dal", () => ({
  listPublishedMembers: vi.fn(),
}));

describe("public members endpoint", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the minimal stable public preview", async () => {
    vi.mocked(memberDal.listPublishedMembers).mockResolvedValueOnce([
      { slug: "alice", displayName: "Alice", blurb: "Makes games." },
    ]);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("public");
    expect(await response.json()).toEqual({
      members: [{ slug: "alice", displayName: "Alice", blurb: "Makes games." }],
    });
    expect(memberDal.listPublishedMembers).toHaveBeenCalledWith(6);
  });

  it("degrades disabled storage to an empty preview", async () => {
    vi.mocked(memberDal.listPublishedMembers).mockResolvedValueOnce([]);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ members: [] });
  });

  it("reports a database outage without leaking details", async () => {
    vi.mocked(memberDal.listPublishedMembers).mockRejectedValueOnce(new Error("secret host"));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "service_unavailable" });
  });
});
