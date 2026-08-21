const BASE_URL = process.env.CI_BASE_URL || "http://127.0.0.1:3000";

const PROTECTED_CACHE_CONTROL = "private, no-cache, no-store, max-age=0, must-revalidate";
const PROTECTED_REFERRER_POLICY = "no-referrer";

async function waitServerReady(baseUrl: string, maxAttempts = 30, delayMs = 500): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(baseUrl, { redirect: "manual" });
      if (res.status > 0) {
        return;
      }
    } catch {
      // Server not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(`Server at ${baseUrl} failed to respond after ${maxAttempts} attempts.`);
}

function getVaryTokens(res: Response): string[] {
  const vary = res.headers.get("vary");
  if (!vary) return [];
  return vary.split(",").map((token) => token.trim().toLowerCase());
}

async function runSmokeTests(): Promise<void> {
  const normalizedBase = BASE_URL.replace(/\/+$/, "");

  // 1. Wait for server readiness
  await waitServerReady(normalizedBase);

  // 2. Assert root '/'
  const rootRes = await fetch(`${normalizedBase}/`, { redirect: "manual" });
  if (rootRes.status !== 200) {
    throw new Error(`GET / returned status ${rootRes.status}, expected 200.`);
  }

  const rootVaryTokens = getVaryTokens(rootRes);
  if (rootVaryTokens.includes("cookie")) {
    throw new Error("GET / emitted 'Vary: Cookie', which is forbidden for the static root.");
  }

  const rootCacheControl = rootRes.headers.get("cache-control")?.toLowerCase() || "";
  if (rootCacheControl.includes("no-store") || rootCacheControl.includes("private")) {
    throw new Error(`GET / emitted protected/private no-store cache semantics: '${rootCacheControl}'.`);
  }

  if (rootRes.headers.get("set-cookie")) {
    throw new Error("GET / unexpectedly set cookies.");
  }

  // 3. Assert disabled endpoints
  const disabledEndpoints: Array<{ path: string; method: "GET" | "POST" }> = [
    { path: "/account", method: "GET" },
    { path: "/api/auth/discord/login", method: "GET" },
    { path: "/api/auth/discord/callback", method: "GET" },
    { path: "/api/auth/logout", method: "POST" },
  ];

  for (const { path: routePath, method } of disabledEndpoints) {
    const targetUrl = `${normalizedBase}${routePath}`;
    const res = await fetch(targetUrl, {
      method,
      redirect: "manual",
    });

    if (res.status !== 404) {
      throw new Error(`${method} ${routePath} returned status ${res.status}, expected 404 in disabled mode.`);
    }

    const cc = res.headers.get("cache-control");
    if (!cc || cc.toLowerCase() !== PROTECTED_CACHE_CONTROL.toLowerCase()) {
      throw new Error(
        `${method} ${routePath} Cache-Control mismatch: received '${cc}', expected '${PROTECTED_CACHE_CONTROL}'.`
      );
    }

    const refPolicy = res.headers.get("referrer-policy");
    if (!refPolicy || refPolicy.toLowerCase() !== PROTECTED_REFERRER_POLICY.toLowerCase()) {
      throw new Error(
        `${method} ${routePath} Referrer-Policy mismatch: received '${refPolicy}', expected '${PROTECTED_REFERRER_POLICY}'.`
      );
    }

    const varyTokens = getVaryTokens(res);
    if (!varyTokens.includes("cookie")) {
      throw new Error(`${method} ${routePath} Vary header does not include 'Cookie'. Vary: '${res.headers.get("vary")}'`);
    }

    if (res.headers.get("set-cookie")) {
      throw new Error(`${method} ${routePath} unexpectedly emitted Set-Cookie in disabled mode.`);
    }
  }

  console.log("Disabled mode HTTP smoke tests passed successfully.");
}

runSmokeTests().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Smoke test failed: ${message}`);
  process.exit(1);
});
