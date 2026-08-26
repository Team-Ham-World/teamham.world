import { describe, expect, it } from "vitest";

import {
  HAM_PROJECT_CHOICES,
  buildAdditionalLinksBlock,
  buildCalloutQuoteBlock,
  buildExternalProjectRef,
  buildFeaturedProjectBlock,
  buildHamProjectRef,
  buildProjectListBlock,
  buildRichTextBlock,
  isLikelyHttpsUrl,
} from "@/components/member-page-editor/block-catalog";
import {
  addBlock,
  canAddBlock,
  canAddFeaturedProject,
  canMoveBlock,
  deleteBlock,
  duplicateBlock,
  moveBlock,
  moveBlockToIndex,
  restoreBlock,
} from "@/components/member-page-editor/document-ops";
import { withNewBlockIds } from "@/components/member-page-editor/ids";
import { MAX_BLOCKS } from "@/lib/members/v2/limits";
import type { MemberBlock, MemberPageDocumentV2 } from "@/lib/members/v2/document";
import { parseMemberPageDocumentV2 } from "@/lib/members/v2/validation";

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

describe("adding blocks", () => {
  it("appends to the end of the stored order", () => {
    const doc = docWith([calloutBlock("a")]);
    const result = addBlock(doc, calloutBlock("b"));

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.document.blocks.map((b) => b.id)).toEqual(["a", "b"]);
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
    expect(result.document.blocks.map((b) => b.id)).toEqual(["a", "new-1", "b"]);
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
    expect(removal.document.blocks.map((x) => x.id)).toEqual(["a", "c"]);
    expect(removal.removed.index).toBe(1);

    const restored = restoreBlock(
      removal.document,
      removal.removed.block,
      removal.removed.index,
    );

    expect(restored.status).toBe("ok");
    if (restored.status !== "ok") return;
    expect(restored.document.blocks.map((x) => x.id)).toEqual(["a", "b", "c"]);
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
});

describe("moving blocks", () => {
  it("swaps with the neighbour and says the new position", () => {
    const doc = docWith([calloutBlock("a"), calloutBlock("b"), calloutBlock("c")]);

    const down = moveBlock(doc, "a", "down");
    expect(down.status).toBe("ok");
    if (down.status !== "ok") return;
    expect(down.document.blocks.map((x) => x.id)).toEqual(["b", "a", "c"]);
    expect(down.announcement).toContain("2");
    expect(down.announcement).toContain("3");

    const up = moveBlock(down.document, "a", "up");
    expect(up.status).toBe("ok");
    if (up.status !== "ok") return;
    expect(up.document.blocks.map((x) => x.id)).toEqual(["a", "b", "c"]);
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
    expect(result.document.blocks.map((block) => block.id)).toEqual(["b", "a", "c"]);
    expect(result.announcement).toBe("Moved Callout or quote to position 2 of 3.");
  });
});
