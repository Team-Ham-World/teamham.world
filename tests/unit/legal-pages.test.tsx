import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import PrivacyPage, {
  metadata as privacyMetadata,
} from "@/app/privacy/page";
import TermsPage, { metadata as termsMetadata } from "@/app/terms/page";
import { SiteFooter } from "@/components/site-footer";

describe("legal pages", () => {
  it("renders the privacy policy with data practices and policy navigation", () => {
    const html = renderToStaticMarkup(<PrivacyPage />);

    expect(privacyMetadata.title).toBe("Privacy Policy — HAM");
    expect(html).toContain("Privacy Policy");
    expect(html).toContain('dateTime="2026-08-25"');
    expect(html).toContain("Discord user ID");
    expect(html).toContain("Puff leaderboard");
    expect(html).toContain("We do not sell personal information");
    expect(html).toContain('href="/terms"');
    expect(html).toContain('aria-label="Privacy Policy contents"');
  });

  it("renders the terms with conduct, content, and service rules", () => {
    const html = renderToStaticMarkup(<TermsPage />);

    expect(termsMetadata.title).toBe("Terms of Service — HAM");
    expect(html).toContain("Terms of Service");
    expect(html).toContain("Use it like a good neighbor");
    expect(html).toContain("You keep ownership of content you submit");
    expect(html).toContain("without express or implied warranties");
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('aria-label="Terms of Service contents"');
  });

  it("links both policies from the shared footer", () => {
    const html = renderToStaticMarkup(<SiteFooter />);

    expect(html).toContain('aria-label="Legal"');
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/terms"');
  });
});
