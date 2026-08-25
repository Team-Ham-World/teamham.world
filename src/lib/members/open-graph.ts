import "server-only";

import { lookup } from "node:dns/promises";
import type { IncomingMessage } from "node:http";
import { request } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";

const FETCH_DEADLINE_MS = 4_000;
const MAX_HTML_BYTES = 256 * 1024;
const MAX_REDIRECTS = 3;

const blockedAddresses = new BlockList();

for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedAddresses.addSubnet(network, prefix, "ipv4");
}

for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["100::", 64],
  ["2001:2::", 48],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blockedAddresses.addSubnet(network, prefix, "ipv6");
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 6 && address.toLowerCase().startsWith("::ffff:")) return false;
  return family !== 0 && !blockedAddresses.check(
    address,
    family === 4 ? "ipv4" : "ipv6",
  );
}

function decodeHtmlEntities(value: string): string {
  return value.replace(
    /&(?:#(\d+)|#x([\da-f]+)|(amp|apos|gt|lt|quot));/gi,
    (entity, decimal: string | undefined, hexadecimal: string | undefined, named: string | undefined) => {
      if (decimal || hexadecimal) {
        const codePoint = Number.parseInt(decimal ?? hexadecimal ?? "", decimal ? 10 : 16);
        try {
          return String.fromCodePoint(codePoint);
        } catch {
          return entity;
        }
      }
      return {
        amp: "&",
        apos: "'",
        gt: ">",
        lt: "<",
        quot: '"',
      }[named?.toLowerCase() ?? ""] ?? entity;
    },
  );
}

function parseAttributes(tag: string): Map<string, string> {
  const attributes = new Map<string, string>();
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(tag))) {
    const name = match[1]?.toLowerCase();
    if (!name || name === "meta") continue;
    attributes.set(
      name,
      decodeHtmlEntities(match[2] ?? match[3] ?? match[4] ?? ""),
    );
  }

  return attributes;
}

function parseHttpsUrl(value: string, baseUrl?: string): URL | null {
  try {
    const url = baseUrl ? new URL(value, baseUrl) : new URL(value);
    if (
      url.protocol !== "https:" ||
      !url.hostname ||
      url.username ||
      url.password
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

export function extractOpenGraphImage(
  html: string,
  baseUrl: string,
): string | null {
  const metaPattern = /<meta\b[^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = metaPattern.exec(html))) {
    const attributes = parseAttributes(match[0]);
    const property = (attributes.get("property") ?? attributes.get("name"))
      ?.toLowerCase();
    if (
      property !== "og:image" &&
      property !== "og:image:url" &&
      property !== "og:image:secure_url"
    ) {
      continue;
    }

    const content = attributes.get("content");
    if (!content) continue;
    const imageUrl = parseHttpsUrl(content, baseUrl);
    if (imageUrl) return imageUrl.href;
  }

  return null;
}

function remainingTime(deadline: number): number {
  return Math.max(1, deadline - Date.now());
}

async function beforeDeadline<T>(
  operation: Promise<T>,
  deadline: number,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(
      () => reject(new Error("Open Graph request timed out")),
      remainingTime(deadline),
    );
  });

  try {
    return await Promise.race([operation, expired]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function isAllowedRemoteUrl(url: URL): boolean {
  const hostname = url.hostname.replace(/\.$/, "").toLowerCase();
  return (
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    (!url.port || url.port === "443") &&
    hostname !== "localhost" &&
    !hostname.endsWith(".localhost") &&
    !hostname.endsWith(".local") &&
    !hostname.endsWith(".internal") &&
    !hostname.endsWith(".lan")
  );
}

async function resolvePublicHost(url: URL, deadline: number) {
  if (!isAllowedRemoteUrl(url)) {
    throw new Error("Open Graph URL is not a public HTTPS destination");
  }

  const addresses = await beforeDeadline(
    lookup(url.hostname, { all: true, verbatim: true }),
    deadline,
  );
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error("Open Graph URL resolved to a non-public address");
  }
  return addresses[0];
}

async function requestPage(url: URL, deadline: number): Promise<IncomingMessage> {
  const address = await resolvePublicHost(url, deadline);
  const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [address]);
      return;
    }
    callback(null, address.address, address.family);
  };

  return beforeDeadline(new Promise<IncomingMessage>((resolve, reject) => {
    const requestHandle = request(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9",
        "Accept-Encoding": "identity",
        "User-Agent": "teamham.world-opengraph/1.0",
      },
      lookup: pinnedLookup,
      method: "GET",
      signal: AbortSignal.timeout(remainingTime(deadline)),
    }, resolve);
    requestHandle.once("error", reject);
    requestHandle.end();
  }), deadline);
}

async function readHtmlHead(response: IncomingMessage): Promise<string> {
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let html = "";

  for await (const chunk of response) {
    const bytes = chunk instanceof Uint8Array ? chunk : Buffer.from(chunk);
    const available = Math.min(bytes.length, MAX_HTML_BYTES - bytesRead);
    if (available > 0) {
      html += decoder.decode(bytes.subarray(0, available), { stream: true });
      bytesRead += available;
    }
    if (bytesRead >= MAX_HTML_BYTES || /<\/head\s*>/i.test(html)) {
      response.destroy();
      break;
    }
  }

  return html + decoder.decode();
}

async function fetchHtml(
  initialUrl: URL,
  deadline: number,
): Promise<{ html: string; pageUrl: string } | null> {
  let url = initialUrl;

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const response = await requestPage(url, deadline);
    const status = response.statusCode ?? 0;
    if ([301, 302, 303, 307, 308].includes(status)) {
      const location = response.headers.location;
      response.destroy();
      if (!location || redirects === MAX_REDIRECTS) return null;
      const redirectedUrl = parseHttpsUrl(location, url.href);
      if (!redirectedUrl) return null;
      url = redirectedUrl;
      continue;
    }

    const contentType = response.headers["content-type"]?.toLowerCase() ?? "";
    if (
      status !== 200 ||
      (contentType &&
        !contentType.startsWith("text/html") &&
        !contentType.startsWith("application/xhtml+xml"))
    ) {
      response.destroy();
      return null;
    }

    return { html: await readHtmlHead(response), pageUrl: url.href };
  }

  return null;
}

export async function findOpenGraphImage(
  projectUrl: string,
): Promise<string | null> {
  try {
    const url = parseHttpsUrl(projectUrl);
    if (!url) return null;
    const deadline = Date.now() + FETCH_DEADLINE_MS;
    const result = await fetchHtml(url, deadline);
    if (!result) return null;

    const image = extractOpenGraphImage(result.html, result.pageUrl);
    if (!image) return null;
    const imageUrl = new URL(image);
    await resolvePublicHost(imageUrl, deadline);
    return imageUrl.href;
  } catch {
    // Artwork discovery is optional and must never prevent a member-page save.
    return null;
  }
}
