import type { MemberContentInput } from "@/lib/members/validation";
import type {
  MemberBlock,
  MemberImageRef,
  MemberPageDocumentV2,
  MemberProjectRef,
} from "@/lib/members/v2/document";
import { PAPER_DEFAULT_ACCENT_ID } from "@/lib/members/v2/themes";
import { parseMemberPageDocumentV2 } from "@/lib/members/v2/validation";

export interface LegacyToDocOptions {
  ids: () => string;
  /**
   * Import path: attach artwork to the external showcase by asset ID, with
   * alt text regenerated from the project name.
   */
  externalArtworkAssetId?: string;
  /**
   * Carry-forward path: keep a complete stored, non-decorative artwork
   * reference — asset ID, existing alt text, and `decorative: false` —
   * verbatim, so a legacy save never erases custom accessibility content.
   * Callers must already have matched the external project identity; the
   * bridge rejects decorative references because they are V2-only state the
   * legacy model cannot represent.
   */
  externalArtwork?: MemberImageRef;
}

function requireOpaqueId(value: string, name: string): string {
  const normalized = value.normalize("NFC").trim();
  if (!normalized) {
    throw new TypeError(`${name} must return a non-empty opaque ID.`);
  }
  return normalized;
}

function externalProjectArtwork(
  input: MemberContentInput,
  carriedArtwork: MemberImageRef | undefined,
  assetId: string | undefined,
): MemberImageRef | undefined {
  if (carriedArtwork !== undefined && assetId !== undefined) {
    throw new TypeError(
      "Supply externalArtwork or externalArtworkAssetId, never both.",
    );
  }
  if (carriedArtwork !== undefined) {
    if (input.showcase?.kind !== "external") {
      throw new TypeError(
        "externalArtwork may be supplied only for an external showcase.",
      );
    }
    if (
      carriedArtwork.decorative !== false ||
      typeof carriedArtwork.alt !== "string"
    ) {
      throw new TypeError(
        "externalArtwork must be a non-decorative reference with string alt text.",
      );
    }
    return carriedArtwork;
  }
  if (assetId === undefined) return undefined;
  if (input.showcase?.kind !== "external") {
    throw new TypeError(
      "externalArtworkAssetId may be supplied only for an external showcase.",
    );
  }
  return {
    assetId: requireOpaqueId(assetId, "externalArtworkAssetId"),
    alt: `${input.showcase.name} showcase artwork`,
    decorative: false,
  };
}

export function legacyToDoc(
  input: MemberContentInput,
  opts: LegacyToDocOptions,
): MemberPageDocumentV2 {
  const artwork = externalProjectArtwork(
    input,
    opts.externalArtwork,
    opts.externalArtworkAssetId,
  );
  let blocks: MemberBlock[] = [];

  if (input.showcase) {
    let project: MemberProjectRef;
    if (input.showcase.kind === "project") {
      project = { kind: "ham", projectSlug: input.showcase.projectSlug };
    } else {
      project = {
        kind: "external",
        name: input.showcase.name,
        shortDescription: input.showcase.shortDescription,
        type: input.showcase.type,
        status: input.showcase.status,
        ...(input.showcase.url ? { url: input.showcase.url } : {}),
        ...(input.showcase.repository
          ? { repository: input.showcase.repository }
          : {}),
        ...(artwork ? { artwork } : {}),
      };
    }

    blocks = [{
      id: requireOpaqueId(opts.ids(), "ids()"),
      type: "featuredProject",
      variant: "card",
      project,
    }];
  }

  const document: MemberPageDocumentV2 = {
    schemaVersion: 2,
    frame: {
      displayName: input.displayName,
      summary: input.blurb,
      websiteUrl: input.websiteUrl,
      socialLinks: { ...input.socialLinks },
      portrait: null,
      theme: { id: "paper", accentId: PAPER_DEFAULT_ACCENT_ID },
    },
    blocks,
  };

  // Bridge writes must meet the same deep, canonical contract as native V2
  // writes. Returning the parser's document also NFC-normalizes every authored
  // string before it can be persisted in draft_doc or published_doc.
  const parsed = parseMemberPageDocumentV2(document);
  if (!parsed.success) {
    throw new TypeError("Legacy member content could not produce a valid V2 document.");
  }
  return parsed.doc;
}
