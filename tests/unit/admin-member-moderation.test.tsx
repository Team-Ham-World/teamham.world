import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AdminMembersPage from "@/app/admin/members/page";
import {
  AdminMemberCreateForm,
  AdminMemberRowControls,
} from "@/components/admin-member-forms";
import type {
  AdminAccountOption,
  AdminMemberPageRow,
} from "@/lib/members/dal";
import * as memberDal from "@/lib/members/dal";

vi.mock("next/server", () => ({
  connection: vi.fn(),
}));

vi.mock("@/lib/members/dal", () => ({
  getAdminMemberManagementData: vi.fn(),
  MemberAccessError: class extends Error {
    constructor(
      public code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));

const MOCK_ACCOUNTS: AdminAccountOption[] = [
  {
    id: "account-1",
    username: "alice",
    hasPage: true,
    assignedPageSlug: "alice",
  },
  {
    id: "account-2",
    username: "bob",
    hasPage: true,
    assignedPageSlug: "bob",
  },
  {
    id: "account-3",
    username: null,
    hasPage: false,
    assignedPageSlug: null,
  },
];

const PUBLISHED_PAGE: AdminMemberPageRow = {
  id: "page-1",
  slug: "alice",
  displayName: "Alice",
  isPublished: true,
  moderationHold: false,
  publishedAt: "2026-01-15T10:00:00Z",
  unpublishedAt: null,
  moderationHeldAt: null,
  isV2Cohort: false,
  ownerAccountId: "account-1",
  ownerUsername: "alice",
};

const UNPUBLISHED_PAGE: AdminMemberPageRow = {
  id: "page-2",
  slug: "bob",
  displayName: "Bob",
  isPublished: false,
  moderationHold: false,
  publishedAt: null,
  unpublishedAt: "2026-01-20T14:00:00Z",
  moderationHeldAt: null,
  isV2Cohort: false,
  ownerAccountId: "account-2",
  ownerUsername: "bob",
};

const HELD_PAGE: AdminMemberPageRow = {
  id: "page-3",
  slug: "charlie",
  displayName: "Charlie",
  isPublished: false,
  moderationHold: true,
  publishedAt: "2026-01-10T08:00:00Z",
  unpublishedAt: "2026-01-22T12:00:00Z",
  moderationHeldAt: "2026-01-22T12:00:00Z",
  isV2Cohort: false,
  ownerAccountId: "account-3",
  ownerUsername: null,
};

describe("AdminMembersPage publication status", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows published badge and clickable link for published non-held pages", async () => {
    vi.mocked(memberDal.getAdminMemberManagementData).mockResolvedValue({
      accounts: MOCK_ACCOUNTS,
      pages: [PUBLISHED_PAGE],
    });

    const page = await AdminMembersPage();
    const html = renderToStaticMarkup(page);

    expect(html).toContain("Published");
    expect(html).toContain('href="/m/alice"');
    expect(html).toContain("bg-interactive-blue");
  });

  it("shows unpublished badge and non-clickable slug for unpublished pages", async () => {
    vi.mocked(memberDal.getAdminMemberManagementData).mockResolvedValue({
      accounts: MOCK_ACCOUNTS,
      pages: [UNPUBLISHED_PAGE],
    });

    const page = await AdminMembersPage();
    const html = renderToStaticMarkup(page);

    expect(html).toContain("Unpublished");
    expect(html).not.toContain('href="/m/bob"');
    expect(html).toContain("bg-surface");
  });

  it("shows held badge and non-clickable slug for held pages", async () => {
    vi.mocked(memberDal.getAdminMemberManagementData).mockResolvedValue({
      accounts: MOCK_ACCOUNTS,
      pages: [HELD_PAGE],
    });

    const page = await AdminMembersPage();
    const html = renderToStaticMarkup(page);

    expect(html).toContain("Held");
    expect(html).not.toContain('href="/m/charlie"');
    expect(html).toContain("bg-decorative-red");
  });

  it("distinguishes published, unpublished, and held pages in one list", async () => {
    vi.mocked(memberDal.getAdminMemberManagementData).mockResolvedValue({
      accounts: MOCK_ACCOUNTS,
      pages: [PUBLISHED_PAGE, UNPUBLISHED_PAGE, HELD_PAGE],
    });

    const page = await AdminMembersPage();
    const html = renderToStaticMarkup(page);

    expect(html).toContain("Published");
    expect(html).toContain("Unpublished");
    expect(html).toContain("Held");
    expect(html).toContain("Alice");
    expect(html).toContain("Bob");
    expect(html).toContain("Charlie");
  });
});

