import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SRC = path.join(process.cwd(), "src");

async function readSource(relative: string): Promise<string> {
  return readFile(path.join(SRC, relative), "utf8");
}

/**
 * The editor must not reach a visitor.
 *
 * These checks read the source directly rather than the bundle, because the
 * property we care about is a structural one: the public renderer has no
 * reference to editor code, and the route only reaches the editor through an
 * import taken inside the owner branch.
 */
describe("public renderer stays independent of the editor", () => {
  const publicRendererFiles = [
    "components/member-page-v2/MemberPageV2View.tsx",
    "components/member-page-v2/blocks/MemberPageV2Body.tsx",
    "components/member-page-v2/blocks/MemberPageV2RichText.tsx",
    "components/member-page-v2/blocks/MemberPageV2FeaturedProject.tsx",
    "components/member-page-v2/blocks/MemberPageV2ProjectList.tsx",
    "components/member-page-v2/blocks/MemberPageV2AdditionalLinks.tsx",
    "components/member-page-v2/blocks/MemberPageV2Image.tsx",
    "components/member-page-v2/blocks/MemberPageV2Gallery.tsx",
    "components/member-page-v2/blocks/MemberPageV2CalloutQuote.tsx",
    "components/member-page-v2/index.ts",
  ];

  it("has no import of any editor module", async () => {
    for (const file of publicRendererFiles) {
      const source = await readSource(file);
      expect(source, file).not.toContain("member-page-editor");
      expect(source, file).not.toContain("v2-actions");
    }
  });

  it("has no client boundary in the public render path", async () => {
    for (const file of publicRendererFiles) {
      const source = await readSource(file);
      expect(source.trimStart().startsWith('"use client"'), file).toBe(false);
    }
  });
});

describe("route reaches the editor only through the owner branch", () => {
  it("has no top-level import of the editor", async () => {
    const source = await readSource("app/m/[member]/page.tsx");
    const topLevel = source
      .split("\n")
      .filter((line) => /^import\s/.test(line) || /^\s+from\s+"/.test(line))
      .join("\n");

    expect(topLevel).not.toContain("member-page-editor");
    expect(topLevel).not.toContain("v2-actions");
  });

  it("imports the editor and the owner draft read dynamically", async () => {
    const source = await readSource("app/m/[member]/page.tsx");

    expect(source).toContain('import("@/components/member-page-editor/editor-mount")');
    expect(source).toContain('import("@/lib/members/v2/dal")');
  });

  it("keeps the owner draft read out of the public path", async () => {
    const source = await readSource("app/m/[member]/page.tsx");
    // The only mention of the owner draft read is inside a dynamic import.
    const staticMentions = source
      .split("\n")
      .filter((line) => line.includes("getOwnedMemberPageDraftV2"))
      .filter((line) => !line.includes("import(") && !line.includes("{ getOwnedMemberPageDraftV2 }"));

    for (const line of staticMentions) {
      expect(line).toMatch(/draft\.|await getOwnedMemberPageDraftV2\(slug\)/);
    }
  });
});

describe("sortable code stays behind the owner-only lazy boundary", () => {
  it("keeps dnd-kit imports out of the shell and public renderer", async () => {
    const shell = await readSource("components/member-page-editor/editor-shell.tsx");
    const lazyCanvas = await readSource(
      "components/member-page-editor/editor-canvas-lazy.tsx",
    );
    const sortableCanvas = await readSource(
      "components/member-page-editor/sortable-editor-canvas.tsx",
    );

    expect(shell).not.toContain("@dnd-kit/");
    expect(lazyCanvas).not.toContain("@dnd-kit/");
    expect(lazyCanvas).toContain('import("./sortable-editor-canvas")');
    expect(sortableCanvas).toContain('from "@dnd-kit/core"');
    expect(sortableCanvas).toContain('from "@dnd-kit/sortable"');
  });
});
