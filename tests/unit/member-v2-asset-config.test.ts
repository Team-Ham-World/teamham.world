import { execFileSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  MEMBER_ASSET_PRIVATE_CACHE_CONTROL,
  MEMBER_ASSET_PUBLIC_CACHE_CONTROL,
  MemberPageR2ConfigurationError,
  buildPrivateR2ObjectUrl,
  getMemberPageR2Config,
  parseMemberPageR2Config,
} from "@/lib/members/assets/config";
import { VALID_DEV_ENV } from "../helpers/test-fixtures";

const SECRET = "s".repeat(64);
const COMPLETE_ENV = {
  MEMBER_PAGE_R2_ENVIRONMENT: "nonproduction",
  MEMBER_PAGE_R2_ACCOUNT_ID: "a".repeat(32),
  MEMBER_PAGE_R2_ACCESS_KEY_ID: "B".repeat(32),
  MEMBER_PAGE_R2_SECRET_ACCESS_KEY: SECRET,
  MEMBER_PAGE_R2_BUCKET: "teamham-member-assets-nonproduction",
} as const;

describe("member V2 asset configuration", () => {
  it("disables storage only when every variable is absent", () => {
    expect(parseMemberPageR2Config({}, "nonproduction")).toEqual({
      success: true,
      config: null,
    });
    expect(
      parseMemberPageR2Config(
        { MEMBER_PAGE_R2_ENVIRONMENT: "nonproduction" },
        "nonproduction",
      ),
    ).toMatchObject({ success: false });
  });

  it("parses complete configuration and derives only the private endpoint", () => {
    const parsed = parseMemberPageR2Config(COMPLETE_ENV, "nonproduction");
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.config) throw new Error("fixture mismatch");
    const config = parsed.config;
    expect(config.endpoint).toBe(
      `https://${"a".repeat(32)}.r2.cloudflarestorage.com/teamham-member-assets-nonproduction`,
    );
    expect(config.region).toBe("auto");
    expect(
      buildPrivateR2ObjectUrl(config, "member-pages/abc/image_1.avif"),
    ).toBe(`${config.endpoint}/member-pages/abc/image_1.avif`);
    expect(() => buildPrivateR2ObjectUrl(config, "../secret"))
      .toThrow(MemberPageR2ConfigurationError);
  });

  it("allows only a loopback S3 endpoint in nonproduction", () => {
    const parsed = parseMemberPageR2Config(
      { ...COMPLETE_ENV, MEMBER_PAGE_R2_ENDPOINT: "http://127.0.0.1:9000" },
      "nonproduction",
    );
    expect(parsed).toMatchObject({
      success: true,
      config: {
        endpoint:
          "http://127.0.0.1:9000/teamham-member-assets-nonproduction",
        region: "us-east-1",
      },
    });

    for (const endpoint of [
      "http://minio:9000",
      "http://127.0.0.1:9000/",
      "https://example.com",
    ]) {
      expect(
        parseMemberPageR2Config(
          { ...COMPLETE_ENV, MEMBER_PAGE_R2_ENDPOINT: endpoint },
          "nonproduction",
        ),
      ).toMatchObject({ success: false });
    }

    expect(
      parseMemberPageR2Config(
        {
          ...COMPLETE_ENV,
          MEMBER_PAGE_R2_ENVIRONMENT: "production",
          MEMBER_PAGE_R2_ENDPOINT: "https://127.0.0.1:9000",
        },
        "production",
      ),
    ).toMatchObject({ success: false });
  });

  it("rejects production/nonproduction crossover in both directions", () => {
    expect(parseMemberPageR2Config(COMPLETE_ENV, "production")).toMatchObject({
      success: false,
    });
    expect(
      parseMemberPageR2Config(
        { ...COMPLETE_ENV, MEMBER_PAGE_R2_ENVIRONMENT: "production" },
        "nonproduction",
      ),
    ).toMatchObject({ success: false });
  });

  it("rejects malformed values without placing secret text in errors", () => {
    const badSecret = "TOP_SECRET_NOT_FOR_ERRORS";
    const parsed = parseMemberPageR2Config(
      {
        ...COMPLETE_ENV,
        MEMBER_PAGE_R2_ACCOUNT_ID: "not-an-account",
        MEMBER_PAGE_R2_ACCESS_KEY_ID: "short",
        MEMBER_PAGE_R2_SECRET_ACCESS_KEY: badSecret,
        MEMBER_PAGE_R2_BUCKET: "Invalid/Bucket",
      },
      "nonproduction",
    );
    expect(parsed.success).toBe(false);
    if (parsed.success) throw new Error("fixture mismatch");
    expect(parsed.errors.join(" ")).not.toContain(badSecret);

    expect(() => getMemberPageR2Config("nonproduction", {
      ...COMPLETE_ENV,
      MEMBER_PAGE_R2_SECRET_ACCESS_KEY: badSecret,
    })).toThrow(MemberPageR2ConfigurationError);
    try {
      getMemberPageR2Config("nonproduction", {
        ...COMPLETE_ENV,
        MEMBER_PAGE_R2_SECRET_ACCESS_KEY: badSecret,
      });
    } catch (error) {
      expect((error as Error).message).not.toContain(badSecret);
    }
  });

  it("exports conservative cache defaults", () => {
    expect(MEMBER_ASSET_PUBLIC_CACHE_CONTROL).toBe("no-store");
    expect(MEMBER_ASSET_PRIVATE_CACHE_CONTROL).toBe(
      "private, no-cache, no-store, max-age=0, must-revalidate",
    );
  });
});

