import { describe, expect, it } from "vitest";

import {
  HAM_PROJECT_CHOICES,
  buildAdditionalLinksBlock,
  buildCalloutQuoteBlock,
  buildExternalProjectRef,
  buildEmbedBlock,
  buildFeaturedProjectBlock,
  buildHamProjectRef,
  buildProjectListBlock,
  buildRichTextBlock,
  isLikelyHttpsUrl,
  parseEmbedInput,
} from "@/components/member-page-editor/block-catalog";
import {
  addBlock,
  canAddBlock,
  canAddFeaturedProject,
  canMoveBlock,
  countFeaturedProjectBlocks,
  deleteBlock,
  duplicateBlock,
  moveBlock,
  moveBlockToIndex,
  pairBlocks,
  replaceBlock,
  restoreBlock,
  setRowRatio,
  splitRow,
  swapRowSides,
} from "@/components/member-page-editor/document-ops";
import { MAX_BLOCKS } from "@/lib/members/v2/limits";
import type {
  MemberBlock,
  MemberBlockRow,
  MemberBlockRowRatio,
  MemberPageDocumentV2,
  MemberPageEntry,
} from "@/lib/members/v2/document";
import { analyzeMemberPageEntries } from "@/lib/members/v2/member-page-entries";
import { parseMemberPageDocumentV2 } from "@/lib/members/v2/validation";
import { withNewBlockIds, withNewRowIds } from "@/components/member-page-editor/ids";

import {
  externalProject,
  minimalMemberPageDocument,
  richTextFixture,
} from "../fixtures/member-v2/documents";

/** Sequential ids, so a duplicate's new ids are easy to spot. */
function counter() {
  let n = 0;
  return () => `new-${++n}`;
}

function calloutBlock(id: string): MemberBlock {
  return { id, type: "calloutQuote", variant: "note", text: `Text ${id}`, attribution: null };
}

function featuredBlock(id: string): MemberBlock {
  return {
    id,
    type: "featuredProject",
    variant: "card",
    project: externalProject("released", id),
  };
}

function docWith(blocks: MemberBlock[]): MemberPageDocumentV2 {
  return { ...minimalMemberPageDocument(), blocks };
}

function entryIds(entries: readonly MemberPageEntry[]): string[] {
  return entries.map((entry) => (entry.type === "row" ? "<row>" : entry.id));
}

function entryTypes(entries: readonly MemberPageEntry[]): string[] {
  return entries.map((entry) => entry.type);
}

function rowOf(
  leftId: string,
  rightId: string,
  ratio: MemberBlockRowRatio = "1:1",
): MemberBlockRow {
  return {
    type: "row",
    ratio,
    blocks: [calloutBlock(leftId), calloutBlock(rightId)],
  };
}

describe("adding blocks", () => {
  it("appends to the end of the stored order", () => {
    const doc = docWith([calloutBlock("a")]);
    const result = addBlock(doc, calloutBlock("b"));

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.document.blocks.map((entry) => (entry.type === "row" ? "<row>" : entry.id))).toEqual(["a", "b"]);
    expect(result.announcement).toMatch(/added/i);
  });

  it("refuses a thirteenth block and says why", () => {
    const blocks = Array.from({ length: MAX_BLOCKS }, (_, i) => calloutBlock(`b${i}`));
    const doc = docWith(blocks);

    expect(canAddBlock(doc)).toBe(false);

    const result = addBlock(doc, calloutBlock("overflow"));

    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.message).toContain(String(MAX_BLOCKS));
  });

  it("allows only one featured project", () => {
    const doc = docWith([featuredBlock("f1")]);

    expect(canAddFeaturedProject(doc)).toBe(false);

    const result = addBlock(doc, featuredBlock("f2"));

    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.message).toMatch(/one featured project/i);
  });

  it("keeps the document valid after an add", () => {
    const result = addBlock(docWith([]), calloutBlock("a"));
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    const parsed = parseMemberPageDocumentV2(result.document);
    expect(parsed.success).toBe(true);
  });
});

