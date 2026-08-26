import { X509Certificate } from "node:crypto";
import { copyFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createSelfSignedCertificate } from "next/dist/lib/mkcert.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const certificate = await createSelfSignedCertificate();

if (!certificate?.rootCA) {
  throw new Error("Next could not prepare a localhost certificate and root CA.");
}

const [leafBytes, rootBytes] = await Promise.all([
  readFile(certificate.cert),
  readFile(certificate.rootCA),
]);
const leaf = new X509Certificate(leafBytes);
const root = new X509Certificate(rootBytes);
if (leaf.issuer !== root.subject || !leaf.verify(root.publicKey)) {
  throw new Error(
    "certificates/localhost.pem is not signed by the active mkcert CA. Remove the stale ignored localhost certificate and key, then retry.",
  );
}

await copyFile(certificate.rootCA, path.join(repoRoot, "certificates/rootCA.pem"));
