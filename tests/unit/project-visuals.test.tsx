import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProjectArtwork } from "@/components/project-visuals";

describe("project artwork", () => {
  it("renders arbitrary validated remote artwork without the Next image proxy", () => {
    const html = renderToStaticMarkup(
      <ProjectArtwork
        artwork={{
          src: "https://images.example.com/project.jpg",
          alt: "Project artwork",
          remote: true,
        }}
        sizes="100vw"
      />,
    );

    expect(html).toContain('src="https://images.example.com/project.jpg"');
    expect(html).toContain('referrerPolicy="no-referrer"');
    expect(html).not.toContain("/_next/image");
  });
});
