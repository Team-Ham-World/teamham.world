import fs from "node:fs";
import path from "node:path";

function assertStaticRoot(): void {
  const nextDir = path.resolve(process.cwd(), ".next");
  const prerenderManifestPath = path.join(nextDir, "prerender-manifest.json");

  if (!fs.existsSync(nextDir)) {
    console.error("Static root assertion failed: .next build directory does not exist. Run build first.");
    process.exit(1);
  }

  if (!fs.existsSync(prerenderManifestPath)) {
    console.error("Static root assertion failed: prerender-manifest.json build artifact not found.");
    process.exit(1);
  }

  let manifest: { routes?: Record<string, unknown> };
  try {
    const content = fs.readFileSync(prerenderManifestPath, "utf-8");
    manifest = JSON.parse(content);
  } catch {
    console.error("Static root assertion failed: unable to parse prerender-manifest.json build artifact.");
    process.exit(1);
  }

  if (!manifest.routes || typeof manifest.routes !== "object") {
    console.error("Static root assertion failed: invalid prerender-manifest routes format.");
    process.exit(1);
  }

  const rootRoute = manifest.routes["/"];
  if (!rootRoute) {
    console.error("Static root assertion failed: route '/' is not present in prerendered static routes.");
    process.exit(1);
  }

  // Ensure account route is not treated as static / confused with root
  if (manifest.routes["/account"]) {
    console.error("Static root assertion failed: protected route '/account' unexpectedly present in prerendered static routes.");
    process.exit(1);
  }

  console.log("Static root assertion passed: '/' is confirmed prerendered in build artifacts.");
}

assertStaticRoot();
