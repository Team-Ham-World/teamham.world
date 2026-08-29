import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { extractMemberPageAssetIds } from "@/lib/members/v2/asset-references";
import {
  BLUEPRINT_DEFAULT_ACCENT_ID,
  MEMBER_PAGE_THEME_REGISTRY,
  NEWSPRINT_DEFAULT_ACCENT_ID,
  PAPER_DEFAULT_ACCENT_ID,
  RISO_DEFAULT_ACCENT_ID,
  getDefaultEnabledThemeAccent,
  getEnabledMemberThemes,
  isEnabledThemeAccent,
  resolveEnabledThemeAccent,
  type MemberThemeSemanticTokens,
} from "@/lib/members/v2/themes";
import { canonicalMemberPageDocument, minimalMemberPageDocument } from "../fixtures/member-v2/documents";

describe("member V2 themes and asset references", () => {
  it("registers exact Paper semantics and finite reviewed launch palettes", () => {
    expect(PAPER_DEFAULT_ACCENT_ID).toBe("default");
    expect(NEWSPRINT_DEFAULT_ACCENT_ID).toBe("press-red");
    expect(BLUEPRINT_DEFAULT_ACCENT_ID).toBe("technical-blue");
    expect(RISO_DEFAULT_ACCENT_ID).toBe("soy-red");
    expect(MEMBER_PAGE_THEME_REGISTRY.paper.accents.default.tokens).toEqual({
      paper: "#f6f1e5",
      ink: "#1c1a17",
      border: "#1c1a17",
      muted: "#5c5648",
      surface: "#fffdf6",
      decorativeRed: "#d93625",
      interactiveBlue: "#1d4ed8",
    });

    expect(
      Object.fromEntries(
        getEnabledMemberThemes().map((theme) => [
          theme.id,
          {
            label: theme.label,
            defaultAccentId: theme.defaultAccentId,
            accentIds: Object.keys(theme.accents),
          },
        ]),
      ),
    ).toEqual({
      paper: {
        label: "Paper",
        defaultAccentId: "default",
        accentIds: ["default"],
      },
      newsprint: {
        label: "Newsprint",
        defaultAccentId: "press-red",
        accentIds: ["press-red", "archive-blue"],
      },
      blueprint: {
        label: "Blueprint",
        defaultAccentId: "technical-blue",
        accentIds: ["technical-blue", "survey-orange"],
      },
      riso: {
        label: "Riso",
        defaultAccentId: "soy-red",
        accentIds: ["soy-red", "indigo"],
      },
    });
  });

  it("resolves only enabled known theme/accent pairs", () => {
    expect(resolveEnabledThemeAccent("paper", "default")).toMatchObject({
      themeId: "paper",
      accentId: "default",
    });
    expect(isEnabledThemeAccent("paper", "default")).toBe(true);

    for (const pair of [
      ["paper", "missing"],
      ["newsprint", "default"],
      ["newsprint", "retired-black"],
      ["nightshift", "default"],
    ]) {
      expect(resolveEnabledThemeAccent(pair[0], pair[1])).toBeNull();
      expect(isEnabledThemeAccent(pair[0], pair[1])).toBe(false);
    }

    for (const theme of getEnabledMemberThemes()) {
      expect(getDefaultEnabledThemeAccent(theme.id)).toMatchObject({
        themeId: theme.id,
        accentId: theme.defaultAccentId,
      });
      for (const accentId of Object.keys(theme.accents)) {
        expect(resolveEnabledThemeAccent(theme.id, accentId)).toMatchObject({
          themeId: theme.id,
          themeLabel: theme.label,
          accentId,
          accentLabel: theme.accents[accentId]?.label,
        });
      }
    }
  });

  it("keeps every launch surface light and every required state at WCAG contrast", () => {
    for (const theme of getEnabledMemberThemes()) {
      for (const [accentId, accent] of Object.entries(theme.accents)) {
        const { tokens } = accent;
        const pair = `${theme.id}/${accentId}`;

        expect(relativeLuminance(tokens.paper), `${pair} paper`).toBeGreaterThan(
          0.8,
        );
        expect(
          relativeLuminance(tokens.surface),
          `${pair} surface`,
        ).toBeGreaterThan(0.9);

        for (const [state, foreground, background] of normalTextChecks(tokens)) {
          expect(
            contrastRatio(foreground, background),
            `${pair} ${state}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
        for (const [state, foreground, background] of structuralChecks(tokens)) {
          expect(
            contrastRatio(foreground, background),
            `${pair} ${state}`,
          ).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });

  it("keeps the checked-in contrast evidence synchronized with calculated ratios", async () => {
    const evidence = await readFile(
      path.join(
        process.cwd(),
        "docs/website/evidence/MEMBER_PAGE_V2_THEME_CONTRAST.md",
      ),
      "utf8",
    );

    for (const theme of getEnabledMemberThemes()) {
      for (const [accentId, accent] of Object.entries(theme.accents)) {
        expect(evidence).toContain(
          evidenceRow(`${theme.id}/${accentId}`, accent.tokens),
        );
      }
    }
  });

  it("extracts unique asset IDs in first-reference order from every location", () => {
    const doc = canonicalMemberPageDocument();
    const featured = doc.blocks[1];
    if (featured.type !== "featuredProject" || featured.project.kind !== "external") {
      throw new Error("fixture mismatch");
    }
    featured.project.artwork = {
      assetId: "asset-portrait",
      alt: "Reused portrait",
      decorative: false,
    };
    const projectList = doc.blocks[2];
    if (projectList.type !== "projectList") throw new Error("fixture mismatch");
    const nestedExternal = projectList.projects[1].project;
    if (nestedExternal.kind !== "external") throw new Error("fixture mismatch");
    nestedExternal.artwork = {
      assetId: "asset-project-list",
      alt: "Nested project artwork",
      decorative: false,
    };

    expect(extractMemberPageAssetIds(doc)).toEqual([
      "asset-portrait",
      "asset-project-list",
      "asset-image-1",
      "asset-image-2",
      "asset-gallery-1",
      "asset-gallery-2",
      "asset-gallery-3",
      "asset-gallery-4",
    ]);
  });

  it("extracts asset IDs from blocks inside rows", () => {
    const doc = minimalMemberPageDocument();
    doc.blocks = [
      {
        type: "row",
        ratio: "1:1",
        blocks: [
          {
            id: "row-image",
            type: "image",
            variant: "framed",
            image: { assetId: "asset-row-image", alt: "Row image", decorative: false },
            caption: null,
          },
          {
            id: "row-gallery",
            type: "gallery",
            variant: "grid",
            items: [
              {
                id: "row-gallery-1",
                image: { assetId: "asset-row-gallery", alt: null, decorative: true },
                caption: null,
              },
            ],
          },
        ],
      },
    ];

    expect(extractMemberPageAssetIds(doc)).toEqual([
      "asset-row-image",
      "asset-row-gallery",
    ]);
  });
});

type Tokens = MemberThemeSemanticTokens;
type ContrastCheck = readonly [state: string, foreground: string, background: string];

function normalTextChecks(tokens: Tokens): ContrastCheck[] {
  return [
    ["ink on paper", tokens.ink, tokens.paper],
    ["ink on surface", tokens.ink, tokens.surface],
    ["muted text on paper", tokens.muted, tokens.paper],
    ["muted text on surface", tokens.muted, tokens.surface],
    ["link on paper", tokens.interactiveBlue, tokens.paper],
    ["link on surface", tokens.interactiveBlue, tokens.surface],
    ["accent button text", tokens.paper, tokens.interactiveBlue],
    ["primary button text", tokens.paper, tokens.ink],
    ["error text", tokens.ink, tokens.paper],
  ];
}

function structuralChecks(tokens: Tokens): ContrastCheck[] {
  return [
    ["border on paper", tokens.border, tokens.paper],
    ["border on surface", tokens.border, tokens.surface],
    ["disabled border on paper", tokens.muted, tokens.paper],
    ["disabled border on surface", tokens.muted, tokens.surface],
    ["focus on paper", tokens.interactiveBlue, tokens.paper],
    ["focus on surface", tokens.interactiveBlue, tokens.surface],
    ["error indicator on paper", tokens.decorativeRed, tokens.paper],
    ["error indicator on surface", tokens.decorativeRed, tokens.surface],
  ];
}

function relativeLuminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/.{2}/gu)
    ?.map((value) => Number.parseInt(value, 16) / 255)
    .map((value) =>
      value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4,
    );
  if (!channels || channels.length !== 3) throw new Error(`Invalid hex: ${hex}`);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(first: string, second: string): number {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  return (
    (Math.max(firstLuminance, secondLuminance) + 0.05) /
    (Math.min(firstLuminance, secondLuminance) + 0.05)
  );
}

function formatRatio(first: string, second: string): string {
  return contrastRatio(first, second).toFixed(2);
}

function evidenceRow(id: string, tokens: Tokens): string {
  return [
    id,
    tokens.paper,
    tokens.ink,
    tokens.border,
    tokens.muted,
    tokens.surface,
    tokens.decorativeRed,
    tokens.interactiveBlue,
    formatRatio(tokens.ink, tokens.paper),
    formatRatio(tokens.ink, tokens.surface),
    formatRatio(tokens.muted, tokens.paper),
    formatRatio(tokens.muted, tokens.surface),
    formatRatio(tokens.border, tokens.paper),
    formatRatio(tokens.border, tokens.surface),
    formatRatio(tokens.interactiveBlue, tokens.paper),
    formatRatio(tokens.interactiveBlue, tokens.surface),
    formatRatio(tokens.paper, tokens.interactiveBlue),
    formatRatio(tokens.ink, tokens.paper),
    formatRatio(tokens.decorativeRed, tokens.paper),
    formatRatio(tokens.decorativeRed, tokens.surface),
  ].join(" | ");
}
