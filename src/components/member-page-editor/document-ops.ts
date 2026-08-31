import type {
  MemberBlock,
  MemberBlockRow,
  MemberBlockRowRatio,
  MemberPageDocumentV2,
  MemberPageEntry,
} from "@/lib/members/v2/document";
import { analyzeMemberPageEntries } from "@/lib/members/v2/member-page-entries";
import {
  MAX_BLOCKS,
  MAX_FEATURED_PROJECT_BLOCKS,
} from "@/lib/members/v2/limits";

import { withNewBlockIds, withNewRowIds, type MemberEditorIdGenerator } from "./ids";

/**
 * Pure document operations for the owner editor.
 *
 * Every function returns a new complete `MemberPageDocumentV2`. Nothing here
 * mutates its input, reads a global, touches the network, or invents a
 * draft-only block shape: the value produced is exactly what autosave sends to
 * the server validator.
 */

export type BlockOperationResult =
  | { status: "ok"; document: MemberPageDocumentV2; announcement: string }
  | { status: "rejected"; reason: BlockOperationRejection; message: string };

export type BlockOperationRejection =
  | "max-blocks"
  | "featured-project-limit"
  | "unknown-block"
  | "at-edge"
  | "not-pairable";

export const BLOCK_TYPE_LABELS: Record<MemberBlock["type"], string> = {
  richText: "Rich text",
  featuredProject: "Featured project",
  projectList: "Project list",
  additionalLinks: "Additional links",
  image: "Image",
  gallery: "Gallery",
  calloutQuote: "Callout or quote",
  embed: "Embed",
};

const ROW_LABEL = "Two-block row";

export function blockTypeLabel(type: MemberBlock["type"]): string {
  return BLOCK_TYPE_LABELS[type];
}

function entryLabel(entry: MemberPageEntry): string {
  return entry.type === "row" ? ROW_LABEL : BLOCK_TYPE_LABELS[entry.type];
}

function countFeaturedProjectBlocksIn(
  entries: readonly MemberPageEntry[],
): number {
  return analyzeMemberPageEntries(entries).featuredProjectCount;
}

export function countFeaturedProjectBlocks(
  document: MemberPageDocumentV2,
): number {
  return countFeaturedProjectBlocksIn(document.blocks);
}

function leafCountOf(document: MemberPageDocumentV2): number {
  return analyzeMemberPageEntries(document.blocks).leafCount;
}

function hasRoomForLeaves(
  document: MemberPageDocumentV2,
  leaves: number,
): boolean {
  return leafCountOf(document) + leaves <= MAX_BLOCKS;
}

export function canAddBlock(document: MemberPageDocumentV2): boolean {
  return hasRoomForLeaves(document, 1);
}

export function canAddFeaturedProject(
  document: MemberPageDocumentV2,
): boolean {
  return (
    canAddBlock(document) &&
    countFeaturedProjectBlocks(document) < MAX_FEATURED_PROJECT_BLOCKS
  );
}

function positionAnnouncement(
  label: string,
  index: number,
  total: number,
): string {
  return `Moved ${label} to position ${index + 1} of ${total}.`;
}

function limitRejection(
  reason: Extract<BlockOperationRejection, "max-blocks" | "featured-project-limit">,
): BlockOperationResult {
  return {
    status: "rejected",
    reason,
    message:
      reason === "max-blocks"
        ? `A page holds at most ${MAX_BLOCKS} blocks. Delete one to add another.`
        : "A page holds one featured project. Delete the current one first.",
  };
}

type EntryLocation =
  | { kind: "leaf"; index: number; entry: MemberBlock }
  | { kind: "row"; index: number; entry: MemberBlockRow; childIndex: 0 | 1 };

function locateEntry(
  document: MemberPageDocumentV2,
  blockId: string,
): EntryLocation | null {
  const analysis = analyzeMemberPageEntries(document.blocks);
  const entryDescriptor = analysis.entryDescriptorFor(blockId);
  const leafDescriptor = analysis.leafDescriptorFor(blockId);
  if (!entryDescriptor || !leafDescriptor) return null;
  if (entryDescriptor.entry.type === "row") {
    if (leafDescriptor.childIndex === null) return null;
    return {
      kind: "row",
      index: entryDescriptor.index,
      entry: entryDescriptor.entry,
      childIndex: leafDescriptor.childIndex,
    };
  }
  return {
    kind: "leaf",
    index: entryDescriptor.index,
    entry: entryDescriptor.entry,
  };
}

