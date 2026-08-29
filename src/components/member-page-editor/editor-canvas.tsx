"use client";

import type { ComponentType, ReactNode } from "react";

import type { AssetMetadata } from "@/components/member-page-v2";
import {
  composeMemberPageV2Layout,
  planMemberPageV2Entry,
  MemberPageV2EntryFrame,
  MemberPageV2Frame,
  type MemberPageV2Placement,
} from "@/components/member-page-v2";
import themeStyles from "@/components/member-page-v2/MemberPageV2View.module.css";
import { memberThemeStyle } from "@/components/member-page-v2/member-theme-presentation";
import type {
  MemberBlock,
  MemberPageDocumentV2,
} from "@/lib/members/v2/document";
import { analyzeMemberPageEntries } from "@/lib/members/v2/member-page-entries";
import type { ResolvedMemberThemeAccent } from "@/lib/members/v2/themes";

import { CanvasBlock } from "./canvas-block";
import canvasStyles from "./editor-canvas.module.css";
import { blockTypeLabel, canMoveBlock } from "./document-ops";
import { EDITOR_ICON_CONTROL, EDITOR_QUIET_CONTROL } from "./editor-controls";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BlockTypeIcon,
  DuplicateIcon,
  ExtractIcon,
  PersonIcon,
  TrashIcon,
} from "./editor-icons";

export const FRAME_SELECT_CONTROL_ID = "member-page-frame-select";

export const MEMBER_ROW_ENTRY_LABEL = "Two-block row";

export function blockSelectControlId(blockId: string): string {
  return `member-page-block-${blockId}-select`;
}

export function blockDragHandleId(dragId: string): string {
  return `member-page-block-${dragId}-drag-handle`;
}

export interface CanvasCallbacks {
  onSelectFrame: (invoker: HTMLButtonElement) => void;
  onSelectBlock: (blockId: string, invoker: HTMLButtonElement) => void;
  onDuplicate: (blockId: string) => void;
  onDelete: (blockId: string) => void;
  onMove: (blockId: string, direction: "up" | "down") => void;
  onTakeOutOfRow: (blockId: string) => void;
}

export interface CanvasBlockContainerProps {
  block: MemberBlock;
  /** The entry's descriptor key: the DnD identity this entry registers under. */
  entryKey: string;
  position: number;
  total: number;
  selected: boolean;
  invalid: boolean;
  interactive: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  callbacks: CanvasCallbacks;
  children: React.ReactNode;
}

export interface CanvasRowContainerProps {
  entryKey: string;
  representativeId: string;
  position: number;
  total: number;
  interactive: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  callbacks: CanvasCallbacks;
  children: React.ReactNode;
}

export interface EditorCanvasProps {
  document: MemberPageDocumentV2;
  theme: ResolvedMemberThemeAccent;
  assetMetadata: ReadonlyMap<string, AssetMetadata>;
  selection: { kind: "frame" } | { kind: "block"; blockId: string } | null;
  callbacks: CanvasCallbacks;
  interactive: boolean;
  frameInvalid?: boolean;
  invalidBlockIds?: ReadonlySet<string>;
  BlockContainer?: ComponentType<CanvasBlockContainerProps>;
  RowContainer?: ComponentType<CanvasRowContainerProps>;
}

/**
 * The live canvas uses the public components while editor-only chrome remains
 * outside them. A lazy sortable enhancement supplies different block and row
 * containers; the fallback keeps every explicit control usable without drag.
 */