describe("duplicating blocks", () => {
  it("gives the copy a fresh id and leaves the original alone", () => {
    const doc = docWith([calloutBlock("a"), calloutBlock("b")]);
    const result = duplicateBlock(doc, "a", counter());

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.document.blocks.map((entry) => (entry.type === "row" ? "<row>" : entry.id))).toEqual(["a", "new-1", "b"]);
    expect(result.duplicatedId).toBe("new-1");
  });

  it("refuses to duplicate a second featured project", () => {
    const doc = docWith([featuredBlock("f1")]);
    const result = duplicateBlock(doc, "f1", counter());

    expect(result.status).toBe("rejected");
  });

  it("refuses to duplicate past the block ceiling", () => {
    const blocks = Array.from({ length: MAX_BLOCKS }, (_, i) => calloutBlock(`b${i}`));
    const result = duplicateBlock(docWith(blocks), "b0", counter());

    expect(result.status).toBe("rejected");
  });

  it("rewrites nested ids while reusing the same asset references", () => {
    const gallery: MemberBlock = {
      id: "g1",
      type: "gallery",
      variant: "grid",
      items: [
        {
          id: "i1",
          image: { assetId: "asset-a", alt: "A", decorative: false },
          caption: null,
        },
        {
          id: "i2",
          image: { assetId: "asset-b", alt: null, decorative: true },
          caption: null,
        },
      ],
    };

    const copy = withNewBlockIds(gallery, counter());

    expect(copy.id).toBe("new-1");
    if (copy.type !== "gallery") throw new Error("expected a gallery");
    expect(copy.items.map((item) => item.id)).toEqual(["new-2", "new-3"]);
    // The copy points at the same stored files; it does not clone them.
    expect(copy.items.map((item) => item.image.assetId)).toEqual([
      "asset-a",
      "asset-b",
    ]);
    // The original is untouched.
    expect(gallery.items.map((item) => item.id)).toEqual(["i1", "i2"]);
  });

  it("renews project-list block and entry ids while reusing artwork asset ids", () => {
    const projectList: MemberBlock = {
      id: "projects",
      type: "projectList",
      variant: "stacked",
      projects: [
        {
          id: "project-entry",
          project: {
            ...externalProject("released", "artwork"),
            artwork: {
              assetId: "asset-project-artwork",
              alt: "Project artwork",
              decorative: false,
            },
          },
        },
      ],
    };

    const copy = withNewBlockIds(projectList, counter());

    expect(copy.id).toBe("new-1");
    if (copy.type !== "projectList") throw new Error("expected a project list");
    expect(copy.projects[0].id).toBe("new-2");
    expect(copy.projects[0].project).toMatchObject({
      artwork: { assetId: "asset-project-artwork" },
    });
    expect(projectList.projects[0].id).toBe("project-entry");
  });
});

describe("deleting and undoing", () => {
  it("hands back what was removed so it can go straight back", () => {
    const doc = docWith([calloutBlock("a"), calloutBlock("b"), calloutBlock("c")]);
    const removal = deleteBlock(doc, "b");

    expect(removal.status).toBe("ok");
    if (removal.status !== "ok" || !removal.removed) return;
    expect(removal.document.blocks.map((entry) => (entry.type === "row" ? "<row>" : entry.id))).toEqual(["a", "c"]);
    expect(removal.removed.index).toBe(1);

    const restored = restoreBlock(
      removal.document,
      removal.removed.block,
      removal.removed.index,
    );

    expect(restored.status).toBe("ok");
    if (restored.status !== "ok") return;
    expect(restored.document.blocks.map((entry) => (entry.type === "row" ? "<row>" : entry.id))).toEqual(["a", "b", "c"]);
  });

  it("names the kind of block in its message", () => {
    const result = deleteBlock(docWith([featuredBlock("f1")]), "f1");

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.announcement).toMatch(/featured project/i);
  });

  it("rejects restoring a featured project after another one was added", () => {
    const removal = deleteBlock(docWith([featuredBlock("old")]), "old");
    expect(removal.status).toBe("ok");
    if (removal.status !== "ok" || !removal.removed) return;

    const replacement = addBlock(removal.document, featuredBlock("new"));
    expect(replacement.status).toBe("ok");
    if (replacement.status !== "ok") return;

    const restored = restoreBlock(
      replacement.document,
      removal.removed.block,
      removal.removed.index,
    );

    expect(restored).toEqual({
      status: "rejected",
      reason: "featured-project-limit",
      message: "A page holds one featured project. Delete the current one first.",
    });
    expect(parseMemberPageDocumentV2(replacement.document).success).toBe(true);
    expect(replacement.document.blocks).toHaveLength(1);
  });
});

