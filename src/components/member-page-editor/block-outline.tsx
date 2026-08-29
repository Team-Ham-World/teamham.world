"use client";

import type { MemberBlock, MemberPageDocumentV2 } from "@/lib/members/v2/document";
import { analyzeMemberPageEntries } from "@/lib/members/v2/member-page-entries";
import { MAX_BLOCKS } from "@/lib/members/v2/limits";

import { blockTypeLabel } from "./document-ops";
import { EDITOR_PRIMARY_CONTROL } from "./editor-controls";
import { BlockTypeIcon, GripIcon, PersonIcon, PlusIcon } from "./editor-icons";
import { MEMBER_ROW_ENTRY_LABEL } from "./editor-canvas";

const ROW =
  "flex w-full min-h-11 min-w-0 items-center gap-3 border-l-4 py-2 pr-3 pl-3 text-left transition-[background-color,border-color] focus-visible:outline-3 focus-visible:-outline-offset-2 focus-visible:outline-interactive-blue hover:bg-paper motion-reduce:transition-none";

const ROW_CHILD = `${ROW} pl-10`;

function selectedRow(selected: boolean, invalid: boolean): string {
  if (selected) return "border-l-interactive-blue bg-paper";
  if (invalid) return "border-l-decorative-red";
  return "border-l-transparent";
}

/** First words of a block, so two blocks of one type stay distinguishable. */
export function blockOutlineSummary(block: MemberBlock): string {
  switch (block.type) {
    case "richText":
      return firstText(block.content) ?? "Empty";
    case "featuredProject":
      return block.project.kind === "ham"
        ? block.project.projectSlug
        : block.project.name;
    case "projectList":
      return `${block.projects.length} project${block.projects.length === 1 ? "" : "s"}`;
    case "additionalLinks":
      return block.links.map((link) => link.label).join(", ");
    case "image":
      return block.caption ?? block.image.alt ?? "Image";
    case "gallery":
      return `${block.items.length} images`;
    case "calloutQuote":
      return block.text;
  }
}

function firstText(node: unknown): string | null {
  if (!node || typeof node !== "object") return null;
  const candidate = node as { text?: unknown; content?: unknown };
  if (typeof candidate.text === "string" && candidate.text.trim() !== "") {
    return candidate.text;
  }
  if (!Array.isArray(candidate.content)) return null;
  for (const child of candidate.content) {
    const found = firstText(child);
    if (found) return found;
  }
  return null;
}

function BlockOutlineButton({
  block,
  position,
  selected,
  invalid,
  className,
  onSelectBlock,
}: {
  block: MemberBlock;
  position: number;
  selected: boolean;
  invalid: boolean;
  className?: string;
  onSelectBlock: (blockId: string, invoker: HTMLButtonElement) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-current={selected ? "true" : undefined}
      className={`${className ?? ROW} ${selectedRow(selected, invalid)}`}
      onClick={(event) => onSelectBlock(block.id, event.currentTarget)}
    >
      <span
        aria-hidden="true"
        className="w-4 shrink-0 text-right text-xs font-bold text-muted tabular-nums"
      >
        {position}
      </span>
      <BlockTypeIcon type={block.type} className="size-4 shrink-0 text-muted" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold">
          {blockTypeLabel(block.type)}
        </span>
        <span className="block truncate text-xs text-muted">
          {blockOutlineSummary(block)}
        </span>
      </span>
      {invalid ? <RowFlag /> : null}
    </button>
  );
}

export function BlockOutline({
  document,
  selection,
  invalidBlockIds,
  frameInvalid,
  canAddBlock,
  onSelectFrame,
  onSelectBlock,
  onAddBlock,
}: {
  document: MemberPageDocumentV2;
  selection: { kind: "frame" } | { kind: "block"; blockId: string } | null;
  invalidBlockIds: ReadonlySet<string>;
  frameInvalid: boolean;
  canAddBlock: boolean;
  onSelectFrame: (invoker: HTMLButtonElement) => void;
  onSelectBlock: (blockId: string, invoker: HTMLButtonElement) => void;
  onAddBlock: (invoker: HTMLButtonElement) => void;
}) {
  const frameSelected = selection?.kind === "frame";
  const analysis = analyzeMemberPageEntries(document.blocks);
  const selectedBlockId =
    selection?.kind === "block" ? selection.blockId : null;

  return (
    <div className="flex min-h-0 min-w-0 flex-col" data-editor-outline="true">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <ol className="min-w-0">
          <li>
            <button
              type="button"
              aria-pressed={frameSelected}
              aria-current={frameSelected ? "true" : undefined}
              className={`${ROW} ${selectedRow(frameSelected, frameInvalid)}`}
              onClick={(event) => onSelectFrame(event.currentTarget)}
            >
              <PersonIcon className="size-4 shrink-0 text-muted" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold">
                  Profile header
                </span>
                <span className="block truncate text-xs text-muted">
                  {document.frame.displayName}
                </span>
              </span>
              {frameInvalid ? <RowFlag /> : null}
            </button>
          </li>

          {analysis.entries.map((descriptor) => {
            const position = descriptor.index + 1;
            const entry = descriptor.entry;
            if (entry.type !== "row") {
              return (
                <li key={descriptor.key}>
                  <BlockOutlineButton
                    block={entry}
                    position={position}
                    selected={selectedBlockId === entry.id}
                    invalid={invalidBlockIds.has(entry.id)}
                    onSelectBlock={onSelectBlock}
                  />
                </li>
              );
            }

            return (
              <li key={descriptor.key}>
                <div
                  className="flex min-h-11 min-w-0 items-center gap-3 py-2 pr-3 pl-3"
                  aria-hidden="true"
                >
                  <span className="w-4 shrink-0 text-right text-xs font-bold text-muted tabular-nums">
                    {position}
                  </span>
                  <GripIcon className="size-4 shrink-0 text-muted" />
                  <span className="min-w-0 flex-1 truncate text-sm font-bold">
                    {MEMBER_ROW_ENTRY_LABEL}
                  </span>
                </div>
                <ul>
                  {entry.blocks.map((child) => (
                    <li key={child.id}>
                      <BlockOutlineButton
                        block={child}
                        position={position}
                        selected={selectedBlockId === child.id}
                        invalid={invalidBlockIds.has(child.id)}
                        className={ROW_CHILD}
                        onSelectBlock={onSelectBlock}
                      />
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ol>

        {document.blocks.length === 0 ? (
          <p className="m-3 border-2 border-dashed border-muted p-4 text-sm leading-relaxed text-muted">
            No blocks yet. Add one and it appears on the page straight away.
          </p>
        ) : null}
      </div>

      <div className="border-t-2 border-ink p-3">
        <button
          type="button"
          disabled={!canAddBlock}
          className={`${EDITOR_PRIMARY_CONTROL} w-full`}
          onClick={(event) => onAddBlock(event.currentTarget)}
        >
          <PlusIcon />
          Add a block
        </button>
        <p className="mt-2 text-xs text-muted">
          {analysis.leafCount} of {MAX_BLOCKS} blocks used
        </p>
      </div>
    </div>
  );
}

function RowFlag() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 border border-decorative-red px-1.5 py-0.5 text-[0.6rem] font-bold tracking-[0.1em] text-ink uppercase">
      <span aria-hidden="true">&#9888;</span>
      Fix
    </span>
  );
}
