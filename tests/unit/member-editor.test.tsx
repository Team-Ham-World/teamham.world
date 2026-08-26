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
  socialLinks: {
    github: "https://github.com/cyr1en",
    bluesky: "https://bsky.app/profile/cyr1en.example",
  },
  showcase: null,
};

function renderEditor(showcase: MemberShowcase | null) {
  return renderToStaticMarkup(
    <MemberEditor member={{ ...MEMBER, showcase }} />,
  );
}

describe("member editor showcase fields", () => {
  it("offers every supported social profile and preserves saved URLs", () => {
    const html = renderEditor(null);

    for (const platform of [
      "GitHub",
      "Bluesky",
      "Mastodon",
      "Instagram",
      "YouTube",
      "Twitch",
      "X",
    ]) {
      expect(html).toContain(platform);
    }
    expect(html).toContain('name="socialGithub"');
    expect(html).toContain('value="https://github.com/cyr1en"');
    expect(html).toContain('name="socialBluesky"');
    expect(html).toContain('value="https://bsky.app/profile/cyr1en.example"');
  });

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
    expect(html).not.toContain('id="showcaseImageUrl"');
    expect(html).not.toContain('name="showcaseImageUrl"');
    expect(html).toContain('src="https://patchtray.io/cover.jpg"');
    expect(html).toContain("shown read-only");
    expect(html).toContain("will not create, replace, or import artwork");
    expect(html).toContain("after this page joins the V2 rollout");
    expect(html).not.toContain("Open Graph");
    expect(html).not.toContain("Artwork URL");
  });

  it("does not offer automatic or URL artwork controls when no remote art exists", () => {
    const html = renderEditor({
      kind: "external",
      name: "PatchTray",
      shortDescription: "A visual VST3 host.",
      type: "Tool",
      status: "released",
      url: "https://patchtray.io",
    });

    expect(html).toContain("Artwork cannot be added from this legacy editor.");
    expect(html).toContain("Uploaded project artwork is managed in the new page editor");
    expect(html).not.toContain('name="showcaseImageUrl"');
    expect(html).not.toContain("Open Graph");
    expect(html).not.toContain("Artwork URL");
  });

  it("shows no project fields when the showcase is disabled", () => {
    const html = renderEditor(null);

    expect(html).not.toContain('id="projectSlug"');
    expect(html).not.toContain('id="showcaseName"');
    expect(html).not.toContain('id="showcaseDescription"');
  });
});
