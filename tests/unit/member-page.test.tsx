import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import MemberPage from "@/app/m/[member]/page";
import * as memberDal from "@/lib/members/dal";

vi.mock("next/server", () => ({
  connection: vi.fn(),
}));

vi.mock("@/components/member-editor", () => ({
  MemberEditor: () => <section data-member-editor>Member editor</section>,
}));

vi.mock("@/lib/members/dal", () => ({
  getMemberPageForViewer: vi.fn(),
}));

const MEMBER = {
  slug: "cyr1en",
  displayName: "CyR1en",
  blurb: "This is a test",
  websiteUrl: null,
  socialLinks: {},
  showcase: null,
};

async function renderPage({
  isOwner,
  edit,
}: {
  isOwner: boolean;
  edit?: string;
}) {
  vi.mocked(memberDal.getMemberPageForViewer).mockResolvedValueOnce({
    page: MEMBER,
    isOwner,
    isPublished: true,
  });

  const page = await MemberPage({
    params: Promise.resolve({ member: MEMBER.slug }),
    searchParams: Promise.resolve(edit ? { edit } : {}),
  });

  return renderToStaticMarkup(page);
}

describe("member page edit mode", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the owner a pen beside their name without rendering the editor", async () => {
    const html = await renderPage({ isOwner: true });

    expect(html).toContain("CyR1en");
    expect(html).toContain("?edit=1#edit-page");
    expect(html).toContain("Edit CyR1en");
    expect(html).not.toContain("data-member-editor");
    expect(html).not.toContain("This page is public.");
  });

  it("renders the editor only when its owner opens edit mode", async () => {
    const html = await renderPage({ isOwner: true, edit: "1" });

    expect(html).toContain("data-member-editor");
  });

  it("ignores edit mode for a visitor", async () => {
    const html = await renderPage({ isOwner: false, edit: "1" });

    expect(html).not.toContain("data-member-editor");
    expect(html).not.toContain("?edit=1#edit-page");
  });

  it("renders labeled SVG social stickers beside the site link", async () => {
    vi.mocked(memberDal.getMemberPageForViewer).mockResolvedValueOnce({
      page: {
        ...MEMBER,
        websiteUrl: "https://cyr1en.example",
        socialLinks: {
          github: "https://github.com/cyr1en",
          mastodon: "https://social.example/@cyr1en",
        },
      },
      isOwner: false,
      isPublished: true,
    });

    const page = await MemberPage({
      params: Promise.resolve({ member: MEMBER.slug }),
      searchParams: Promise.resolve({}),
    });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("Visit site");
    expect(html).toContain('href="https://github.com/cyr1en"');
    expect(html).toContain('aria-label="Visit CyR1en on GitHub"');
    expect(html).toContain('href="https://social.example/@cyr1en"');
    expect(html).toContain('aria-label="Visit CyR1en on Mastodon"');
    expect(html.match(/<svg/g)).not.toHaveLength(0);
    expect(html.indexOf("Visit site")).toBeLessThan(html.indexOf("Visit CyR1en on GitHub"));
  });
});
