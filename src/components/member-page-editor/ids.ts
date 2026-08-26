import type { MemberBlock } from "@/lib/members/v2/document";

/**
 * Opaque stable ID source.
 *
 * The editor never derives an ID from member content, an index, or a counter
 * that could collide after a reload. Tests inject a deterministic generator
 * instead of patching a global, so no module-level mutable state exists here.
 */
export type MemberEditorIdGenerator = () => string;

export const createRandomIdGenerator = (): MemberEditorIdGenerator => () =>
  crypto.randomUUID();

/**
 * Copies a block with fresh IDs for the block and every nested entry.
 *
 * Asset references are reused deliberately: duplicating a block must not
 * duplicate a stored object or consume another slot in the ready-asset quota.
 */
export function withNewBlockIds(
  block: MemberBlock,
  nextId: MemberEditorIdGenerator,
): MemberBlock {
  switch (block.type) {
    case "richText":
      return { ...block, id: nextId(), content: structuredCloneDoc(block.content) };
    case "featuredProject":
      return { ...block, id: nextId(), project: { ...block.project } };
    case "projectList":
      return {
        ...block,
        id: nextId(),
        projects: block.projects.map((entry) => ({
          id: nextId(),
          project: { ...entry.project },
        })),
      };
    case "additionalLinks":
      return {
        ...block,
        id: nextId(),
        links: block.links.map((link) => ({ ...link, id: nextId() })),
      };
    case "image":
      return { ...block, id: nextId(), image: { ...block.image } };
    case "gallery":
      return {
        ...block,
        id: nextId(),
        items: block.items.map((item) => ({
          ...item,
          id: nextId(),
          image: { ...item.image },
        })),
      };
    case "calloutQuote":
      return { ...block, id: nextId() };
  }
}

function structuredCloneDoc<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
