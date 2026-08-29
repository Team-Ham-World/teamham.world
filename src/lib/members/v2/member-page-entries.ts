import type {
  MemberBlock,
  MemberBlockRow,
  MemberBlockRowRatio,
  MemberPageEntry,
} from "@/lib/members/v2/document";

const ROW_CHILD_INDEXES = [0, 1] as const;

/**
 * Framework-neutral analysis of the member-page entry sequence.
 *
 * Documents store a flat list of entries, where each entry is either one leaf
 * block or a two-block row. Validated-document consumers (asset extraction,
 * editor operations, legacy guards) share this analysis boundary instead of
 * re-walking the row nesting themselves; the persistence validator counts
 * leaves on its own. Rows carry no ID; a globally unique leaf ID identifies
 * the containing entry, and composite keys are derived descriptors for
 * React/DnD only.
 */

export interface MemberPageEntryDescriptor {
  readonly index: number;
  readonly kind: "leaf" | "row";
  readonly entry: MemberPageEntry;
  /**
   * Collision-safe React/DnD key: `leaf:"id"` or `row:["leftId","rightId"]`.
   * Both sides are JSON-encoded and namespaced so a standalone ID can never
   * equal a row's composite form, even when IDs contain punctuation.
   */
  readonly key: string;
  readonly ratio: MemberBlockRowRatio | null;
  readonly leafIds: readonly string[];
}

export interface MemberPageLeafDescriptor {
  readonly id: string;
  readonly block: MemberBlock;
  readonly entryIndex: number;
  readonly childIndex: 0 | 1 | null;
  readonly rowKey: string | null;
  readonly ratio: MemberBlockRowRatio | null;
}

export interface MemberPageRowPlacement {
  readonly entryIndex: number;
  readonly key: string;
  readonly ratio: MemberBlockRowRatio;
  readonly childIndex: 0 | 1;
  readonly left: MemberBlock;
  readonly right: MemberBlock;
}

export interface MemberPageEntriesAnalysis {
  readonly entries: readonly MemberPageEntryDescriptor[];
  readonly leaves: readonly MemberPageLeafDescriptor[];
  readonly leafCount: number;
  readonly featuredProjectCount: number;
  entryDescriptorFor(leafId: string): MemberPageEntryDescriptor | null;
  leafDescriptorFor(leafId: string): MemberPageLeafDescriptor | null;
  rowPlacementFor(leafId: string): MemberPageRowPlacement | null;
}

export function rowEntryKey(row: MemberBlockRow): string {
  return `row:${JSON.stringify([row.blocks[0].id, row.blocks[1].id])}`;
}

export function analyzeMemberPageEntries(
  entries: readonly MemberPageEntry[],
): MemberPageEntriesAnalysis {
  const entryDescriptors: MemberPageEntryDescriptor[] = [];
  const leafDescriptors: MemberPageLeafDescriptor[] = [];
  const entryByLeafId = new Map<string, MemberPageEntryDescriptor>();
  const leafByLeafId = new Map<string, MemberPageLeafDescriptor>();
  const rowByLeafId = new Map<string, MemberPageRowPlacement>();
  let featuredProjectCount = 0;

  entries.forEach((entry, index) => {
    if (entry.type === "row") {
      const key = rowEntryKey(entry);
      const entryDescriptor: MemberPageEntryDescriptor = {
        index,
        kind: "row",
        entry,
        key,
        ratio: entry.ratio,
        leafIds: [entry.blocks[0].id, entry.blocks[1].id],
      };
      entryDescriptors.push(entryDescriptor);
      for (const childIndex of ROW_CHILD_INDEXES) {
        const block = entry.blocks[childIndex];
        const leafDescriptor: MemberPageLeafDescriptor = {
          id: block.id,
          block,
          entryIndex: index,
          childIndex,
          rowKey: key,
          ratio: entry.ratio,
        };
        leafDescriptors.push(leafDescriptor);
        leafByLeafId.set(block.id, leafDescriptor);
        entryByLeafId.set(block.id, entryDescriptor);
        rowByLeafId.set(block.id, {
          entryIndex: index,
          key,
          ratio: entry.ratio,
          childIndex,
          left: entry.blocks[0],
          right: entry.blocks[1],
        });
        if (block.type === "featuredProject") featuredProjectCount += 1;
      }
      return;
    }

    const entryDescriptor: MemberPageEntryDescriptor = {
      index,
      kind: "leaf",
      entry,
      key: `leaf:${JSON.stringify(entry.id)}`,
      ratio: null,
      leafIds: [entry.id],
    };
    const leafDescriptor: MemberPageLeafDescriptor = {
      id: entry.id,
      block: entry,
      entryIndex: index,
      childIndex: null,
      rowKey: null,
      ratio: null,
    };
    entryDescriptors.push(entryDescriptor);
    leafDescriptors.push(leafDescriptor);
    entryByLeafId.set(entry.id, entryDescriptor);
    leafByLeafId.set(entry.id, leafDescriptor);
    if (entry.type === "featuredProject") featuredProjectCount += 1;
  });

  return {
    entries: entryDescriptors,
    leaves: leafDescriptors,
    leafCount: leafDescriptors.length,
    featuredProjectCount,
    entryDescriptorFor: (leafId) => entryByLeafId.get(leafId) ?? null,
    leafDescriptorFor: (leafId) => leafByLeafId.get(leafId) ?? null,
    rowPlacementFor: (leafId) => rowByLeafId.get(leafId) ?? null,
  };
}
