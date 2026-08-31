import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MembersExplorer } from "@/components/members-explorer";

describe("MembersExplorer", () => {
  it("keeps long member details inside a fixed-height card", () => {
    const html = renderToStaticMarkup(
      <MembersExplorer
        members={[
          {
            slug: "long-description",
            displayName: "A deliberately long member name",
            blurb: "A long description ".repeat(40),
          },
        ]}
      />,
    );

    expect(html).toContain("grid items-start");
    expect(html).toContain("flex h-64 w-full flex-col overflow-hidden");
    expect(html.match(/line-clamp-2/gu)).toHaveLength(2);
  });
});