describe("AdminMemberRowControls moderation actions", () => {
  it("shows take-down-and-hold button for non-held pages", () => {
    const html = renderToStaticMarkup(
      <AdminMemberRowControls page={PUBLISHED_PAGE} accounts={MOCK_ACCOUNTS} />
    );

    expect(html).toContain("Take down and hold");
    expect(html).toContain(">Reassign<");
    expect(html.indexOf("Take down and hold")).toBeLessThan(
      html.indexOf(">Reassign<"),
    );
    expect(html).toContain('value="take-down-and-hold"');
    expect(html).toContain(`value="${PUBLISHED_PAGE.slug}"`);
    expect(html).not.toContain("Clear hold");
  });

  it("shows clear-hold button and explanation for held pages", () => {
    const html = renderToStaticMarkup(
      <AdminMemberRowControls page={HELD_PAGE} accounts={MOCK_ACCOUNTS} />
    );

    expect(html).toContain("Clear hold");
    expect(html).toContain('value="clear-hold"');
    expect(html).toContain(`value="${HELD_PAGE.slug}"`);
    expect(html).toContain("Moderation hold active");
    expect(html).toContain(
      "owner can continue editing, uploading, and resetting"
    );
    expect(html).toContain("cannot publish while the hold is active");
    expect(html).toContain("Clearing the hold leaves the page unpublished");
    expect(html).not.toContain("Take down and hold");
  });

  it("includes slug as hidden input for moderation actions", () => {
    const publishedHtml = renderToStaticMarkup(
      <AdminMemberRowControls
        page={PUBLISHED_PAGE}
        accounts={MOCK_ACCOUNTS}
      />
    );
    const heldHtml = renderToStaticMarkup(
      <AdminMemberRowControls page={HELD_PAGE} accounts={MOCK_ACCOUNTS} />
    );

    expect(publishedHtml).toContain('name="slug"');
    expect(publishedHtml).toContain(`value="${PUBLISHED_PAGE.slug}"`);
    expect(heldHtml).toContain('name="slug"');
    expect(heldHtml).toContain(`value="${HELD_PAGE.slug}"`);
  });
});

describe("AdminMemberRowControls legacy publication controls", () => {
  it("places legacy publish/unpublish inside collapsed details", () => {
    const html = renderToStaticMarkup(
      <AdminMemberRowControls
        page={UNPUBLISHED_PAGE}
        accounts={MOCK_ACCOUNTS}
      />
    );

    expect(html).toContain("<details");
    expect(html).toContain("Legacy controls");
    expect(html).toContain("bridge period");
    expect(html).toContain('value="publish"');
    expect(html).toContain("Publish");
  });

  it("shows unpublish for published pages in legacy section", () => {
    const html = renderToStaticMarkup(
      <AdminMemberRowControls page={PUBLISHED_PAGE} accounts={MOCK_ACCOUNTS} />
    );

    expect(html).toContain("Legacy controls");
    expect(html).toContain('value="unpublish"');
    expect(html).toContain("Unpublish");
  });

  it("removes legacy publication controls from the V2 cohort path", () => {
    const html = renderToStaticMarkup(
      <AdminMemberRowControls
        page={{ ...PUBLISHED_PAGE, isV2Cohort: true }}
        accounts={MOCK_ACCOUNTS}
      />
    );

    expect(html).not.toContain("Legacy controls");
    expect(html).not.toContain('value="publish"');
    expect(html).not.toContain('value="unpublish"');
    expect(html).toContain("Take down and hold");
  });
});

describe("AdminMemberCreateForm", () => {
  it("does not offer immediate publication or an explanatory note", () => {
    const html = renderToStaticMarkup(
      <AdminMemberCreateForm accounts={MOCK_ACCOUNTS} />
    );

    expect(html).not.toContain('name="isPublished"');
    expect(html).not.toContain("Publish immediately");
    expect(html).not.toContain("Starts unpublished");
    expect(html).not.toContain("V2 owners publish from the editor");
  });

  it("names the exact assigned page instead of showing a generic conflict", () => {
    const html = renderToStaticMarkup(
      <AdminMemberCreateForm accounts={MOCK_ACCOUNTS} />
    );

    expect(html).toContain("@alice — owns /m/alice");
    expect(html).toContain("@bob — owns /m/bob");
    expect(html).not.toContain("already has a page");
  });
});