describe("newly built blocks are valid on arrival", () => {
  it("preserves spaces while typing and trims external project text only on add", () => {
    const typed = buildExternalProjectRef({
      name: "My New Game ",
      shortDescription: "A small cooperative game ",
      type: "Tabletop game ",
      status: "in-development",
      url: "",
      repository: "",
    });

    expect(typed).toMatchObject({
      name: "My New Game ",
      shortDescription: "A small cooperative game ",
      type: "Tabletop game ",
    });

    const added = buildFeaturedProjectBlock(typed, counter());
    expect(added.project).toMatchObject({
      name: "My New Game",
      shortDescription: "A small cooperative game",
      type: "Tabletop game",
    });
  });

  it("produces a document the schema accepts for every creatable block", () => {
    const nextId = counter();
    const built: MemberBlock[] = [
      buildFeaturedProjectBlock(buildHamProjectRef(HAM_PROJECT_CHOICES[0].slug), nextId),
      buildProjectListBlock(buildHamProjectRef(HAM_PROJECT_CHOICES[0].slug), nextId),
      buildAdditionalLinksBlock(
        { label: "Docs", url: "https://example.com/docs", description: null },
        nextId,
      ),
      buildCalloutQuoteBlock(
        { variant: "quote", text: "Something worth quoting.", attribution: "A friend" },
        nextId,
      ),
      buildRichTextBlock(richTextFixture(), nextId),
      buildEmbedBlock(
        {
          variant: "standard",
          url: "https://open.spotify.com/embed/track/example",
          title: "Spotify track player",
          showFrame: true,
        },
        nextId,
      ),
    ];

    for (const block of built) {
      const result = addBlock(docWith([]), block);
      expect(result.status, block.type).toBe("ok");
      if (result.status !== "ok") continue;
      const parsed = parseMemberPageDocumentV2(result.document);
      expect(parsed.success, `${block.type}: ${JSON.stringify(parsed)}`).toBe(true);
    }
  });

  it("rejects an https-looking check for anything that is not https", () => {
    expect(isLikelyHttpsUrl("https://example.com")).toBe(true);
    expect(isLikelyHttpsUrl("http://example.com")).toBe(false);
    expect(isLikelyHttpsUrl("javascript:alert(1)")).toBe(false);
    expect(isLikelyHttpsUrl("example.com")).toBe(false);
    expect(isLikelyHttpsUrl("")).toBe(false);
  });

  it("extracts only safe, typed fields from pasted iframe code", () => {
    expect(parseEmbedInput(`
      <iframe
        src="https://open.spotify.com/embed/track/example?theme=0&amp;utm_source=generator"
        title="Spotify Embed: Test track"
        width="100%"
        height="152"
        style="border-radius: 20px"
        onload="alert('not saved')"
      ></iframe>
    `)).toEqual({
      url: "https://open.spotify.com/embed/track/example?theme=0&utm_source=generator",
      title: "Spotify Embed: Test track",
      variant: "compact",
    });

    expect(parseEmbedInput(
      '<iframe src="https://www.youtube.com/embed/example" width="560" height="315"></iframe>',
    )).toEqual({
      url: "https://www.youtube.com/embed/example",
      title: null,
      variant: "widescreen",
    });

    expect(parseEmbedInput("https://player.vimeo.com/video/example")).toEqual({
      url: "https://player.vimeo.com/video/example",
      title: null,
      variant: "standard",
    });
  });

  it("rejects iframe input without a credential-free HTTPS source", () => {
    expect(parseEmbedInput('<iframe src="javascript:alert(1)"></iframe>')).toBeNull();
    expect(parseEmbedInput('<iframe src="http://example.com/embed"></iframe>')).toBeNull();
    expect(parseEmbedInput('<iframe src="https://user@example.com/embed"></iframe>')).toBeNull();
    expect(parseEmbedInput("<script>alert(1)</script>")).toBeNull();
  });
});

