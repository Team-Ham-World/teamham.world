import {
  anonymousContext,
  openEditor,
  ownerContext,
  publicPath,
  test,
  expect,
} from "./support/fixture";
import {
  probeStorage,
  resolveStorageUrl,
  uploadOriginViolation,
} from "./support/environment";
import { skipUnlessAppUp, skipWithoutDatabase } from "./support/skip";

/**
 * Scenario 3 (runbook): upload, finalize, select, publish, and anonymous
 * asset access, then same-tab unpublish revocation asserted from a fresh
 * anonymous client.
 *
 * Setup predicate: the local MinIO harness (npm run storage:local, started by
 * npm run dev:vps). Without it the test skips with the named blocker instead
 * of pretending to pass. The flow itself is the real one: allocation, the
 * presigned browser PUT to MinIO, server-side verification/finalize, a
 * reference placed through the editor UI, publish, and revocation.
 *
 * Storage safety: the approved storage origin comes from resolveStorageUrl()
 * (HTTPS loopback only). A route gate inspects every allocation response
 * BEFORE the browser receives it; if the server-issued upload URL does not
 * point at the approved origin, the browser never sees that URL and the
 * image bytes are never sent anywhere else — the test fails instead.
 */
test.describe("member page V2 editor: asset upload through revocation", () => {
  skipWithoutDatabase();

  test("uploaded portrait becomes public with the page and revokes on unpublish", async ({
    browser,
    member,
  }) => {
    skipUnlessAppUp();

    const storageURL = resolveStorageUrl();
    const storageUp = await probeStorage(storageURL);
    test.skip(
      !storageUp,
      `Requires local MinIO object storage at ${storageURL} (start it with npm run storage:local, or npm run dev:vps which boots it). Health endpoint did not answer, so direct upload cannot run.`,
    );

    const owner = await ownerContext(browser, member.sessionToken);
    try {
      const editorPage = await owner.newPage();
      await openEditor(editorPage);

      // Route gate: before the browser can upload a single byte, the
      // allocation response's server-issued upload URL must point at the
      // approved storage origin. On a mismatch the gate never delivers the
      // URL to the page; it answers service_unavailable and records why.
      const uploadOriginGate = { rejection: null as string | null };
      await editorPage.route("**/api/member-page-assets/uploads", async (route) => {
        const response = await route.fetch();
        if (!response.ok) {
          await route.fulfill({ response });
          return;
        }
        const body = (await response.json()) as { uploadUrl?: unknown };
        const uploadUrl =
          typeof body?.uploadUrl === "string" ? body.uploadUrl : "";
        const violation = uploadOriginViolation(uploadUrl, storageURL);
        if (violation !== null) {
          uploadOriginGate.rejection = violation;
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: "service_unavailable" }),
          });
          return;
        }
        await route.fulfill({ response });
      });

      // The asset library lives behind the rail's Images tab.
      await editorPage.locator("#member-page-rail-tab-images").click();

      // Build a genuinely decodable PNG inside this browser so the editor's
      // real normalization path (decode, re-encode, size checks) succeeds.
      const pngBase64 = await editorPage.evaluate(async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 320;
        canvas.height = 200;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas is unavailable in this browser.");
        context.fillStyle = "#b53120";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = "#f4ede1";
        context.fillRect(24, 24, canvas.width - 48, canvas.height - 48);
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/png"),
        );
        if (!blob) throw new Error("Canvas PNG encoding failed.");
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = "";
        for (const byte of bytes) binary += String.fromCharCode(byte);
        return btoa(binary);
      });

      const allocationResponse = editorPage.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/member-page-assets/uploads" &&
          response.request().method() === "POST" &&
          response.ok(),
      );

      await editorPage.locator("#asset-library-upload").setInputFiles({
        name: "e2e-portrait.png",
        mimeType: "image/png",
        buffer: Buffer.from(pngBase64, "base64"),
      });

      const allocation = (await (await allocationResponse).json()) as {
        assetId: string;
        uploadUrl: string;
      };

      // Both assertions are about the same fact from two sides: the gate
      // approved the URL before delivery, and the delivered allocation's
      // upload URL is on the approved storage origin. Bytes only ever go to
      // an origin that passed both checks.
      expect(uploadOriginGate.rejection).toBeNull();
      expect(uploadOriginViolation(allocation.uploadUrl, storageURL)).toBeNull();

      // Finalize turns the pending upload into a verified, ready image.
      await expect(
        editorPage.getByText(/is ready at 320 × 200\./),
      ).toBeVisible();

      // Select the ready image as the frame portrait through the inspector.
      await editorPage.getByRole("button", { name: "Add portrait" }).click();
      await editorPage.locator("#new-frame-portrait-asset").selectOption({
        value: allocation.assetId,
      });
      await editorPage.locator("#new-frame-portrait-alt").fill("E2E portrait");
      await editorPage
        .getByRole("button", { name: "Use as portrait" })
        .click();
      await expect(editorPage.locator("[data-autosave-state]")).toHaveAttribute(
        "data-autosave-state",
        "saved",
      );

      await editorPage.locator("#member-page-publish").click();
      await expect(
        editorPage.getByText("Published. Your page is live."),
      ).toBeVisible();

      // Anonymous access: the page shows the portrait and serves its bytes.
      const assetPath = `/member-assets/${allocation.assetId}`;
      const anonymous = await anonymousContext(browser);
      const publicPage = await anonymous.newPage();
      const pageResponse = await publicPage.goto(publicPath());
      expect(pageResponse?.status()).toBe(200);
      const portrait = publicPage.locator(`img[src="${assetPath}"]`);
      await expect(portrait).toBeVisible();
      const assetResponse = await anonymous.request.get(assetPath);
      expect(assetResponse.status()).toBe(200);
      expect(assetResponse.headers()["content-type"]).toBe("image/png");
      expect(assetResponse.headers()["cache-control"]).toContain("no-store");
      await anonymous.close();

      // Unpublish from the same tab that published, and require success.
      // A publication-generation conflict is NOT an accepted outcome here:
      // if the editor cannot unpublish what it just published, the test
      // fails, because the revoked page and asset would never go 404.
      await editorPage.getByRole("button", { name: "Unpublish" }).click();
      await expect(
        editorPage.getByText("Unpublished. Only you can see this page now."),
      ).toBeVisible();

      // Revocation must hold for a fresh anonymous client: fresh page and
      // asset requests both return 404.
      const revoked = await anonymousContext(browser);
      const revokedPageResponse = await revoked.request.get(publicPath());
      expect(revokedPageResponse.status()).toBe(404);
      const revokedAssetResponse = await revoked.request.get(assetPath);
      expect(revokedAssetResponse.status()).toBe(404);
      await revoked.close();
    } finally {
      await owner.close();
    }
  });
});