describe("member V2 asset preflight wiring", () => {
  const projectRoot = path.resolve(__dirname, "../..");
  const preflight = path.resolve(projectRoot, "scripts/preflight.ts");
  const cleanEnv = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) =>
        !name.startsWith("MEMBER_PAGE_R2_") &&
        !name.startsWith("MEMBER_PAGE_V2_") &&
        !name.startsWith("DISCORD_") &&
        ![
          "APP_BASE_URL",
          "OAUTH_STATE_HMAC_SECRET",
          "GAME_AUTH_REQUEST_HMAC_SECRET",
          "DATABASE_URL",
          "AUTH_MODE",
          "NODE_ENV",
        ].includes(name),
    ),
  );

  function run(env: Record<string, string | undefined>): string {
    return execFileSync(process.execPath, ["--import", "tsx", preflight], {
      cwd: projectRoot,
      env: { ...cleanEnv, NODE_ENV: "test", ...env },
      encoding: "utf8",
      stdio: "pipe",
    });
  }

  function runFailure(env: Record<string, string | undefined>): string {
    try {
      run(env);
      throw new Error("expected preflight failure");
    } catch (error) {
      const execError = error as { stdout?: string; stderr?: string };
      return `${execError.stdout ?? ""}\n${execError.stderr ?? ""}`;
    }
  }

  it("keeps the existing disabled/no-storage configuration valid", () => {
    expect(run({ AUTH_MODE: "disabled" })).toContain(
      "Preflight validation succeeded (mode: disabled).",
    );
  });

  it("always validates rollout syntax", () => {
    expect(
      runFailure({
        AUTH_MODE: "disabled",
        MEMBER_PAGE_V2_ALLOWLIST: "all,hamfriend",
      }),
    ).toContain("cannot combine all with slugs");
  });

  const rolloutStorageCases = [
    { cohort: "none", allowlist: "", editorDisabled: false },
    { cohort: "none", allowlist: "", editorDisabled: true },
    { cohort: "slugs", allowlist: "hamfriend", editorDisabled: false },
    { cohort: "slugs", allowlist: "hamfriend", editorDisabled: true },
    { cohort: "all", allowlist: "all", editorDisabled: false },
    { cohort: "all", allowlist: "all", editorDisabled: true },
  ] as const;

  for (const rolloutCase of rolloutStorageCases) {
    for (const storage of ["absent", "complete"] as const) {
      const requiresStorage =
        rolloutCase.cohort !== "none" && !rolloutCase.editorDisabled;
      const shouldSucceed = storage === "complete" || !requiresStorage;

      it(`${shouldSucceed ? "accepts" : "rejects"} ${rolloutCase.cohort} cohort with editor ${
        rolloutCase.editorDisabled ? "disabled" : "enabled"
      } and R2 ${storage}`, () => {
        const env = {
          ...VALID_DEV_ENV,
          MEMBER_PAGE_V2_ALLOWLIST: rolloutCase.allowlist,
          MEMBER_PAGE_V2_EDITOR_DISABLED: String(rolloutCase.editorDisabled),
          ...(storage === "complete" ? COMPLETE_ENV : {}),
        };

        if (shouldSucceed) {
          expect(run(env)).toContain(
            "Preflight validation succeeded (mode: development).",
          );
        } else {
          expect(runFailure(env)).toContain(
            "Complete MEMBER_PAGE_R2_* configuration is required",
          );
        }
      });
    }
  }

  it("rejects partial and cross-environment R2 config without leaking secrets", () => {
    const partialSecret = "PARTIAL_SECRET_MUST_NOT_LEAK";
    const partialOutput = runFailure({
      ...VALID_DEV_ENV,
      MEMBER_PAGE_V2_ALLOWLIST: "",
      MEMBER_PAGE_R2_SECRET_ACCESS_KEY: partialSecret,
    });
    expect(partialOutput).toContain("is required when R2 storage is configured");
    expect(partialOutput).not.toContain(partialSecret);

    const mismatchOutput = runFailure({
      ...VALID_DEV_ENV,
      MEMBER_PAGE_V2_ALLOWLIST: "hamfriend",
      MEMBER_PAGE_V2_EDITOR_DISABLED: "true",
      ...COMPLETE_ENV,
      MEMBER_PAGE_R2_ENVIRONMENT: "production",
    });
    expect(mismatchOutput).toContain("must match the application environment class");
    expect(mismatchOutput).not.toContain(SECRET);
  });

  it("forbids every R2 variable in disabled mode without printing values", () => {
    for (const [name, value] of Object.entries(COMPLETE_ENV)) {
      const output = runFailure({ AUTH_MODE: "disabled", [name]: value });
      expect(output).toContain(
        `Forbidden variable ${name} is configured with a non-empty value in disabled mode.`,
      );
      expect(output).not.toContain(value);
    }
  });
});