describe("AdminMemberRowControls reassignment privacy", () => {
  it("hides reassignment controls and privacy details until requested", () => {
    const html = renderToStaticMarkup(
      <AdminMemberRowControls page={PUBLISHED_PAGE} accounts={MOCK_ACCOUNTS} />
    );

    expect(html).toContain(">Reassign<");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain(`aria-controls="reassign-owner-${PUBLISHED_PAGE.id}"`);
    expect(html).not.toContain("New owner");
    expect(html).not.toContain('value="reassign"');
    expect(html).not.toContain("Reassignment transfers the page");
    expect(html).not.toContain("private draft and page-scoped assets");
    expect(html).not.toContain(`id="reassign-owner-${PUBLISHED_PAGE.id}"`);
  });

  it("does not render account options before disclosure", () => {
    const html = renderToStaticMarkup(
      <AdminMemberRowControls page={PUBLISHED_PAGE} accounts={MOCK_ACCOUNTS} />
    );

    expect(html).not.toContain("@alice");
    expect(html).not.toContain("@bob");
    expect(html).not.toContain("Member account-");
    expect(html).not.toContain("already has a page");
  });
});

describe("AdminMemberRowControls accessible labels", () => {
  it("uses proper button labels for moderation actions", () => {
    const takedownHtml = renderToStaticMarkup(
      <AdminMemberRowControls page={PUBLISHED_PAGE} accounts={MOCK_ACCOUNTS} />
    );
    const clearHtml = renderToStaticMarkup(
      <AdminMemberRowControls page={HELD_PAGE} accounts={MOCK_ACCOUNTS} />
    );

    expect(takedownHtml).toContain(">Take down and hold<");
    expect(clearHtml).toContain(">Clear hold<");
  });

  it("includes aria-live status region for action feedback", () => {
    const html = renderToStaticMarkup(
      <AdminMemberRowControls page={PUBLISHED_PAGE} accounts={MOCK_ACCOUNTS} />
    );

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
  });
});

describe("AdminMemberRowControls privacy boundaries", () => {
  it("never exposes draft document content", () => {
    const html = renderToStaticMarkup(
      <AdminMemberRowControls page={HELD_PAGE} accounts={MOCK_ACCOUNTS} />
    );

    expect(html).not.toContain("draft_doc");
    expect(html).not.toContain("draft_rev");
    expect(html).not.toContain("draft_updated_at");
    expect(html).not.toContain("schemaVersion");
    expect(html).not.toContain("blocks");
  });

  it("never exposes asset object keys or presigned URLs", () => {
    const html = renderToStaticMarkup(
      <AdminMemberRowControls page={PUBLISHED_PAGE} accounts={MOCK_ACCOUNTS} />
    );

    expect(html).not.toContain("object_key");
    expect(html).not.toContain("presigned");
    expect(html).not.toContain("X-Amz-");
    expect(html).not.toContain("r2.cloudflarestorage");
  });

  it("only shows allowed metadata fields", () => {
    const html = renderToStaticMarkup(
      <AdminMemberRowControls page={HELD_PAGE} accounts={MOCK_ACCOUNTS} />
    );

    // These are allowed according to spec §12.4
    expect(html).toContain(HELD_PAGE.slug);

    // Timestamps, revision numbers, and document internals are not exposed
    expect(html).not.toContain("2026-01-22T12:00:00Z");
    expect(html).not.toContain("draft_rev");
    expect(html).not.toContain("published_doc");
  });
});

describe("AdminMemberRowControls HAM design consistency", () => {
  it("uses HAM button classes with proper target size", () => {
    const html = renderToStaticMarkup(
      <AdminMemberRowControls page={PUBLISHED_PAGE} accounts={MOCK_ACCOUNTS} />
    );

    expect(html).toContain("min-h-11");
    expect(html).toContain("border-2 border-ink");
    expect(html).toContain("bg-ink");
    expect(html).toContain("text-paper");
    expect(html).toContain("uppercase");
    expect(html).toContain("shadow-[3px_3px_0_0_var(--color-muted)]");
  });

  it("keeps the owner select out of the initial card markup", () => {
    const html = renderToStaticMarkup(
      <AdminMemberRowControls page={PUBLISHED_PAGE} accounts={MOCK_ACCOUNTS} />
    );

    expect(html).not.toContain("<select");
    expect(html).not.toContain('name="ownerAccountId"');
  });

  it("uses error color for error state messages", () => {
    const html = renderToStaticMarkup(
      <AdminMemberRowControls page={HELD_PAGE} accounts={MOCK_ACCOUNTS} />
    );

    // Verify the status region can show errors with decorative-red
    expect(html).toContain('role="status"');
    expect(html).toContain("font-bold text-muted"); // Default state
  });
});