describe("moving blocks", () => {
  it("swaps with the neighbour and says the new position", () => {
    const doc = docWith([calloutBlock("a"), calloutBlock("b"), calloutBlock("c")]);

    const down = moveBlock(doc, "a", "down");
    expect(down.status).toBe("ok");
    if (down.status !== "ok") return;
    expect(down.document.blocks.map((entry) => (entry.type === "row" ? "<row>" : entry.id))).toEqual(["b", "a", "c"]);
    expect(down.announcement).toContain("2");
    expect(down.announcement).toContain("3");

    const up = moveBlock(down.document, "a", "up");
    expect(up.status).toBe("ok");
    if (up.status !== "ok") return;
    expect(up.document.blocks.map((entry) => (entry.type === "row" ? "<row>" : entry.id))).toEqual(["a", "b", "c"]);
  });

  it("will not move the first block up or the last one down", () => {
    const doc = docWith([calloutBlock("a"), calloutBlock("b")]);

    expect(canMoveBlock(doc, "a", "up")).toBe(false);
    expect(canMoveBlock(doc, "b", "down")).toBe(false);
    expect(canMoveBlock(doc, "a", "down")).toBe(true);
    expect(canMoveBlock(doc, "b", "up")).toBe(true);

    expect(moveBlock(doc, "a", "up").status).toBe("rejected");
    expect(moveBlock(doc, "b", "down").status).toBe("rejected");
  });

  it("uses the same position announcement for absolute sortable movement", () => {
    const doc = docWith([calloutBlock("a"), calloutBlock("b"), calloutBlock("c")]);
    const result = moveBlockToIndex(doc, "a", 1);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.document.blocks.map((entry) => (entry.type === "row" ? "<row>" : entry.id))).toEqual(["b", "a", "c"]);
    expect(result.announcement).toBe("Moved Callout or quote to position 2 of 3.");
  });
});

