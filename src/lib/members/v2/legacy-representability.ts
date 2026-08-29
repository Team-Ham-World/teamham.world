import type { MemberPageEntry } from "@/lib/members/v2/document";
import { PAPER_DEFAULT_ACCENT_ID } from "@/lib/members/v2/themes";
import { parseMemberPageDocumentV2 } from "@/lib/members/v2/validation";

/**
 * Stable machine reasons why a stored V2 document cannot be represented by
 * the legacy editor. These literals are part of the server-side contract;
 * never surface them to owners and never encode stored content in them.
 */
export type LegacyRepresentabilityReason =
  | "portrait-present"
  | "theme-not-legacy-default"
  | "blocks-count"
  | "block-kind"
  | "block-variant"
  | "artwork-decorative";

export type LegacyRepresentabilityPath = readonly (string | number)[];

/**
 * Total assessment of whether a stored member-page value is exactly
 * representable by the legacy editor.
 *
 * - `legacy-representable`: a legacy save can rebuild this document without
 *   losing anything the legacy model carries.
 * - `not-legacy-representable`: the document parses as a valid V2 document
 *   but contains V2-only content that a legacy save would destroy. `reason`
 *   is a stable machine code and `path` locates the offending node.
 * - `not-a-member-page-document-v2`: the value does not parse as a canonical
 *   V2 document at all. Such values are not V2 documents, so legacy writes
 *     keep their existing fail-open behavior for them.
 */
export type LegacyRepresentabilityAssessment =
  | { readonly outcome: "legacy-representable" }
  | {
      readonly outcome: "not-legacy-representable";
      readonly reason: LegacyRepresentabilityReason;
      readonly path: LegacyRepresentabilityPath;
    }
  | { readonly outcome: "not-a-member-page-document-v2" };

const REPRESENTABLE: LegacyRepresentabilityAssessment = {
  outcome: "legacy-representable",
};

function unrepresentable(
  reason: LegacyRepresentabilityReason,
  path: LegacyRepresentabilityPath,
): LegacyRepresentabilityAssessment {
  return { outcome: "not-legacy-representable", reason, path };
}

/**
 * The legacy editor emits at most one block: a single `featuredProject` card
 * rebuilt from the showcase column. Its external projects may carry forward
 * one imported artwork reference, but only in the legacy shape: a complete
 * informative reference (`decorative: false`, which the canonical parser
 * pairs with non-null string alt text) whose asset ID and existing alt text
 * — custom accessibility content included — are carried through the legacy
 * bridge verbatim when the external project identity still matches.
 */
function assessBlock(
  block: MemberPageEntry,
): LegacyRepresentabilityAssessment {
  // Rows are V2-only layout the legacy editor cannot rebuild; the type check
  // below rejects them with the same stable machine reason as other
  // non-featured entries.
  if (block.type !== "featuredProject") {
    return unrepresentable("block-kind", ["blocks", 0, "type"]);
  }
  if (block.variant !== "card") {
    return unrepresentable("block-variant", ["blocks", 0, "variant"]);
  }
  if (
    block.project.kind === "external" &&
    block.project.artwork !== undefined &&
    block.project.artwork.decorative !== false
  ) {
    return unrepresentable("artwork-decorative", [
      "blocks",
      0,
      "project",
      "artwork",
      "decorative",
    ]);
  }
  return REPRESENTABLE;
}

/**
 * Decide whether a stored value is exactly representable by the legacy
 * editor model. Pure and total: any input receives an assessment.
 *
 * The input is parsed with the canonical V2 document parser first, so no
 * check ever depends on raw JSON key order, and every string has already
 * been NFC-normalized and trimmed. Field-length, platform, status, and URL
 * limits are enforced by that parser and match the legacy validator
 * (80/500/2048 characters, the same seven social platforms, and the same
 * six project statuses), so a parsed document needs no duplicate checks.
 */
export function assessLegacyRepresentability(
  value: unknown,
): LegacyRepresentabilityAssessment {
  const parsed = parseMemberPageDocumentV2(value);
  if (!parsed.success) {
    return { outcome: "not-a-member-page-document-v2" };
  }
  const doc = parsed.doc;

  if (doc.frame.portrait !== null) {
    return unrepresentable("portrait-present", ["frame", "portrait"]);
  }
  if (
    doc.frame.theme.id !== "paper" ||
    doc.frame.theme.accentId !== PAPER_DEFAULT_ACCENT_ID
  ) {
    return unrepresentable("theme-not-legacy-default", ["frame", "theme"]);
  }
  if (doc.blocks.length > 1) {
    return unrepresentable("blocks-count", ["blocks"]);
  }
  if (doc.blocks.length === 1) {
    const [onlyBlock] = doc.blocks;
    if (onlyBlock) {
      const blockAssessment = assessBlock(onlyBlock);
      if (blockAssessment.outcome !== "legacy-representable") {
        return blockAssessment;
      }
    }
  }
  return REPRESENTABLE;
}
