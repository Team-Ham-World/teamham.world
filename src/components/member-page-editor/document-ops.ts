import type {
  MemberBlock,
  MemberPageDocumentV2,
} from "@/lib/members/v2/document";
import {
  MAX_BLOCKS,
  MAX_FEATURED_PROJECT_BLOCKS,
} from "@/lib/members/v2/limits";

import { withNewBlockIds, type MemberEditorIdGenerator } from "./ids";

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
  | "at-edge";

export const BLOCK_TYPE_LABELS: Record<MemberBlock["type"], string> = {
  richText: "Rich text",
  featuredProject: "Featured project",
  projectList: "Project list",
  additionalLinks: "Additional links",
  image: "Image",
  gallery: "Gallery",
  calloutQuote: "Callout or quote",
};

export function blockTypeLabel(type: MemberBlock["type"]): string {
  return BLOCK_TYPE_LABELS[type];
}

export function countFeaturedProjectBlocks(
  document: MemberPageDocumentV2,
): number {
  return document.blocks.filter((block) => block.type === "featuredProject")
    .length;
}

export function canAddBlock(document: MemberPageDocumentV2): boolean {
  return document.blocks.length < MAX_BLOCKS;
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
  const index = document.blocks.findIndex((block) => block.id === blockId);
  if (index === -1) return unknownBlock();

  const source = document.blocks[index];
  if (!canAddBlock(document)) return limitRejection("max-blocks");
  if (source.type === "featuredProject" && !canAddFeaturedProject(document)) {
    return limitRejection("featured-project-limit");
  }

  const copy = withNewBlockIds(source, nextId);
  const blocks = [...document.blocks];
  blocks.splice(index + 1, 0, copy);

  return {
    status: "ok",
    document: { ...document, blocks },
    duplicatedId: copy.id,
    announcement: `Duplicated ${blockTypeLabel(source.type)} to position ${
      index + 2
    } of ${blocks.length}.`,
  };
}

export function deleteBlock(
  document: MemberPageDocumentV2,
  blockId: string,
): BlockOperationResult & { removed?: { block: MemberBlock; index: number } } {
  const index = document.blocks.findIndex((block) => block.id === blockId);
  if (index === -1) return unknownBlock();

  const removed = document.blocks[index];
  const blocks = document.blocks.filter((block) => block.id !== blockId);

  return {
    status: "ok",
    document: { ...document, blocks },
    removed: { block: removed, index },
    announcement: `Deleted ${blockTypeLabel(removed.type)}. Undo is available.`,
  };
}

/**
 * Restores a deleted block at its original index for the Undo control.
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

export function moveBlock(
  document: MemberPageDocumentV2,
  blockId: string,
  direction: "up" | "down",
): BlockOperationResult {
  const index = document.blocks.findIndex((block) => block.id === blockId);
  if (index === -1) return unknownBlock();

  const target = direction === "up" ? index - 1 : index + 1;
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
  const [moved] = blocks.splice(index, 1);
  blocks.splice(target, 0, moved);

  return {
    status: "ok",
    document: { ...document, blocks },
    announcement: positionAnnouncement(
      blockTypeLabel(moved.type),
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
  const index = document.blocks.findIndex((block) => block.id === blockId);
  if (index === -1) return unknownBlock();

  const lastIndex = document.blocks.length - 1;
  const target = Number.isInteger(targetIndex)
    ? Math.max(0, Math.min(targetIndex, lastIndex))
    : index;
  const moved = document.blocks[index];

  if (target === index) {
    return {
      status: "ok",
      document,
      announcement: positionAnnouncement(
        blockTypeLabel(moved.type),
        index,
        document.blocks.length,
      ),
    };
  }

  const blocks = [...document.blocks];
  blocks.splice(index, 1);
  blocks.splice(target, 0, moved);

  return {
    status: "ok",
    document: { ...document, blocks },
    announcement: positionAnnouncement(
      blockTypeLabel(moved.type),
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
    blocks: document.blocks.map((existing) =>
      existing.id === block.id ? block : existing,
    ),
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
  const index = document.blocks.findIndex((block) => block.id === blockId);
  if (index === -1) return false;
  return direction === "up" ? index > 0 : index < document.blocks.length - 1;
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
