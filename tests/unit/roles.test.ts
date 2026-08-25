import { describe, expect, it } from "vitest";

import { isSiteRole } from "@/lib/auth/roles";

describe("site roles", () => {
  it("accepts only the two persisted role values", () => {
    expect(isSiteRole("member")).toBe(true);
    expect(isSiteRole("admin")).toBe(true);
    expect(isSiteRole("owner")).toBe(false);
    expect(isSiteRole(null)).toBe(false);
  });
});