function rejectIfFeaturedOverflow(
  document: MemberPageDocumentV2,
  blocks: readonly MemberBlock[],
): BlockOperationResult | null {
  const addsFeatured = blocks.some((block) => block.type === "featuredProject");
  if (
    addsFeatured &&
    countFeaturedProjectBlocksIn(document.blocks) >= MAX_FEATURED_PROJECT_BLOCKS
  ) {
    return limitRejection("featured-project-limit");
  }
  return null;
}

/**
 * Appends a fully-formed block.
 *
 * Callers pass a block that already satisfies its own required content; the
 * add flow keeps partial creation state in the client until then, so an
 * invalid placeholder never reaches the draft.
 */
export function addBlock(
  document: MemberPageDocumentV2,
  block: MemberBlock,
  options: { index?: number } = {},
): BlockOperationResult {
  if (!canAddBlock(document)) return limitRejection("max-blocks");
  if (block.type === "featuredProject" && !canAddFeaturedProject(document)) {
    return limitRejection("featured-project-limit");
  }

  const blocks = [...document.blocks];
  const index = clampIndex(options.index ?? blocks.length, blocks.length);
  blocks.splice(index, 0, block);

  return {
    status: "ok",
    document: { ...document, blocks },
    announcement: `Added ${blockTypeLabel(block.type)} at position ${
      index + 1
    } of ${blocks.length}.`,
  };
}

export function duplicateBlock(
  document: MemberPageDocumentV2,
  blockId: string,
  nextId: MemberEditorIdGenerator,
): BlockOperationResult & { duplicatedId?: string } {
  const location = locateEntry(document, blockId);
  if (!location) return unknownBlock();

  if (location.kind === "row") {
    const { entry, index, childIndex } = location;
    if (!hasRoomForLeaves(document, 2)) return limitRejection("max-blocks");
    const featuredRejection = rejectIfFeaturedOverflow(document, entry.blocks);
    if (featuredRejection) return featuredRejection;

    const copy = withNewRowIds(entry, nextId);
    const blocks = [...document.blocks];
    blocks.splice(index + 1, 0, copy);

    return {
      status: "ok",
      document: { ...document, blocks },
      duplicatedId: copy.blocks[childIndex].id,
      announcement: `Duplicated ${ROW_LABEL} to position ${
        index + 2
      } of ${blocks.length}.`,
    };
  }

  const entry = location.entry;
  const index = location.index;
  if (!canAddBlock(document)) return limitRejection("max-blocks");
  if (entry.type === "featuredProject" && !canAddFeaturedProject(document)) {
    return limitRejection("featured-project-limit");
  }

  const copy = withNewBlockIds(entry, nextId);
  const blocks = [...document.blocks];
  blocks.splice(index + 1, 0, copy);

  return {
    status: "ok",
    document: { ...document, blocks },
    duplicatedId: copy.id,
    announcement: `Duplicated ${blockTypeLabel(entry.type)} to position ${
      index + 2
    } of ${blocks.length}.`,
  };
}

export function deleteBlock(
  document: MemberPageDocumentV2,
  blockId: string,
): BlockOperationResult & { removed?: { block: MemberBlock; index: number } } {
  const location = locateEntry(document, blockId);
  if (!location) return unknownBlock();

  if (location.kind === "row") {
    const { entry, index, childIndex } = location;
    const deleted = entry.blocks[childIndex];
    const survivor = entry.blocks[childIndex === 0 ? 1 : 0];
    const blocks = [...document.blocks];
    blocks.splice(index, 1, survivor);

    return {
      status: "ok",
      document: { ...document, blocks },
      removed: { block: deleted, index },
      announcement: `Deleted ${blockTypeLabel(deleted.type)}. Undo is available.`,
    };
  }

  const removed = location.entry;
  const index = location.index;
  const blocks = document.blocks.filter((_, entryIndex) => entryIndex !== index);

  return {
    status: "ok",
    document: { ...document, blocks },
    removed: { block: removed, index },
    announcement: `Deleted ${blockTypeLabel(removed.type)}. Undo is available.`,
  };
}