describe("rows", () => {
  function docWithEntries(entries: MemberPageEntry[]): MemberPageDocumentV2 {
    return { ...minimalMemberPageDocument(), blocks: entries };
  }

  it("namespaces descriptor keys so a standalone id cannot equal a row key", () => {
    const doc = docWithEntries([
      calloutBlock('["a","b"]'),
      rowOf("a", "b"),
      calloutBlock("row:[\"a\",\"b\"]"),
    ]);
    const analysis = analyzeMemberPageEntries(doc.blocks);

    const [leaf, row, lookalike] = analysis.entries;
    expect(leaf?.key).toBe(`leaf:${JSON.stringify('["a","b"]')}`);
    expect(row?.key).toBe(`row:${JSON.stringify(["a", "b"])}`);
    expect(new Set([leaf?.key, row?.key, lookalike?.key]).size).toBe(3);
    expect(analysis.leaves.map((leafDescriptor) => leafDescriptor.rowKey)).toEqual([
      null,
      row?.key,
      row?.key,
      null,
    ]);
  });

  describe("pairing", () => {
    it("pairs with the previous standalone entry, preserving document order", () => {
      const doc = docWithEntries([calloutBlock("a"), calloutBlock("b"), calloutBlock("c")]);
      const result = pairBlocks(doc, "b", "previous");
      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;

      expect(entryIds(result.document.blocks)).toEqual(["<row>", "c"]);
      const [first] = result.document.blocks;
      if (first.type !== "row") throw new Error("expected a row");
      expect(first.blocks.map((block) => block.id)).toEqual(["a", "b"]);
      expect(first.ratio).toBe("1:1");
      expect(parseMemberPageDocumentV2(result.document).success).toBe(true);
    });

    it("pairs with the next standalone entry", () => {
      const doc = docWithEntries([calloutBlock("a"), calloutBlock("b"), calloutBlock("c")]);
      const result = pairBlocks(doc, "b", "next");
      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;

      expect(entryIds(result.document.blocks)).toEqual(["a", "<row>"]);
      const row = result.document.blocks[1];
      if (row.type !== "row") throw new Error("expected a row");
      expect(row.blocks.map((block) => block.id)).toEqual(["b", "c"]);
    });

    it("accepts an explicit ratio", () => {
      const doc = docWithEntries([calloutBlock("a"), calloutBlock("b")]);
      const result = pairBlocks(doc, "a", "next", "2:1");
      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;
      const [row] = result.document.blocks;
      if (row.type !== "row") throw new Error("expected a row");
      expect(row.ratio).toBe("2:1");
    });

    it("refuses to pair past the edge", () => {
      const doc = docWithEntries([calloutBlock("a"), calloutBlock("b")]);
      const previous = pairBlocks(doc, "a", "previous");
      const next = pairBlocks(doc, "b", "next");
      expect(previous).toMatchObject({ status: "rejected", reason: "at-edge" });
      expect(next).toMatchObject({ status: "rejected", reason: "at-edge" });
    });

    it("refuses to pair with or inside another row", () => {
      const doc = docWithEntries([rowOf("a", "b"), calloutBlock("c")]);
      expect(pairBlocks(doc, "c", "previous")).toMatchObject({
        status: "rejected",
        reason: "not-pairable",
      });
      expect(pairBlocks(doc, "a", "next")).toMatchObject({
        status: "rejected",
        reason: "not-pairable",
      });
    });
  });

  describe("splitting", () => {
    it("replaces the row with its two leaf entries in left-to-right order", () => {
      const doc = docWithEntries([calloutBlock("a"), rowOf("b", "c", "1:2")]);
      const result = splitRow(doc, "c");
      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;

      expect(result.split).toEqual({ leftId: "b", rightId: "c" });
      expect(entryIds(result.document.blocks)).toEqual(["a", "b", "c"]);
      expect(parseMemberPageDocumentV2(result.document).success).toBe(true);
    });

    it("refuses to split a standalone block", () => {
      const result = splitRow(docWith([calloutBlock("a")]), "a");
      expect(result).toMatchObject({ status: "rejected", reason: "not-pairable" });
    });
  });

  describe("ratio and swap", () => {
    it("sets the ratio through either child without changing the row", () => {
      const doc = docWithEntries([rowOf("a", "b"), calloutBlock("c")]);
      const result = setRowRatio(doc, "b", "1:2");
      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;

      expect(entryIds(result.document.blocks)).toEqual(["<row>", "c"]);
      const [row] = result.document.blocks;
      if (row.type !== "row") throw new Error("expected a row");
      expect(row.ratio).toBe("1:2");
      expect(row.blocks.map((block) => block.id)).toEqual(["a", "b"]);
    });

    it("swaps the two sides and keeps the ratio", () => {
      const doc = docWithEntries([rowOf("a", "b", "2:1")]);
      const result = swapRowSides(doc, "b");
      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;

      const [row] = result.document.blocks;
      if (row.type !== "row") throw new Error("expected a row");
      expect(row.blocks.map((block) => block.id)).toEqual(["b", "a"]);
      expect(row.ratio).toBe("2:1");
      expect(parseMemberPageDocumentV2(result.document).success).toBe(true);
    });

    it("refuses ratio and swap on a standalone block", () => {
      const doc = docWith([calloutBlock("a")]);
      expect(setRowRatio(doc, "a", "1:1")).toMatchObject({ status: "rejected" });
      expect(swapRowSides(doc, "a")).toMatchObject({ status: "rejected" });
    });
  });

  describe("moving", () => {
    it("moves the whole row when called with either child id", () => {
      const doc = docWithEntries([calloutBlock("a"), rowOf("b", "c")]);

      const up = moveBlock(doc, "c", "up");
      expect(up.status).toBe("ok");
      if (up.status !== "ok") return;
      expect(entryIds(up.document.blocks)).toEqual(["<row>", "a"]);
      expect(up.announcement).toBe("Moved Two-block row to position 1 of 2.");

      const down = moveBlock(up.document, "b", "down");
      expect(down.status).toBe("ok");
      if (down.status !== "ok") return;
      expect(entryIds(down.document.blocks)).toEqual(["a", "<row>"]);
    });

    it("reports row edges from either child id", () => {
      const doc = docWithEntries([rowOf("a", "b"), calloutBlock("c")]);
      expect(canMoveBlock(doc, "a", "up")).toBe(false);
      expect(canMoveBlock(doc, "b", "up")).toBe(false);
      expect(canMoveBlock(doc, "a", "down")).toBe(true);
      expect(canMoveBlock(doc, "c", "down")).toBe(false);
      expect(moveBlock(doc, "a", "up")).toMatchObject({ status: "rejected", reason: "at-edge" });
      expect(moveBlock(doc, "c", "down")).toMatchObject({ status: "rejected", reason: "at-edge" });
    });

    it("moves the row to an absolute index as one entry", () => {
      const doc = docWithEntries([calloutBlock("a"), rowOf("b", "c"), calloutBlock("d")]);
      const result = moveBlockToIndex(doc, "b", 2);
      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;
      expect(entryIds(result.document.blocks)).toEqual(["a", "d", "<row>"]);
    });
  });

  describe("replacing and deleting", () => {
    it("replaces a leaf inside a row without changing the row", () => {
      const doc = docWithEntries([rowOf("a", "b"), calloutBlock("c")]);
      const updated = featuredBlock("a");
      const next = replaceBlock(doc, updated);

      expect(entryTypes(next.blocks)).toEqual(["row", "calloutQuote"]);
      const [row] = next.blocks;
      if (row.type !== "row") throw new Error("expected a row");
      expect(row.blocks[0]).toEqual(updated);
      expect(row.blocks[1].id).toBe("b");
      expect(row.ratio).toBe("1:1");
      expect(doc.blocks[0]).not.toBe(row);
    });

    it("deleting one row child promotes the survivor at the same entry index", () => {
      const doc = docWithEntries([calloutBlock("a"), rowOf("b", "c")]);
      const removal = deleteBlock(doc, "b");
      expect(removal.status).toBe("ok");
      if (removal.status !== "ok" || !removal.removed) return;

      expect(entryIds(removal.document.blocks)).toEqual(["a", "c"]);
      expect(entryTypes(removal.document.blocks)).toEqual(["calloutQuote", "calloutQuote"]);
      expect(removal.removed.block.id).toBe("b");
      expect(removal.removed.index).toBe(1);
    });

    it("undo restores the deleted child as one standalone entry, never the pair", () => {
      const doc = docWithEntries([rowOf("a", "b", "1:2")]);
      const removal = deleteBlock(doc, "a");
      expect(removal.status).toBe("ok");
      if (removal.status !== "ok" || !removal.removed) return;

      const restored = restoreBlock(
        removal.document,
        removal.removed.block,
        removal.removed.index,
      );
      expect(restored.status).toBe("ok");
      if (restored.status !== "ok") return;

      expect(entryIds(restored.document.blocks)).toEqual(["a", "b"]);
      expect(entryTypes(restored.document.blocks)).toEqual(["calloutQuote", "calloutQuote"]);
      expect(parseMemberPageDocumentV2(restored.document).success).toBe(true);
    });
  });

  describe("duplicating rows", () => {
    function galleryBlock(id: string): MemberBlock {
      return {
        id,
        type: "gallery",
        variant: "grid",
        items: [{
          id: `${id}-item`,
          image: { assetId: `asset-${id}`, alt: "A", decorative: false },
          caption: null,
        }],
      };
    }

    it("duplicates the row as one entry with fresh ids for both children and nested ids", () => {
      const source: MemberBlockRow = {
        type: "row",
        ratio: "1:2",
        blocks: [galleryBlock("g1"), calloutBlock("c1")],
      };
      const doc = docWithEntries([calloutBlock("a"), source]);
      const result = duplicateBlock(doc, "c1", counter());

      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;
      expect(entryTypes(result.document.blocks)).toEqual(["calloutQuote", "row", "row"]);

      const copy = result.document.blocks[2];
      if (copy.type !== "row") throw new Error("expected a row");
      expect(copy.ratio).toBe("1:2");
      const [copiedGallery, copiedCallout] = copy.blocks;
      expect(copiedCallout.id).not.toBe("c1");
      expect(copiedGallery.id).not.toBe("g1");
      if (copiedGallery.type !== "gallery") throw new Error("expected a gallery");
      expect(copiedGallery.items[0].id).not.toBe("g1-item");
      expect(copiedGallery.items[0].image.assetId).toBe("asset-g1");

      const original = result.document.blocks[1];
      if (original.type !== "row") throw new Error("expected a row");
      expect(original.blocks.map((block) => block.id)).toEqual(["g1", "c1"]);
    });

    it("selects the duplicate child matching the id the call used", () => {
      const doc = docWithEntries([rowOf("a", "b")]);
      const byLeft = duplicateBlock(doc, "a", counter());
      const byRight = duplicateBlock(doc, "b", counter());

      expect(byLeft.status).toBe("ok");
      expect(byRight.status).toBe("ok");
      if (byLeft.status !== "ok" || byRight.status !== "ok") return;
      const leftCopy = byLeft.document.blocks[1];
      const rightCopy = byRight.document.blocks[1];
      if (leftCopy.type !== "row" || rightCopy.type !== "row") {
        throw new Error("expected rows");
      }
      expect(byLeft.duplicatedId).toBe(leftCopy.blocks[0].id);
      expect(byRight.duplicatedId).toBe(rightCopy.blocks[1].id);
    });

    it("refuses to duplicate past the leaf ceiling", () => {
      const rows = Array.from({ length: 6 }, (_, i) => rowOf(`l${i}`, `r${i}`));
      const doc = docWithEntries(rows);
      expect(analyzeMemberPageEntries(doc.blocks).leafCount).toBe(MAX_BLOCKS);
      expect(duplicateBlock(doc, "l0", counter()).status).toBe("rejected");
    });

    it("refuses to duplicate a row whose child is the page's featured project", () => {
      const doc = docWithEntries([
        { type: "row", ratio: "1:1", blocks: [featuredBlock("f1"), calloutBlock("b")] },
      ]);
      const result = duplicateBlock(doc, "f1", counter());
      expect(result).toMatchObject({ status: "rejected", reason: "featured-project-limit" });
    });
  });

  describe("limits over flattened leaves", () => {
    it("counts six rows as twelve leaves and refuses a thirteenth", () => {
      const full = docWithEntries(
        Array.from({ length: 6 }, (_, i) => rowOf(`l${i}`, `r${i}`)),
      );
      expect(canAddBlock(full)).toBe(false);
      expect(addBlock(full, calloutBlock("overflow")).status).toBe("rejected");
      expect(parseMemberPageDocumentV2(full).success).toBe(true);

      const almost = docWithEntries(
        Array.from({ length: 5 }, (_, i) => rowOf(`l${i}`, `r${i}`)),
      );
      expect(canAddBlock(almost)).toBe(true);
    });

    it("counts a featured project inside a row against the one-project limit", () => {
      const doc = docWithEntries([
        { type: "row", ratio: "1:1", blocks: [featuredBlock("f1"), calloutBlock("b")] },
        calloutBlock("c"),
      ]);
      expect(countFeaturedProjectBlocks(doc)).toBe(1);
      expect(canAddFeaturedProject(doc)).toBe(false);
      expect(addBlock(doc, featuredBlock("f2"))).toMatchObject({
        status: "rejected",
        reason: "featured-project-limit",
      });
    });
  });

  it("keeps ids unique through ids.ts when copying a row", () => {
    const row = rowOf("a", "b");
    const nextId = counter();
    const copy = withNewRowIds(row, nextId);
    expect(copy.blocks[0].id).toBe("new-1");
    expect(copy.blocks[1].id).toBe("new-2");
    expect(row.blocks.map((block) => block.id)).toEqual(["a", "b"]);
  });
});
