/**
 * Shared skip helpers.
 *
 * Tests skip only when a named external service requirement is absent, and
 * the skip message says exactly what is missing and how to provide it.
 */

import { test } from "@playwright/test";

import { describeRequirements, probeApp, resolveBaseUrl } from "./environment";

/**
 * Skips the current test unless every database requirement is present. The
 * reasons come from the named requirements list, so the runner output says
 * what is missing.
 */
export function skipWithoutDatabase(): void {
  const requirements = describeRequirements();
  test.skip(
    requirements.missing.length > 0,
    `Requires: ${requirements.missing.join("; ")}`,
  );
}

/**
 * Skips the current test unless the app under test answers on the local
 * development origin.
 */
export async function skipUnlessAppUp(): Promise<void> {
  const baseURL = resolveBaseUrl();
  const up = await probeApp(baseURL);
  test.skip(
    !up,
    `Requires the app under test at ${baseURL} (start it with npm run dev:vps). Nothing answered there.`,
  );
}
