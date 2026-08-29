import { describe, expect, it } from "vitest";

import {
  ASSET_MAX_BYTES,
  ASSET_MAX_DIMENSION,
  MAX_BLOCKS,
  MAX_COLLECTION_ITEMS,
  MAX_DOCUMENT_BYTES,
  MAX_FEATURED_PROJECT_BLOCKS,
  MAX_IMAGE_ALT_CHARS,
  MAX_LINK_DESCRIPTION_CHARS,
  MAX_LINK_LABEL_CHARS,
  MAX_PROJECT_DESCRIPTION_CHARS,
  MAX_PROJECT_NAME_CHARS,
  MAX_PROJECT_TYPE_CHARS,
  MAX_QUOTE_ATTRIBUTION_CHARS,
  MAX_READY_ASSETS,
  MAX_SUMMARY_CHARS,
  MAX_URL_CHARS,
  MIN_GALLERY_ITEMS,
} from "@/lib/members/v2/limits";
import { parseMemberPageDocumentV2 } from "@/lib/members/v2/validation";
import { getEnabledMemberThemes } from "@/lib/members/v2/themes";
import {
  canonicalMemberPageDocument,
  minimalMemberPageDocument,
} from "../fixtures/member-v2/documents";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function expectFailure(value: unknown, path?: (string | number)[]) {
  const result = parseMemberPageDocumentV2(value);
  expect(result.success).toBe(false);
  if (!result.success && path) {
    expect(result.errors.some((error) =>
      JSON.stringify(error.path) === JSON.stringify(path)
    )).toBe(true);
  }
}

function exactHttpsUrl(length: number): string {
  const prefix = "https://example.com/";
  return `${prefix}${"a".repeat(length - prefix.length)}`;
}

