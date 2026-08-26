import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const RENDERER_DIR = join(
  process.cwd(),
  "src",
  "components",
  "member-page-v2"
);

function getAllFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getAllFiles(fullPath));
    } else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) {
      files.push(fullPath);
    }
  }

  return files;
}

describe("MemberPageV2 renderer source isolation", () => {
  const rendererFiles = getAllFiles(RENDERER_DIR);

  it("contains no use client directives", () => {
    for (const file of rendererFiles) {
      const content = readFileSync(file, "utf-8");
      expect(content).not.toMatch(/['"]use client['"]/);
    }
  });

  it("contains no TipTap imports", () => {
    for (const file of rendererFiles) {
      const content = readFileSync(file, "utf-8");
      expect(content).not.toMatch(/@tiptap/i);
      expect(content).not.toMatch(/from ['"]tiptap/i);
    }
  });

  it("contains no dnd-kit imports", () => {
    for (const file of rendererFiles) {
      const content = readFileSync(file, "utf-8");
      expect(content).not.toMatch(/@dnd-kit/i);
    }
  });

  it("contains no dangerouslySetInnerHTML usage", () => {
    for (const file of rendererFiles) {
      const content = readFileSync(file, "utf-8");
      expect(content).not.toMatch(/dangerouslySetInnerHTML/);
    }
  });

  it("contains no editor or upload module imports", () => {
    for (const file of rendererFiles) {
      const content = readFileSync(file, "utf-8");
      expect(content).not.toMatch(/['"]@\/.*\/editor/);
      expect(content).not.toMatch(/['"]@\/.*upload/);
      expect(content).not.toMatch(/['"]@\/.*autosave/);
    }
  });
});
