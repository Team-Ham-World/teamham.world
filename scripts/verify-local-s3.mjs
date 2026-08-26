import { randomUUID } from "node:crypto";

import { AwsClient } from "aws4fetch";

const endpoint = "https://localhost:9000/teamham-member-assets-local";
const objectUrl = `${endpoint}/verification/${randomUUID()}.txt`;
const payload = new TextEncoder().encode("teamham local S3 verification");
const client = new AwsClient({
  accessKeyId: "teamhamlocalaccess",
  secretAccessKey: "teamham-local-secret-key-12345678901234567890",
  service: "s3",
  region: "us-east-1",
  retries: 0,
});

async function signedFetch(method, headers) {
  const request = await client.sign(objectUrl, {
    method,
    headers,
    redirect: "error",
    aws: { service: "s3", region: "us-east-1", allHeaders: true },
  });
  return fetch(request);
}

let uploaded = false;
try {
  const uploadUrl = new URL(objectUrl);
  uploadUrl.searchParams.set("X-Amz-Expires", "300");
  const signedUpload = await client.sign(uploadUrl, {
    method: "PUT",
    headers: {
      "content-length": String(payload.byteLength),
      "content-type": "text/plain",
    },
    aws: {
      service: "s3",
      region: "us-east-1",
      signQuery: true,
      allHeaders: true,
    },
  });
  const upload = await fetch(new Request(signedUpload, { body: payload }));
  if (!upload.ok) throw new Error(`Signed PUT failed with ${upload.status}.`);
  uploaded = true;

  const head = await signedFetch("HEAD");
  if (!head.ok || Number(head.headers.get("content-length")) !== payload.byteLength) {
    throw new Error(`Signed HEAD failed with ${head.status}.`);
  }

  const ranged = await signedFetch("GET", { range: "bytes=0-6" });
  if (ranged.status !== 206 || new TextDecoder().decode(await ranged.arrayBuffer()) !== "teamham") {
    throw new Error(`Signed range GET failed with ${ranged.status}.`);
  }

  const full = await signedFetch("GET");
  if (!full.ok || new TextDecoder().decode(await full.arrayBuffer()) !== "teamham local S3 verification") {
    throw new Error(`Signed full GET failed with ${full.status}.`);
  }

  const preflight = await fetch(objectUrl, {
    method: "OPTIONS",
    headers: {
      origin: "https://localhost:3000",
      "access-control-request-method": "PUT",
      "access-control-request-headers": "content-type",
    },
  });
  if (
    !preflight.ok ||
    preflight.headers.get("access-control-allow-origin") !==
      "https://localhost:3000"
  ) {
    throw new Error(`CORS preflight failed with ${preflight.status}.`);
  }

  const deleted = await signedFetch("DELETE");
  if (!deleted.ok) throw new Error(`Signed DELETE failed with ${deleted.status}.`);
  uploaded = false;

  const missing = await signedFetch("HEAD");
  if (missing.status !== 404) {
    throw new Error(`Deleted object HEAD returned ${missing.status}.`);
  }

  console.log("Local S3 verification succeeded (PUT, HEAD, range GET, GET, CORS, DELETE).");
} finally {
  if (uploaded) await signedFetch("DELETE").catch(() => undefined);
}