export function EditorCanvas({
  document,
  theme,
  assetMetadata,
  selection,
  callbacks,
  interactive,
  frameInvalid = false,
  invalidBlockIds = new Set(),
  BlockContainer = StaticCanvasBlockContainer,
  RowContainer = StaticCanvasRowContainer,
}: EditorCanvasProps) {
  const frameSelected = selection?.kind === "frame";
  const { layout, headerSlotBlock } = composeMemberPageV2Layout(document);
  const analysis = analyzeMemberPageEntries(document.blocks);

  const profile = (
    <RegionWrapper
      label="Profile header"
      selected={frameSelected}
      invalid={frameInvalid}
      interactive={interactive}
      onSelect={callbacks.onSelectFrame}
    >
      <MemberPageV2Frame frame={document.frame} assetMetadata={assetMetadata} />
    </RegionWrapper>
  );

  return (
    <div
      data-member-theme-surface="true"
      data-theme-id={theme.themeId}
      data-accent-id={theme.accentId}
      data-member-layout={layout}
      className={`${themeStyles.themeSurface} min-w-0 max-w-full`}
      style={memberThemeStyle(theme)}
    >
      {/*
        * With a header slot block, the profile and the first block share the
        * top row and everything after it runs the full width underneath. The
        * block list stays a single list all the same — `lg:contents` hands its
        * items straight to this grid — so the document keeps one order, one
        * set of positions, and one place for drag-and-drop to measure.
        */}
      <div
        className={
          headerSlotBlock
            ? "lg:grid lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-start lg:gap-x-14"
            : undefined
        }
        data-profile-showcase={headerSlotBlock ? "true" : undefined}
      >
        {profile}
        {document.blocks.length === 0 ? (
          <p className="mt-16 border-2 border-dashed border-muted p-5 text-sm leading-relaxed text-muted">
            No blocks yet. Add one below and it appears here straight away.
          </p>
        ) : (
          <ol
            className={
              headerSlotBlock
                ? "min-w-0 lg:contents"
                : "mt-16 min-w-0 space-y-16"
            }
            data-editor-block-list="true"
          >
            {document.blocks.map((entry, index) => {
              const descriptor = analysis.entries[index];
              const position = index + 1;
              const total = document.blocks.length;
              const inHeaderSlot = headerSlotBlock !== null && index === 0;
              const itemClassName = inHeaderSlot
                ? // The slot carries the same `mt-16 lg:mt-0` top margin the
                  // public header-slot wrapper owns, matching it exactly.
                  "mt-16 min-w-0 lg:col-start-2 lg:row-start-1 lg:mt-0"
                : headerSlotBlock
                  ? "mt-16 min-w-0 lg:col-span-2"
                  : "min-w-0";

              if (entry.type === "row") {
                const plan = planMemberPageV2Entry(entry, assetMetadata);
                if (plan.kind === "omitted") return null;
                const representativeId =
                  plan.kind === "survivor"
                    ? plan.block.id
                    : entry.blocks[0].id;
                return (
                  <li
                    key={descriptor.key}
                    className={itemClassName}
                    data-sortable-block-id={descriptor.key}
                  >
                    <RowContainer
                      entryKey={descriptor.key}
                      representativeId={representativeId}
                      position={position}
                      total={total}
                      interactive={interactive}
                      canMoveUp={canMoveBlock(document, representativeId, "up")}
                      canMoveDown={canMoveBlock(
                        document,
                        representativeId,
                        "down",
                      )}
                      callbacks={callbacks}
                    >
                      {plan.kind === "survivor" ? (
                        <CanvasRowChild
                          block={plan.block}
                          assetMetadata={assetMetadata}
                          placement="full"
                          position={position}
                          total={total}
                          selected={
                            selection?.kind === "block" &&
                            selection.blockId === plan.block.id
                          }
                          invalid={invalidBlockIds.has(plan.block.id)}
                          interactive={interactive}
                          callbacks={callbacks}
                        />
                      ) : plan.kind === "row" ? (
                        <MemberPageV2EntryFrame
                          ratio={plan.ratio}
                          left={
                            <CanvasRowChild
                              block={plan.left.block}
                              assetMetadata={assetMetadata}
                              placement={plan.left.placement}
                              position={position}
                              total={total}
                              selected={
                                selection?.kind === "block" &&
                                selection.blockId === plan.left.block.id
                              }
                              invalid={invalidBlockIds.has(plan.left.block.id)}
                              interactive={interactive}
                              callbacks={callbacks}
                            />
                          }
                          right={
                            <CanvasRowChild
                              block={plan.right.block}
                              assetMetadata={assetMetadata}
                              placement={plan.right.placement}
                              position={position}
                              total={total}
                              selected={
                                selection?.kind === "block" &&
                                selection.blockId === plan.right.block.id
                              }
                              invalid={invalidBlockIds.has(
                                plan.right.block.id,
                              )}
                              interactive={interactive}
                              callbacks={callbacks}
                            />
                          }
                        />
                      ) : null}
                    </RowContainer>
                  </li>
                );
              }

              return (
                <li
                  key={descriptor.key}
                  className={itemClassName}
                  data-sortable-block-id={descriptor.key}
                >
                  <BlockContainer
                    block={entry}
                    entryKey={descriptor.key}
                    position={position}
                    total={total}
                    selected={
                      selection?.kind === "block" &&
                      selection.blockId === entry.id
                    }
                    invalid={invalidBlockIds.has(entry.id)}
                    interactive={interactive}
                    canMoveUp={canMoveBlock(document, entry.id, "up")}
                    canMoveDown={canMoveBlock(document, entry.id, "down")}
                    callbacks={callbacks}
                  >
                    <CanvasBlock
                      block={entry}
                      assetMetadata={assetMetadata}
                      featuredProjectLayout={
                        inHeaderSlot ? "showcase" : "standard"
                      }
                    />
                  </BlockContainer>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}

function CanvasRowChild({
  block,
  assetMetadata,
  placement,
  position,
  total,
  selected,
  invalid,
  interactive,
  callbacks,
}: {
  block: MemberBlock;
  assetMetadata: ReadonlyMap<string, AssetMetadata>;
  placement: MemberPageV2Placement;
  position: number;
  total: number;
  selected: boolean;
  invalid: boolean;
  interactive: boolean;
  callbacks: CanvasCallbacks;
}) {
  return (
    <CanvasBlockChrome
      block={block}
      position={position}
      total={total}
      selected={selected}
      invalid={invalid}
      interactive={interactive}
      callbacks={callbacks}
      mode="row-child"
    >
      <CanvasBlock
        block={block}
        assetMetadata={assetMetadata}
        featuredProjectLayout="standard"
        placement={placement}
      />
    </CanvasBlockChrome>
  );
}
/**
 * Shared chrome geometry for the two kinds of selectable canvas region.
 *
 * Editor affordances float above a region rather than stacking in front of
 * it, so the canvas reads as the member's page instead of as a list of
 * buttons. Which states reveal the strip — hover, focus, selection, and
 * invalidity — is stated once in `editor-canvas.module.css`.
 */
const REGION_TOOLBAR_INNER =
  "flex min-w-0 items-center gap-1 border border-ink/45 bg-surface p-1 shadow-[2px_2px_0_0_var(--color-ink)]";

/** Names the region in a word; the accessible name says what pressing it does. */
const REGION_LABEL_CONTROL = `${EDITOR_QUIET_CONTROL} min-w-0 shrink px-2`;

/**
 * Clicking the region's own artwork or prose selects it.
 *
 * The guard keeps the member's real links, fields, and buttons working: a
 * click that lands on anything interactive is left alone, and only clicks on
 * inert page content are treated as a selection.
 */
function selectOnInertClick(
  event: React.MouseEvent<HTMLElement>,
  select: () => void,
): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (
    target.closest(
      'a,button,input,select,textarea,label,summary,[contenteditable="true"]',
    )
  ) {
    return;
  }
  select();
}

function RegionWrapper({
  label,
  selected,
  invalid,
  interactive,
  onSelect,
  children,
}: {
  label: string;
  selected: boolean;
  invalid: boolean;
  interactive: boolean;
  onSelect: (invoker: HTMLButtonElement) => void;
  children: React.ReactNode;
}) {
  if (!interactive) return <div>{children}</div>;

  return (
    <section
      aria-label={label}
      data-selected={selected ? "true" : undefined}
      data-invalid={invalid ? "true" : undefined}
      data-canvas-region="frame"
      className={canvasStyles.region}
      onClick={(event) =>
        selectOnInertClick(event, () => {
          const control = window.document.getElementById(
            FRAME_SELECT_CONTROL_ID,
          );
          if (control instanceof HTMLButtonElement) onSelect(control);
        })
      }
    >
      <div className={canvasStyles.overlay}>
        <div className={canvasStyles.toolbar}>
          <div className={REGION_TOOLBAR_INNER}>
            <button
              id={FRAME_SELECT_CONTROL_ID}
              type="button"
              aria-pressed={selected}
              aria-label={
                selected ? "Editing profile header" : "Edit profile header"
              }
              className={REGION_LABEL_CONTROL}
              onClick={(event) => onSelect(event.currentTarget)}
            >
              <PersonIcon className="size-4 shrink-0" />
              <span className="truncate">Profile header</span>
            </button>
            {invalid ? <ErrorBadge /> : null}
          </div>
        </div>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export function StaticCanvasBlockContainer(props: CanvasBlockContainerProps) {
  if (!props.interactive) return <div>{props.children}</div>;
  return <CanvasBlockChrome {...props} />;
}

export function StaticCanvasRowContainer(props: CanvasRowContainerProps) {
  if (!props.interactive) return <div>{props.children}</div>;
  return <CanvasRowChrome {...props} />;
}

/** The left-edge strip avoids the children's right-aligned controls. */
export function CanvasRowChrome({
  entryKey,
  representativeId,
  position,
  total,
  canMoveUp,
  canMoveDown,
  callbacks,
  children,
  dragHandle,
  containerRef,
  containerStyle,
  dragging = false,
}: CanvasRowContainerProps & {
  dragHandle?: ReactNode;
  containerRef?: (node: HTMLElement | null) => void;
  containerStyle?: React.CSSProperties;
  dragging?: boolean;
}) {
  return (
    <section
      ref={containerRef}
      style={containerStyle}
      aria-label={`${MEMBER_ROW_ENTRY_LABEL}, position ${position} of ${total}`}
      data-block-row-key={entryKey}
      data-dragging={dragging ? "true" : undefined}
      data-canvas-region="row"
      className={canvasStyles.region}
    >
      <div className={canvasStyles.overlay}>
        <div
          className={canvasStyles.toolbar}
          style={{ justifyContent: "flex-start" }}
        >
          <div className={REGION_TOOLBAR_INNER}>
            {dragHandle}
            {total > 1 ? (
              <>
                <button
                  type="button"
                  className={EDITOR_ICON_CONTROL}
                  disabled={!canMoveUp}
                  aria-label={`Move ${MEMBER_ROW_ENTRY_LABEL} up`}
                  onClick={() => callbacks.onMove(representativeId, "up")}
                >
                  <ArrowUpIcon />
                  <span className="sr-only">Move up</span>
                </button>
                <button
                  type="button"
                  className={EDITOR_ICON_CONTROL}
                  disabled={!canMoveDown}
                  aria-label={`Move ${MEMBER_ROW_ENTRY_LABEL} down`}
                  onClick={() => callbacks.onMove(representativeId, "down")}
                >
                  <ArrowDownIcon />
                  <span className="sr-only">Move down</span>
                </button>
              </>
            ) : null}
            <button
              type="button"
              className={EDITOR_ICON_CONTROL}
              aria-label={`Duplicate ${MEMBER_ROW_ENTRY_LABEL}`}
              onClick={() => callbacks.onDuplicate(representativeId)}
            >
              <DuplicateIcon />
              <span className="sr-only">Duplicate</span>
            </button>
          </div>
        </div>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export function CanvasBlockChrome({
  block,
  position,
  total,
  selected,
  invalid,
  canMoveUp = false,
  canMoveDown = false,
  callbacks,
  children,
  mode = "standalone",
  dragHandle,
  containerRef,
  containerStyle,
  dragging = false,
}: Omit<
  CanvasBlockContainerProps,
  "canMoveUp" | "canMoveDown" | "entryKey"
> & {
  mode?: "standalone" | "row-child";
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  dragHandle?: React.ReactNode;
  containerRef?: (node: HTMLElement | null) => void;
  containerStyle?: React.CSSProperties;
  dragging?: boolean;
}) {
  const label = blockTypeLabel(block.type);

  return (
    <section
      ref={containerRef}
      style={containerStyle}
      aria-label={`${label}, position ${position} of ${total}`}
      data-block-id={block.id}
      data-selected={selected ? "true" : undefined}
      data-invalid={invalid ? "true" : undefined}
      data-dragging={dragging ? "true" : undefined}
      data-canvas-region="block"
      className={canvasStyles.region}
      onClick={(event) =>
        selectOnInertClick(event, () => {
          const control = window.document.getElementById(
            blockSelectControlId(block.id),
          );
          if (control instanceof HTMLButtonElement) {
            callbacks.onSelectBlock(block.id, control);
          }
        })
      }
    >
      <div className={canvasStyles.overlay}>
        <div className={canvasStyles.toolbar}>
          <div className={REGION_TOOLBAR_INNER}>
            <button
              id={blockSelectControlId(block.id)}
              type="button"
              aria-pressed={selected}
              aria-label={
                selected
                  ? `Editing ${label}, position ${position} of ${total}`
                  : `Edit ${label}, position ${position} of ${total}`
              }
              className={REGION_LABEL_CONTROL}
              onClick={(event) =>
                callbacks.onSelectBlock(block.id, event.currentTarget)
              }
            >
              <BlockTypeIcon type={block.type} className="size-4 shrink-0" />
              <span className="truncate">{label}</span>
            </button>
            {/*
              * Ordering controls appear only on a page that has an order. On a
              * single-block page they were three permanently dead buttons, and
              * they are what pushed the strip onto a second row.
              */}
            {mode === "standalone" && total > 1 ? (
              <>
                {dragHandle}
                <button
                  id={`member-page-block-${block.id}-move-up`}
                  type="button"
                  className={EDITOR_ICON_CONTROL}
                  disabled={!canMoveUp}
                  aria-label={`Move ${label} up`}
                  onClick={() => callbacks.onMove(block.id, "up")}
                >
                  <ArrowUpIcon />
                  <span className="sr-only">Move up</span>
                </button>
                <button
                  id={`member-page-block-${block.id}-move-down`}
                  type="button"
                  className={EDITOR_ICON_CONTROL}
                  disabled={!canMoveDown}
                  aria-label={`Move ${label} down`}
                  onClick={() => callbacks.onMove(block.id, "down")}
                >
                  <ArrowDownIcon />
                  <span className="sr-only">Move down</span>
                </button>
              </>
            ) : null}
            {mode === "standalone" ? (
              <button
                type="button"
                className={EDITOR_ICON_CONTROL}
                aria-label={`Duplicate ${label}`}
                onClick={() => callbacks.onDuplicate(block.id)}
              >
                <DuplicateIcon />
                <span className="sr-only">Duplicate</span>
              </button>
            ) : null}
            {mode === "row-child" ? (
              <button
                type="button"
                className={EDITOR_ICON_CONTROL}
                aria-label={`Take ${label} out of row`}
                onClick={() => callbacks.onTakeOutOfRow(block.id)}
              >
                <ExtractIcon />
                <span className="sr-only">Take out</span>
              </button>
            ) : null}
            <button
              type="button"
              className={EDITOR_ICON_CONTROL}
              aria-label={`Delete ${label}`}
              onClick={() => callbacks.onDelete(block.id)}
            >
              <TrashIcon />
              <span className="sr-only">Delete</span>
            </button>
            {invalid ? <ErrorBadge /> : null}
          </div>
        </div>
      </div>

      <div className="min-w-0">{children}</div>
    </section>
  );
}

function ErrorBadge() {
  return (
    <span className="inline-flex items-center gap-1 border-2 border-decorative-red bg-paper px-2 py-1 text-[0.65rem] font-bold tracking-[0.1em] text-ink uppercase">
      <span aria-hidden="true">&#9888;</span> Needs attention
    </span>
  );
}