describe("member V2 document validation", () => {
  it("parses a canonical document covering every block, variant, status, and social", () => {
    const doc = canonicalMemberPageDocument();
    expect(doc.blocks).toHaveLength(MAX_BLOCKS);
    expect(parseMemberPageDocumentV2(doc)).toEqual({ success: true, doc });

    const artworkFirst = canonicalMemberPageDocument();
    const featured = artworkFirst.blocks[1];
    if (featured.type !== "featuredProject") throw new Error("fixture mismatch");
    featured.variant = "artwork-first";
    expect(parseMemberPageDocumentV2(artworkFirst)).toEqual({
      success: true,
      doc: artworkFirst,
    });
  });

  it("normalizes member-authored strings and nullable optionals", () => {
    const doc = minimalMemberPageDocument() as unknown as Record<string, unknown>;
    const frame = doc.frame as Record<string, unknown>;
    frame.displayName = "  Ha\u0301m Friend  ";
    frame.summary = "   ";
    frame.websiteUrl = "  https://example.com/profile  ";
    frame.socialLinks = {
      github: "  https://github.com/hamfriend  ",
      bluesky: "",
      mastodon: null,
    };

    const result = parseMemberPageDocumentV2(doc);
    expect(result).toMatchObject({ success: true });
    if (result.success) {
      expect(result.doc.frame).toMatchObject({
        displayName: "Hám Friend",
        summary: null,
        websiteUrl: "https://example.com/profile",
        socialLinks: { github: "https://github.com/hamfriend" },
      });
    }
  });

  it("rejects unknown keys at every closed-object boundary", () => {
    const root = minimalMemberPageDocument() as unknown as Record<string, unknown>;
    root.extra = true;
    expectFailure(root, ["extra"]);

    const frameDoc = minimalMemberPageDocument() as unknown as Record<string, unknown>;
    (frameDoc.frame as Record<string, unknown>).extra = true;
    expectFailure(frameDoc, ["frame", "extra"]);

    const blockDoc = canonicalMemberPageDocument() as unknown as Record<string, unknown>;
    ((blockDoc.blocks as Record<string, unknown>[])[0]).extra = true;
    expectFailure(blockDoc, ["blocks", 0, "extra"]);

    const imageDoc = canonicalMemberPageDocument() as unknown as Record<string, unknown>;
    const image = ((imageDoc.blocks as Record<string, unknown>[])[6]).image as Record<string, unknown>;
    image.src = "https://images.example/remote.png";
    expectFailure(imageDoc, ["blocks", 6, "image", "src"]);
  });

  it("rejects member-authored colors and style controls", () => {
    const colorDoc = minimalMemberPageDocument() as unknown as Record<string, unknown>;
    const colorTheme = (colorDoc.frame as Record<string, unknown>)
      .theme as Record<string, unknown>;
    colorTheme.color = "#ffffff";
    expectFailure(colorDoc, ["frame", "theme", "color"]);

    const styleDoc = minimalMemberPageDocument() as unknown as Record<string, unknown>;
    (styleDoc.frame as Record<string, unknown>).style = {
      background: "linear-gradient(red, blue)",
    };
    expectFailure(styleDoc, ["frame", "style"]);

    const hexAccentDoc = minimalMemberPageDocument() as unknown as Record<
      string,
      unknown
    >;
    const hexTheme = (hexAccentDoc.frame as Record<string, unknown>)
      .theme as Record<string, unknown>;
    hexTheme.accentId = "#d93625";
    expectFailure(hexAccentDoc, ["frame", "theme", "accentId"]);
  });

  it("rejects unknown schema, theme, accent, social, block, variant, and project values", () => {
    const cases: Array<[(doc: Record<string, unknown>) => void, (string | number)[]]> = [
      [(doc) => { doc.schemaVersion = 3; }, ["schemaVersion"]],
      [(doc) => {
        ((doc.frame as Record<string, unknown>).theme as Record<string, unknown>).id = "nightshift";
      }, ["frame", "theme", "id"]],
      [(doc) => {
        ((doc.frame as Record<string, unknown>).theme as Record<string, unknown>).accentId = "missing";
      }, ["frame", "theme", "accentId"]],
      [(doc) => {
        (doc.frame as Record<string, unknown>).socialLinks = { myspace: "https://example.com" };
      }, ["frame", "socialLinks", "myspace"]],
      [(doc) => {
        ((doc.blocks as Record<string, unknown>[])[0]).type = "html";
      }, ["blocks", 0, "type"]],
      [(doc) => {
        ((doc.blocks as Record<string, unknown>[])[1]).variant = "carousel";
      }, ["blocks", 1, "variant"]],
      [(doc) => {
        const projects = ((doc.blocks as Record<string, unknown>[])[2]).projects as Record<string, unknown>[];
        (projects[0].project as Record<string, unknown>).projectSlug = "missing-project";
      }, ["blocks", 2, "projects", 0, "project", "projectSlug"]],
      [(doc) => {
        const projects = ((doc.blocks as Record<string, unknown>[])[2]).projects as Record<string, unknown>[];
        (projects[1].project as Record<string, unknown>).status = "cancelled";
      }, ["blocks", 2, "projects", 1, "project", "status"]],
    ];

    for (const [mutate, path] of cases) {
      const doc = canonicalMemberPageDocument() as unknown as Record<string, unknown>;
      mutate(doc);
      expectFailure(doc, path);
    }

    for (const theme of getEnabledMemberThemes()) {
      for (const accentId of Object.keys(theme.accents)) {
        const doc = minimalMemberPageDocument();
        doc.frame.theme = { id: theme.id, accentId };
        expect(parseMemberPageDocumentV2(doc)).toEqual({ success: true, doc });
      }
    }

    for (const [themeId, accentId] of [
      ["newsprint", "retired-black"],
      ["blueprint", "default"],
      ["riso", "fluorescent-pink"],
    ]) {
      const doc = minimalMemberPageDocument() as unknown as Record<string, unknown>;
      (doc.frame as Record<string, unknown>).theme = {
        id: themeId,
        accentId,
      };
      expectFailure(doc, ["frame", "theme", "accentId"]);
    }
  });

  it("enforces image alt/decorative XOR and opaque asset IDs", () => {
    const cases: Array<[
      { assetId: string; alt: string | null; decorative: boolean },
      "alt" | "assetId",
    ]> = [
      [{ assetId: "asset", alt: null, decorative: false }, "alt"],
      [{ assetId: "asset", alt: "Informative", decorative: true }, "alt"],
      [{ assetId: "asset", alt: "   ", decorative: false }, "alt"],
      [{
        assetId: "https://images.example/remote.png",
        alt: "Remote",
        decorative: false,
      }, "assetId"],
      [{ assetId: "", alt: "Missing", decorative: false }, "assetId"],
    ];

    for (const [image, field] of cases) {
      const doc = minimalMemberPageDocument() as unknown as Record<string, unknown>;
      (doc.frame as Record<string, unknown>).portrait = image;
      expectFailure(doc, ["frame", "portrait", field]);
    }
  });

  it("rejects control characters and invalid Unicode", () => {
    for (const displayName of ["bad\nname", `bad${String.fromCharCode(0)}name`, "bad\uD800name"]) {
      const doc = minimalMemberPageDocument() as unknown as Record<string, unknown>;
      (doc.frame as Record<string, unknown>).displayName = displayName;
      expectFailure(doc, ["frame", "displayName"]);
    }
  });

  it("enforces all scalar text limits", () => {
    const valid = canonicalMemberPageDocument() as unknown as Record<string, unknown>;
    const blocks = valid.blocks as Record<string, unknown>[];
    const external = (((blocks[2].projects as Record<string, unknown>[])[1]).project) as Record<string, unknown>;
    const link = (blocks[4].links as Record<string, unknown>[])[0];
    const image = blocks[6].image as Record<string, unknown>;

    (valid.frame as Record<string, unknown>).displayName = "x".repeat(80);
    (valid.frame as Record<string, unknown>).summary = "x".repeat(MAX_SUMMARY_CHARS);
    external.name = "x".repeat(MAX_PROJECT_NAME_CHARS);
    external.type = "x".repeat(MAX_PROJECT_TYPE_CHARS);
    external.shortDescription = "x".repeat(MAX_PROJECT_DESCRIPTION_CHARS);
    link.label = "x".repeat(MAX_LINK_LABEL_CHARS);
    link.description = "x".repeat(MAX_LINK_DESCRIPTION_CHARS);
    image.alt = "x".repeat(MAX_IMAGE_ALT_CHARS);
    blocks[6].caption = "x".repeat(500);
    blocks[10].text = "x".repeat(500);
    blocks[11].attribution = "x".repeat(MAX_QUOTE_ATTRIBUTION_CHARS);
    expect(parseMemberPageDocumentV2(valid).success).toBe(true);

    const cases: Array<[(doc: Record<string, unknown>) => void, (string | number)[]]> = [
      [(doc) => { (doc.frame as Record<string, unknown>).displayName = "x".repeat(81); }, ["frame", "displayName"]],
      [(doc) => { (doc.frame as Record<string, unknown>).summary = "x".repeat(MAX_SUMMARY_CHARS + 1); }, ["frame", "summary"]],
      [(doc) => {
        const project = ((((doc.blocks as Record<string, unknown>[])[2].projects as Record<string, unknown>[])[1]).project) as Record<string, unknown>;
        project.name = "x".repeat(MAX_PROJECT_NAME_CHARS + 1);
      }, ["blocks", 2, "projects", 1, "project", "name"]],
      [(doc) => {
        const project = ((((doc.blocks as Record<string, unknown>[])[2].projects as Record<string, unknown>[])[1]).project) as Record<string, unknown>;
        project.type = "x".repeat(MAX_PROJECT_TYPE_CHARS + 1);
      }, ["blocks", 2, "projects", 1, "project", "type"]],
      [(doc) => {
        const project = ((((doc.blocks as Record<string, unknown>[])[2].projects as Record<string, unknown>[])[1]).project) as Record<string, unknown>;
        project.shortDescription = "x".repeat(MAX_PROJECT_DESCRIPTION_CHARS + 1);
      }, ["blocks", 2, "projects", 1, "project", "shortDescription"]],
      [(doc) => {
        (((doc.blocks as Record<string, unknown>[])[4].links as Record<string, unknown>[])[0]).label = "x".repeat(MAX_LINK_LABEL_CHARS + 1);
      }, ["blocks", 4, "links", 0, "label"]],
      [(doc) => {
        (((doc.blocks as Record<string, unknown>[])[4].links as Record<string, unknown>[])[0]).description = "x".repeat(MAX_LINK_DESCRIPTION_CHARS + 1);
      }, ["blocks", 4, "links", 0, "description"]],
      [(doc) => {
        (((doc.blocks as Record<string, unknown>[])[6]).image as Record<string, unknown>).alt = "x".repeat(MAX_IMAGE_ALT_CHARS + 1);
      }, ["blocks", 6, "image", "alt"]],
      [(doc) => { ((doc.blocks as Record<string, unknown>[])[6]).caption = "x".repeat(501); }, ["blocks", 6, "caption"]],
      [(doc) => { ((doc.blocks as Record<string, unknown>[])[10]).text = "x".repeat(501); }, ["blocks", 10, "text"]],
      [(doc) => { ((doc.blocks as Record<string, unknown>[])[11]).attribution = "x".repeat(MAX_QUOTE_ATTRIBUTION_CHARS + 1); }, ["blocks", 11, "attribution"]],
    ];

    for (const [mutate, path] of cases) {
      const doc = canonicalMemberPageDocument() as unknown as Record<string, unknown>;
      mutate(doc);
      expectFailure(doc, path);
    }
  });

  it("enforces HTTPS, credential, and URL length rules everywhere", () => {
    const maxUrl = exactHttpsUrl(MAX_URL_CHARS);
    const valid = minimalMemberPageDocument() as unknown as Record<string, unknown>;
    (valid.frame as Record<string, unknown>).websiteUrl = maxUrl;
    expect(parseMemberPageDocumentV2(valid).success).toBe(true);

    for (const websiteUrl of [
      "http://example.com",
      "https://user:pass@example.com",
      "https://example.com:99999",
      "HTTPS://example.com:99999",
      "https://999.999.999.999/",
      "https://example.123/",
      "https://foo.0x10/",
      "https://xn--a.com/",
      "HTTPS://xn--a.com/",
      "https://%/",
      exactHttpsUrl(MAX_URL_CHARS + 1),
      "/relative",
    ]) {
      const doc = minimalMemberPageDocument() as unknown as Record<string, unknown>;
      (doc.frame as Record<string, unknown>).websiteUrl = websiteUrl;
      expectFailure(doc, ["frame", "websiteUrl"]);
    }

    const credentialCases: Array<[
      (doc: Record<string, unknown>) => void,
      (string | number)[],
    ]> = [
      [(doc) => {
        (doc.frame as Record<string, unknown>).socialLinks = {
          github: "https://user@example.com/profile",
        };
      }, ["frame", "socialLinks", "github"]],
      [(doc) => {
        const project = ((((doc.blocks as Record<string, unknown>[])[2].projects as Record<string, unknown>[])[1]).project) as Record<string, unknown>;
        project.url = "https://user@example.com/play";
      }, ["blocks", 2, "projects", 1, "project", "url"]],
      [(doc) => {
        const project = ((((doc.blocks as Record<string, unknown>[])[2].projects as Record<string, unknown>[])[1]).project) as Record<string, unknown>;
        project.repository = "http://github.com/teamham/project";
      }, ["blocks", 2, "projects", 1, "project", "repository"]],
      [(doc) => {
        (((doc.blocks as Record<string, unknown>[])[4].links as Record<string, unknown>[])[0]).url = "/relative";
      }, ["blocks", 4, "links", 0, "url"]],
    ];
    for (const [mutate, path] of credentialCases) {
      const doc = canonicalMemberPageDocument() as unknown as Record<string, unknown>;
      mutate(doc);
      expectFailure(doc, path);
    }
  });

  it("enforces block, featured-project, and entry collection limits", () => {
    expect(MAX_FEATURED_PROJECT_BLOCKS).toBe(1);
    expect(MIN_GALLERY_ITEMS).toBe(2);

    const tooManyBlocks = canonicalMemberPageDocument() as unknown as Record<string, unknown>;
    (tooManyBlocks.blocks as unknown[]).push({
      id: "block-13",
      type: "calloutQuote",
      variant: "note",
      text: "Too many",
      attribution: null,
    });
    expectFailure(tooManyBlocks, ["blocks"]);

    const duplicateFeatured = minimalMemberPageDocument() as unknown as Record<string, unknown>;
    duplicateFeatured.blocks = [0, 1].map((index) => ({
      id: `featured-${index}`,
      type: "featuredProject",
      variant: "card",
      project: { kind: "ham", projectSlug: "untitled-quiz-show" },
    }));
    expectFailure(duplicateFeatured, ["blocks"]);

    for (const [type, key, minimum] of [
      ["projectList", "projects", 1],
      ["additionalLinks", "links", 1],
      ["gallery", "items", MIN_GALLERY_ITEMS],
    ] as const) {
      const doc = canonicalMemberPageDocument() as unknown as Record<string, unknown>;
      const blockIndex = type === "projectList" ? 2 : type === "additionalLinks" ? 4 : 8;
      const block = (doc.blocks as Record<string, unknown>[])[blockIndex];
      block[key] = [];
      expectFailure(doc, ["blocks", blockIndex, key]);

      const tooMany = canonicalMemberPageDocument() as unknown as Record<string, unknown>;
      const target = (tooMany.blocks as Record<string, unknown>[])[blockIndex];
      const source = (target[key] as unknown[])[0];
      target[key] = Array.from({ length: MAX_COLLECTION_ITEMS }, (_, index) => ({
        ...(clone(source) as Record<string, unknown>),
        id: `${type}-valid-${index}`,
      }));
      expect(parseMemberPageDocumentV2(tooMany).success).toBe(true);

      target[key] = Array.from({ length: MAX_COLLECTION_ITEMS + 1 }, (_, index) => ({
        ...(clone(source) as Record<string, unknown>),
        id: `${type}-${index}`,
      }));
      expectFailure(tooMany, ["blocks", blockIndex, key]);
      expect(minimum).toBeGreaterThan(0);
    }
  });

  it("rejects duplicate block or entry IDs", () => {
    const duplicateBlock = canonicalMemberPageDocument() as unknown as Record<string, unknown>;
    const blocks = duplicateBlock.blocks as Record<string, unknown>[];
    blocks[1].id = blocks[0].id;
    expectFailure(duplicateBlock, ["blocks", 1, "id"]);

    const duplicateEntry = canonicalMemberPageDocument() as unknown as Record<string, unknown>;
    const entries = ((duplicateEntry.blocks as Record<string, unknown>[])[2]).projects as Record<string, unknown>[];
    entries[1].id = entries[0].id;
    expectFailure(duplicateEntry, ["blocks", 2, "projects", 1, "id"]);
  });

  it("enforces the unique ready-asset ceiling while allowing reuse", () => {
    function assetDoc(uniqueImageBlocks: number) {
      const doc = minimalMemberPageDocument() as unknown as Record<string, unknown>;
      (doc.frame as Record<string, unknown>).portrait = {
        assetId: "asset-portrait",
        alt: "Portrait",
        decorative: false,
      };
      doc.blocks = [{
        id: "gallery",
        type: "gallery",
        variant: "grid",
        items: Array.from({ length: MAX_COLLECTION_ITEMS }, (_, index) => ({
          id: `gallery-${index}`,
          image: { assetId: `asset-gallery-${index}`, alt: `Image ${index}`, decorative: false },
          caption: null,
        })),
      }, ...Array.from({ length: uniqueImageBlocks }, (_, index) => ({
        id: `image-${index}`,
        type: "image",
        variant: "framed",
        image: { assetId: `asset-image-${index}`, alt: `Image ${index}`, decorative: false },
        caption: null,
      }))];
      return doc;
    }

    expect(parseMemberPageDocumentV2(assetDoc(MAX_READY_ASSETS - 13)).success).toBe(true);
    expectFailure(assetDoc(MAX_READY_ASSETS - 12), []);

    const reused = assetDoc(MAX_READY_ASSETS - 13);
    const blocks = reused.blocks as Record<string, unknown>[];
    ((blocks[1].image as Record<string, unknown>)).assetId = "asset-gallery-0";
    expect(parseMemberPageDocumentV2(reused).success).toBe(true);
  });

  it("fails fast above the UTF-8 serialized document limit", () => {
    const exact = minimalMemberPageDocument() as unknown as Record<string, unknown>;
    exact.blocks = [{
      id: "x",
      type: "calloutQuote",
      variant: "note",
      text: "size",
      attribution: null,
    }];
    const block = (exact.blocks as Record<string, unknown>[])[0];
    const currentBytes = new TextEncoder().encode(JSON.stringify(exact)).byteLength;
    block.id = "x".repeat(MAX_DOCUMENT_BYTES - currentBytes + 1);
    expect(new TextEncoder().encode(JSON.stringify(exact)).byteLength).toBe(MAX_DOCUMENT_BYTES);
    expect(parseMemberPageDocumentV2(exact).success).toBe(true);

    block.id += "x";
    const result = parseMemberPageDocumentV2(exact);
    expect(result).toEqual({
      success: false,
      errors: [{ path: [], message: expect.stringContaining(String(MAX_DOCUMENT_BYTES)) }],
    });
  });

  it("exports the exact asset constraints", () => {
    expect(ASSET_MAX_BYTES).toBe(5_242_880);
    expect(ASSET_MAX_DIMENSION).toBe(4_000);
  });

  describe("two-block row entries", () => {
    function calloutEntry(id: unknown): Record<string, unknown> {
      return {
        id,
        type: "calloutQuote",
        variant: "note",
        text: `Text ${String(id)}`,
        attribution: null,
      };
    }

    function rowEntry(
      leftId: unknown,
      rightId: unknown,
      ratio: unknown = "1:1",
    ): Record<string, unknown> {
      return {
        type: "row",
        ratio,
        blocks: [calloutEntry(leftId), calloutEntry(rightId)],
      };
    }

    function docWithEntries(entries: unknown[]): Record<string, unknown> {
      const doc = minimalMemberPageDocument() as unknown as Record<string, unknown>;
      doc.blocks = entries;
      return doc;
    }

    it("parses a valid row and every supported ratio", () => {
      for (const ratio of ["1:1", "1:2", "2:1"]) {
        const doc = docWithEntries([calloutEntry("a"), rowEntry("b", "c", ratio)]);
        const parsed = parseMemberPageDocumentV2(doc);
        expect(parsed).toEqual({ success: true, doc });
      }
    });

    it("parses all-leaf documents to deeply unchanged output", () => {
      const doc = canonicalMemberPageDocument();
      expect(parseMemberPageDocumentV2(structuredClone(doc))).toEqual({
        success: true,
        doc,
      });
    });

    it("rejects unsupported ratios and malformed row shapes", () => {
      const cases: Array<[unknown[], (string | number)[]]> = [
        [[rowEntry("a", "b", "3:1")], ["blocks", 0, "ratio"]],
        [[rowEntry("a", "b", 1)], ["blocks", 0, "ratio"]],
        [[{ type: "row", ratio: "1:1", blocks: [calloutEntry("a")] }], ["blocks", 0, "blocks"]],
        [[{
          type: "row",
          ratio: "1:1",
          blocks: [calloutEntry("a"), calloutEntry("b"), calloutEntry("c")],
        }], ["blocks", 0, "blocks"]],
        [[{ type: "row", ratio: "1:1", blocks: [] }], ["blocks", 0, "blocks"]],
        [[{ type: "row", ratio: "1:1" }], ["blocks", 0, "blocks"]],
        [[{ type: "row", ratio: "1:1", blocks: "ab" }], ["blocks", 0, "blocks"]],
        [[{ type: "row", ratio: "1:1", blocks: [calloutEntry("a"), calloutEntry("b")], key: "x" }], ["blocks", 0, "key"]],
        [[rowEntry("a", "b", "1:1"), rowEntry("c", "d", "half")], ["blocks", 1, "ratio"]],
      ];

      for (const [entries, path] of cases) {
        expectFailure(docWithEntries(entries), path);
      }
    });

    it("rejects nested rows through the leaf-only child parser", () => {
      const nested = {
        type: "row",
        ratio: "1:1",
        blocks: [rowEntry("b", "c"), calloutEntry("d")],
      };
      expectFailure(docWithEntries([nested]), ["blocks", 0, "blocks", 0, "type"]);
    });

    it("rejects sparse row block arrays", () => {
      const rightSlotMissing = new Array(2);
      rightSlotMissing[0] = calloutEntry("a");
      expectFailure(
        docWithEntries([{ type: "row", ratio: "1:1", blocks: rightSlotMissing }]),
        ["blocks", 0, "blocks", 1],
      );

      const bothSlotsMissing = new Array(2);
      expectFailure(
        docWithEntries([{ type: "row", ratio: "1:1", blocks: bothSlotsMissing }]),
        ["blocks", 0, "blocks", 0],
      );
      expectFailure(
        docWithEntries([{ type: "row", ratio: "1:1", blocks: bothSlotsMissing }]),
        ["blocks", 0, "blocks", 1],
      );
    });

    it("surfaces leaf errors at nested child paths", () => {
      const badChild = {
        type: "row",
        ratio: "1:1",
        blocks: [
          calloutEntry("a"),
          { id: "b", type: "calloutQuote", variant: "note", text: "", attribution: null },
        ],
      };
      expectFailure(docWithEntries([badChild]), ["blocks", 0, "blocks", 1, "text"]);
    });

    it("rejects duplicate IDs across singles and both row children", () => {
      expectFailure(
        docWithEntries([calloutEntry("a"), rowEntry("a", "b")]),
        ["blocks", 1, "blocks", 0, "id"],
      );

      expectFailure(
        docWithEntries([
          {
            type: "row",
            ratio: "1:1",
            blocks: [calloutEntry("same"), calloutEntry("same")],
          },
        ]),
        ["blocks", 0, "blocks", 1, "id"],
      );
    });

    it("accepts six rows as twelve leaves and rejects a thirteenth leaf", () => {
      const sixRows = Array.from({ length: 6 }, (_, index) =>
        rowEntry(`left-${index}`, `right-${index}`),
      );
      const doc = docWithEntries(sixRows);
      expect(parseMemberPageDocumentV2(doc)).toEqual({ success: true, doc });

      expectFailure(
        docWithEntries([...sixRows, calloutEntry("thirteenth")]),
        ["blocks"],
      );
      expectFailure(
        docWithEntries([...sixRows.slice(0, 5), rowEntry("l", "r"), rowEntry("m", "n")]),
        ["blocks"],
      );
    });

    it("counts featured projects inside rows against the one-project limit", () => {
      function featured(id: string): Record<string, unknown> {
        return {
          id,
          type: "featuredProject",
          variant: "card",
          project: { kind: "ham", projectSlug: "untitled-quiz-show" },
        };
      }

      const oneInRow = docWithEntries([
        calloutEntry("a"),
        { type: "row", ratio: "1:1", blocks: [featured("f"), calloutEntry("b")] },
      ]);
      expect(parseMemberPageDocumentV2(oneInRow).success).toBe(true);

      const twoInRows = docWithEntries([
        { type: "row", ratio: "1:1", blocks: [featured("f1"), calloutEntry("b")] },
        { type: "row", ratio: "1:1", blocks: [featured("f2"), calloutEntry("c")] },
      ]);
      expectFailure(twoInRows, ["blocks"]);
    });
  });
});