/**
 * Restores a deleted block at its original entry index for the Undo control.
 *
 * Undo is subject to the same limits as adding. Deleting a featured project
 * and then adding a different one leaves no room to undo, and putting the old
 * one back anyway would build a document the server refuses. The rejection is
 * surfaced instead, so nothing invalid reaches autosave.
 */
export function restoreBlock(
  document: MemberPageDocumentV2,
  block: MemberBlock,
  index: number,
): BlockOperationResult {
  if (!canAddBlock(document)) return limitRejection("max-blocks");
  if (block.type === "featuredProject" && !canAddFeaturedProject(document)) {
    return limitRejection("featured-project-limit");
  }

  const blocks = [...document.blocks];
  blocks.splice(clampIndex(index, blocks.length), 0, block);

  return {
    status: "ok",
    document: { ...document, blocks },
    announcement: `Restored ${blockTypeLabel(block.type)}.`,
  };
}

export function pairBlocks(
  document: MemberPageDocumentV2,
  blockId: string,
  side: "previous" | "next",
  ratio: MemberBlockRowRatio = "1:1",
): BlockOperationResult & { pairedRow?: { leftId: string; rightId: string } } {
  const location = locateEntry(document, blockId);
  if (!location) return unknownBlock();

  if (location.kind !== "leaf") {
    return {
      status: "rejected",
      reason: "not-pairable",
      message: "Split this row before pairing one of its blocks.",
    };
  }

  const leafEntry = location.entry;
  const neighbourIndex = side === "previous" ? location.index - 1 : location.index + 1;
  const neighbour = document.blocks[neighbourIndex];
  if (!neighbour) {
    return {
      status: "rejected",
      reason: "at-edge",
      message:
        side === "previous"
          ? "There is no block above to pair with."
          : "There is no block below to pair with.",
    };
  }
  if (neighbour.type === "row") {
    return {
      status: "rejected",
      reason: "not-pairable",
      message: "Split that row before pairing with one of its blocks.",
    };
  }

  const left = side === "previous" ? neighbour : leafEntry;
  const right = side === "previous" ? leafEntry : neighbour;
  const row: MemberBlockRow = { type: "row", ratio, blocks: [left, right] };

  const blocks = [...document.blocks];
  const start = Math.min(location.index, neighbourIndex);
  blocks.splice(start, 2, row);

  return {
    status: "ok",
    document: { ...document, blocks },
    pairedRow: { leftId: left.id, rightId: right.id },
    announcement: `Paired ${blockTypeLabel(left.type)} and ${blockTypeLabel(right.type)}.`,
  };
}

export function splitRow(
  document: MemberPageDocumentV2,
  blockId: string,
): BlockOperationResult & { split?: { leftId: string; rightId: string } } {
  const location = locateEntry(document, blockId);
  if (!location) return unknownBlock();
  if (location.kind !== "row") {
    return {
      status: "rejected",
      reason: "not-pairable",
      message: "Only a paired row can be split.",
    };
  }

  const [left, right] = location.entry.blocks;
  const blocks = [...document.blocks];
  blocks.splice(location.index, 1, left, right);

  return {
    status: "ok",
    document: { ...document, blocks },
    split: { leftId: left.id, rightId: right.id },
    announcement: `Split ${ROW_LABEL} into two blocks.`,
  };
}

export function swapRowSides(
  document: MemberPageDocumentV2,
  blockId: string,
): BlockOperationResult {
  const location = locateEntry(document, blockId);
  if (!location) return unknownBlock();
  if (location.kind !== "row") {
    return {
      status: "rejected",
      reason: "not-pairable",
      message: "Only a paired row can swap its sides.",
    };
  }

  const [left, right] = location.entry.blocks;
  const row: MemberBlockRow = {
    ...location.entry,
    blocks: [right, left],
  };
  const blocks = [...document.blocks];
  blocks.splice(location.index, 1, row);

  return {
    status: "ok",
    document: { ...document, blocks },
    announcement: `Swapped the two sides of the ${ROW_LABEL.toLowerCase()}.`,
  };
}

