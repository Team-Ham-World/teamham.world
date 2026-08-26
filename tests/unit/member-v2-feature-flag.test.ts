import { afterEach, describe, expect, it } from "vitest";

import {
  MemberPageV2ConfigurationError,
  MemberPageV2EditorUnavailableError,
  getMemberPageV2Rollout,
  isMemberPageV2Cohort,
  isMemberPageV2EditorEnabled,
  parseMemberPageV2Rollout,
  requireMemberPageV2EditorEnabled,
} from "@/lib/members/v2/feature-flag";

const ORIGINAL_ALLOWLIST = process.env.MEMBER_PAGE_V2_ALLOWLIST;
const ORIGINAL_DISABLED = process.env.MEMBER_PAGE_V2_EDITOR_DISABLED;

afterEach(() => {
  if (ORIGINAL_ALLOWLIST === undefined) delete process.env.MEMBER_PAGE_V2_ALLOWLIST;
  else process.env.MEMBER_PAGE_V2_ALLOWLIST = ORIGINAL_ALLOWLIST;
  if (ORIGINAL_DISABLED === undefined) delete process.env.MEMBER_PAGE_V2_EDITOR_DISABLED;
  else process.env.MEMBER_PAGE_V2_EDITOR_DISABLED = ORIGINAL_DISABLED;
});

function parse(allowlist?: string, editorDisabled?: string) {
  return parseMemberPageV2Rollout({
    MEMBER_PAGE_V2_ALLOWLIST: allowlist,
    MEMBER_PAGE_V2_EDITOR_DISABLED: editorDisabled,
  });
}

describe("member V2 rollout configuration", () => {
  it("treats unset or exactly empty allowlists as an empty cohort", () => {
    expect(parse()).toEqual({
      success: true,
      rollout: { cohort: { kind: "none" }, editorDisabled: false },
    });
    expect(parse("", "false")).toEqual({
      success: true,
      rollout: { cohort: { kind: "none" }, editorDisabled: false },
    });
  });

  it("parses one or many lowercase immutable slugs and deduplicates in first-seen order", () => {
    expect(parse("hamfriend")).toEqual({
      success: true,
      rollout: { cohort: { kind: "slugs", slugs: ["hamfriend"] }, editorDisabled: false },
    });
    expect(parse("hamfriend, second-member,hamfriend,third")).toEqual({
      success: true,
      rollout: {
        cohort: { kind: "slugs", slugs: ["hamfriend", "second-member", "third"] },
        editorDisabled: false,
      },
    });
  });

  it("accepts only the exact all sentinel by itself", () => {
    expect(parse("all", "true")).toEqual({
      success: true,
      rollout: { cohort: { kind: "all" }, editorDisabled: true },
    });
    for (const allowlist of ["all,hamfriend", "hamfriend,all", "ALL", "All"]) {
      expect(parse(allowlist).success).toBe(false);
    }
  });

  it("fails closed for empty entries, invalid, reserved, or mixed-case slugs", () => {
    for (const allowlist of [
      " ",
      "hamfriend,",
      ",hamfriend",
      "hamfriend,   ,second",
      "HamFriend",
      "under_score",
      "-leading",
      "api",
      "www",
    ]) {
      expect(parse(allowlist).success, allowlist).toBe(false);
    }
  });

  it("accepts only exact true/false kill-switch values", () => {
    expect(parse(undefined, "true")).toEqual({
      success: true,
      rollout: { cohort: { kind: "none" }, editorDisabled: true },
    });
    expect(parse("hamfriend", "true")).toMatchObject({
      success: true,
      rollout: { editorDisabled: true },
    });
    expect(parse("hamfriend", "false")).toMatchObject({
      success: true,
      rollout: { editorDisabled: false },
    });
    expect(parse("all", "false")).toEqual({
      success: true,
      rollout: { cohort: { kind: "all" }, editorDisabled: false },
    });
    for (const value of ["", "TRUE", "False", "1", "yes", " true "]) {
      expect(parse("hamfriend", value).success, value).toBe(false);
    }
  });

  it("keeps cohort authority independent from editor availability", () => {
    const enabled = parse("hamfriend");
    const disabled = parse("hamfriend", "true");
    if (!enabled.success || !disabled.success) throw new Error("fixture mismatch");

    expect(isMemberPageV2Cohort("hamfriend", enabled.rollout)).toBe(true);
    expect(isMemberPageV2EditorEnabled("hamfriend", enabled.rollout)).toBe(true);
    expect(isMemberPageV2Cohort("hamfriend", disabled.rollout)).toBe(true);
    expect(isMemberPageV2EditorEnabled("hamfriend", disabled.rollout)).toBe(false);
    expect(isMemberPageV2Cohort("someone-else", disabled.rollout)).toBe(false);
  });

  it("requires both cohort membership and an enabled editor", () => {
    const parsed = parse("hamfriend");
    if (!parsed.success) throw new Error("fixture mismatch");
    expect(requireMemberPageV2EditorEnabled("hamfriend", parsed.rollout)).toBeUndefined();
    expect(() => requireMemberPageV2EditorEnabled("someone-else", parsed.rollout))
      .toThrow(MemberPageV2EditorUnavailableError);

    const disabled = parse("all", "true");
    if (!disabled.success) throw new Error("fixture mismatch");
    expect(isMemberPageV2Cohort("any-valid-slug", disabled.rollout)).toBe(true);
    expect(() => requireMemberPageV2EditorEnabled("any-valid-slug", disabled.rollout))
      .toThrow(MemberPageV2EditorUnavailableError);
  });

  it("reads environment configuration and throws on invalid deployment values", () => {
    process.env.MEMBER_PAGE_V2_ALLOWLIST = "hamfriend";
    process.env.MEMBER_PAGE_V2_EDITOR_DISABLED = "false";
    expect(getMemberPageV2Rollout()).toEqual({
      cohort: { kind: "slugs", slugs: ["hamfriend"] },
      editorDisabled: false,
    });

    process.env.MEMBER_PAGE_V2_ALLOWLIST = "api";
    expect(() => getMemberPageV2Rollout()).toThrow(MemberPageV2ConfigurationError);
  });
});
