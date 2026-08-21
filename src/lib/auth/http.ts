export const OAUTH_STATE_COOKIE_NAME = '__Host-oauth_state';
export const SESSION_COOKIE_NAME = '__Host-session';
export const GAME_AUTHORIZATION_COOKIE_NAME = '__Host-game_authz';

export function buildOAuthStateCookie(value: string): string {
  return `${OAUTH_STATE_COOKIE_NAME}=${value}; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax`;
}

export function buildClearOAuthStateCookie(): string {
  return `${OAUTH_STATE_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

export function buildSessionCookie(token: string): string {
  return `${SESSION_COOKIE_NAME}=${token}; Path=/; Max-Age=86400; HttpOnly; Secure; SameSite=Lax`;
}

export function buildClearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

export function buildGameAuthCookie(value: string): string {
  return `${GAME_AUTHORIZATION_COOKIE_NAME}=${value}; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax`;
}

export function buildClearGameAuthCookie(): string {
  return `${GAME_AUTHORIZATION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

export function getAllCookieValues(request: Request, cookieName: string): string[] {
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) {
    return [];
  }

  const cookies = cookieHeader.split(';');
  const values: string[] = [];
  for (const item of cookies) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const rawKey = trimmed.slice(0, eqIdx).trim();
    if (rawKey === cookieName) {
      values.push(trimmed.slice(eqIdx + 1));
    }
  }
  return values;
}

export type SingleCookieResult =
  | { status: 'found'; value: string }
  | { status: 'missing' }
  | { status: 'duplicate' };

export function getSingleCookieValue(request: Request, cookieName: string): SingleCookieResult {
  const values = getAllCookieValues(request, cookieName);
  if (values.length === 0) {
    return { status: 'missing' };
  }
  if (values.length > 1) {
    return { status: 'duplicate' };
  }
  return { status: 'found', value: values[0] };
}

export function getCookieValue(request: Request, cookieName: string): string | null {
  const res = getSingleCookieValue(request, cookieName);
  return res.status === 'found' ? res.value : null;
}

export function applyProtectedHeaders(headers: Headers): Headers {
  headers.set('Cache-Control', 'private, no-cache, no-store, max-age=0, must-revalidate');
  headers.set('Pragma', 'no-cache');
  headers.set('Referrer-Policy', 'no-referrer');

  const existingVary = headers.get('Vary');
  if (!existingVary) {
    headers.set('Vary', 'Cookie');
  } else {
    const parts = existingVary.split(',').map((p) => p.trim().toLowerCase());
    if (!parts.includes('cookie')) {
      headers.set('Vary', `${existingVary}, Cookie`);
    }
  }

  return headers;
}

export function applyOAuthJsonHeaders(headers: Headers): Headers {
  headers.set('Cache-Control', 'private, no-cache, no-store, max-age=0, must-revalidate');
  headers.set('Pragma', 'no-cache');
  headers.set('Referrer-Policy', 'no-referrer');

  const existingVary = headers.get('Vary');
  if (!existingVary) {
    headers.set('Vary', 'Authorization');
  } else {
    const parts = existingVary.split(',').map((p) => p.trim().toLowerCase());
    if (!parts.includes('authorization')) {
      headers.set('Vary', `${existingVary}, Authorization`);
    }
  }

  headers.set('Content-Type', 'application/json; charset=utf-8');
  return headers;
}

export function createOAuthJsonResponse(
  data: unknown,
  status = 200,
  extraHeaders?: HeadersInit
): Response {
  const headers = new Headers(extraHeaders);
  applyOAuthJsonHeaders(headers);
  return new Response(JSON.stringify(data), {
    status,
    headers,
  });
}

export function createOAuthErrorResponse(
  error: string,
  errorDescription?: string,
  status = 400,
  extraHeaders?: HeadersInit
): Response {
  const body: Record<string, string> = { error };
  if (errorDescription) {
    body.error_description = errorDescription;
  }
  return createOAuthJsonResponse(body, status, extraHeaders);
}

export function createAuthErrorResponse(
  status: number,
  title: string,
  message: string,
  extraHeaders?: HeadersInit
): Response {
  const headers = new Headers(extraHeaders);
  applyProtectedHeaders(headers);
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'none'; frame-ancestors 'none'"
  );

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>
body { font-family: system-ui, -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #0c0d0e; color: #f4f4f5; }
.card { max-width: 420px; padding: 2rem; border: 1px solid #27272a; border-radius: 8px; text-align: center; background: #18181b; }
h1 { font-size: 1.25rem; margin-top: 0; margin-bottom: 0.75rem; color: #fafafa; }
p { font-size: 0.875rem; color: #a1a1aa; margin-bottom: 1.5rem; line-height: 1.5; }
a { color: #38bdf8; text-decoration: none; font-size: 0.875rem; font-weight: 500; }
a:hover { text-decoration: underline; }
</style>
</head>
<body>
<div class="card">
<h1>${title}</h1>
<p>${message}</p>
<a href="/">Return to Home</a>
</div>
</body>
</html>`;

  return new Response(html, {
    status,
    headers,
  });
}

export function createDisabledModeNotFoundResponse(): Response {
  const headers = new Headers();
  applyProtectedHeaders(headers);
  headers.set('Content-Type', 'text/plain; charset=utf-8');

  return new Response('Not Found', {
    status: 404,
    headers,
  });
}

export function createMethodNotAllowedResponse(
  allowedMethods: string[],
  extraHeaders?: HeadersInit
): Response {
  const headers = new Headers(extraHeaders);
  applyProtectedHeaders(headers);
  headers.set('Allow', allowedMethods.join(', '));
  headers.set('Content-Type', 'text/plain; charset=utf-8');

  return new Response('Method Not Allowed', {
    status: 405,
    headers,
  });
}
