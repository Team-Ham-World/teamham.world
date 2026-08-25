import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { MemberEditor } from "@/components/member-editor";
import { PROJECTS } from "@/data/projects";
import type { MemberPublicPage, MemberShowcase } from "@/lib/members/model";

vi.mock("@/app/m/[member]/actions", () => ({
  updateMemberPageAction: vi.fn(),
}));

const MEMBER: MemberPublicPage = {
  slug: "cyr1en",
  displayName: "CyR1en",
  blurb: "Builds strange and useful things.",
  websiteUrl: null,
  showcase: null,
};

function renderEditor(showcase: MemberShowcase | null) {
  return renderToStaticMarkup(
    <MemberEditor member={{ ...MEMBER, showcase }} />,
  );
}

describe("member editor showcase fields", () => {
  it("shows only the HAM project picker for a HAM project", () => {
    const html = renderEditor({
      kind: "project",
      projectSlug: PROJECTS[0].slug,
    });

    expect(html).toContain('id="projectSlug"');
    expect(html).not.toContain('id="showcaseName"');
    expect(html).not.toContain('id="showcaseDescription"');
    expect(html).not.toContain("HAM project fields");
    expect(html).not.toContain("External project fields");
    for (const project of PROJECTS) expect(html).toContain(project.name);
  });

  it("shows only the external project fields for an external project", () => {
    const html = renderEditor({
      kind: "external",
      name: "PatchTray",
      shortDescription: "A visual VST3 host.",
      type: "Tool",
      status: "released",
      url: "https://patchtray.io",
      imageUrl: "https://patchtray.io/cover.jpg",
    });

    expect(html).not.toContain('id="projectSlug"');
    expect(html).toContain('id="showcaseName"');
    expect(html).toContain('id="showcaseDescription"');
    expect(html).toContain('id="showcaseStatus"');
    expect(html).toContain('id="showcaseImageUrl"');
    expect(html).toContain('value="https://patchtray.io/cover.jpg"');
  });

  it("shows no project fields when the showcase is disabled", () => {
    const html = renderEditor(null);

    expect(html).not.toContain('id="projectSlug"');
    expect(html).not.toContain('id="showcaseName"');
    expect(html).not.toContain('id="showcaseDescription"');
  });
});
