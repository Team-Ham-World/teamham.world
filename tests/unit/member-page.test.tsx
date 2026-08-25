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
});