export function setRowRatio(
  document: MemberPageDocumentV2,
  blockId: string,
  ratio: MemberBlockRowRatio,
): BlockOperationResult {
  const location = locateEntry(document, blockId);
  if (!location) return unknownBlock();
  if (location.kind !== "row") {
    return {
      status: "rejected",
      reason: "not-pairable",
      message: "Only a paired row has a width ratio.",
    };
  }

  const row: MemberBlockRow = { ...location.entry, ratio };
  const blocks = [...document.blocks];
  blocks.splice(location.index, 1, row);

  return {
    status: "ok",
    document: { ...document, blocks },
    announcement: `Set the ${ROW_LABEL.toLowerCase()} width to ${ratio}.`,
  };
}

export function moveBlock(
  document: MemberPageDocumentV2,
  blockId: string,
  direction: "up" | "down",
): BlockOperationResult {
  const location = locateEntry(document, blockId);
  if (!location) return unknownBlock();

  const target = direction === "up" ? location.index - 1 : location.index + 1;
  if (target < 0 || target >= document.blocks.length) {
    return {
      status: "rejected",
      reason: "at-edge",
      message:
        direction === "up"
          ? "This block is already first."
          : "This block is already last.",
    };
  }

  const blocks = [...document.blocks];
  const [moved] = blocks.splice(location.index, 1);
  blocks.splice(target, 0, moved);

  return {
    status: "ok",
    document: { ...document, blocks },
    announcement: positionAnnouncement(
      entryLabel(moved),
      target,
      blocks.length,
    ),
  };
}

/**
 * Moves a block to an absolute position in the same flat array used by public
 * rendering. Sortable pointer and keyboard interactions use this operation,
 * while the explicit controls above keep using one-step movement. Both paths
 * therefore produce the same stored order and the same position announcement.
 */
export function moveBlockToIndex(
  document: MemberPageDocumentV2,
  blockId: string,
  targetIndex: number,
): BlockOperationResult {
  const location = locateEntry(document, blockId);
  if (!location) return unknownBlock();

  const lastIndex = document.blocks.length - 1;
  const target = Number.isInteger(targetIndex)
    ? Math.max(0, Math.min(targetIndex, lastIndex))
    : location.index;
  const moved = document.blocks[location.index];

  if (target === location.index) {
    return {
      status: "ok",
      document,
      announcement: positionAnnouncement(
        entryLabel(moved),
        location.index,
        document.blocks.length,
      ),
    };
  }

  const blocks = [...document.blocks];
  blocks.splice(location.index, 1);
  blocks.splice(target, 0, moved);

  return {
    status: "ok",
    document: { ...document, blocks },
    announcement: positionAnnouncement(
      entryLabel(moved),
      target,
      blocks.length,
    ),
  };
}

export function replaceBlock(
  document: MemberPageDocumentV2,
  block: MemberBlock,
): MemberPageDocumentV2 {
  return {
    ...document,
    blocks: document.blocks.map((existing) => {
      if (existing.type !== "row") {
        return existing.id === block.id ? block : existing;
      }
      if (existing.blocks[0].id === block.id) {
        return { ...existing, blocks: [block, existing.blocks[1]] };
      }
      if (existing.blocks[1].id === block.id) {
        return { ...existing, blocks: [existing.blocks[0], block] };
      }
      return existing;
    }),
  };
}

export function updateFrame(
  document: MemberPageDocumentV2,
  patch: Partial<MemberPageDocumentV2["frame"]>,
): MemberPageDocumentV2 {
  return { ...document, frame: { ...document.frame, ...patch } };
}

export function canMoveBlock(
  document: MemberPageDocumentV2,
  blockId: string,
  direction: "up" | "down",
): boolean {
  const location = locateEntry(document, blockId);
  if (!location) return false;
  return direction === "up"
    ? location.index > 0
    : location.index < document.blocks.length - 1;
}

function clampIndex(index: number, length: number): number {
  if (!Number.isInteger(index) || index < 0) return 0;
  return Math.min(index, length);
}

function unknownBlock(): BlockOperationResult {
  return {
    status: "rejected",
    reason: "unknown-block",
    message: "That block is no longer on the page.",
  };
}
