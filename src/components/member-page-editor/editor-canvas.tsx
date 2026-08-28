"use client";

import type { ComponentType } from "react";

import type { AssetMetadata } from "@/components/member-page-v2";
import {
  composeMemberPageV2Layout,
  MemberPageV2Frame,
} from "@/components/member-page-v2";
import themeStyles from "@/components/member-page-v2/MemberPageV2View.module.css";
import { memberThemeStyle } from "@/components/member-page-v2/member-theme-presentation";
import type {
  MemberBlock,
  MemberPageDocumentV2,
} from "@/lib/members/v2/document";
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
  PersonIcon,
  TrashIcon,
} from "./editor-icons";

export const FRAME_SELECT_CONTROL_ID = "member-page-frame-select";

export function blockSelectControlId(blockId: string): string {
  return `member-page-block-${blockId}-select`;
}

export function blockDragHandleId(blockId: string): string {
  return `member-page-block-${blockId}-drag-handle`;
}

export interface CanvasCallbacks {
  onSelectFrame: (invoker: HTMLButtonElement) => void;
  onSelectBlock: (blockId: string, invoker: HTMLButtonElement) => void;
  onDuplicate: (blockId: string) => void;
  onDelete: (blockId: string) => void;
  onMove: (blockId: string, direction: "up" | "down") => void;
}

export interface CanvasBlockContainerProps {
  block: MemberBlock;
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
}

/**
 * The live canvas uses the public components while editor-only chrome remains
 * outside them. A lazy sortable enhancement supplies a different block
 * container; the fallback keeps every explicit control usable without drag.
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
}: EditorCanvasProps) {
  const frameSelected = selection?.kind === "frame";
  const { layout, showcaseProject } = composeMemberPageV2Layout(document);

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
        * With a showcase, the profile and the first block share the top row and
        * everything after it runs the full width underneath. The block list
        * stays a single list all the same — `lg:contents` hands its items
        * straight to this grid — so the document keeps one order, one set of
        * positions, and one place for drag-and-drop to measure.
        */}
      <div
        className={
          showcaseProject
            ? "lg:grid lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-start lg:gap-x-14"
            : undefined
        }
        data-profile-showcase={showcaseProject ? "true" : undefined}
      >
        {profile}
        {document.blocks.length === 0 ? (
          <p className="mt-16 border-2 border-dashed border-muted p-5 text-sm leading-relaxed text-muted">
            No blocks yet. Add one below and it appears here straight away.
          </p>
        ) : (
          <ol
            className={
              showcaseProject
                ? "min-w-0 lg:contents"
                : "mt-16 min-w-0 space-y-16"
            }
            data-editor-block-list="true"
          >
            {document.blocks.map((block, index) => {
              const showcased = showcaseProject !== null && index === 0;
              return (
                <li
                  key={block.id}
                  className={
                    showcased
                      ? // The showcase carries its own `mt-16 lg:mt-0`, matching
                        // the public page exactly.
                        "min-w-0 lg:col-start-2 lg:row-start-1"
                      : showcaseProject
                        ? "mt-16 min-w-0 lg:col-span-2"
                        : "min-w-0"
                  }
                  data-sortable-block-id={block.id}
                >
                  <BlockContainer
                    block={block}
                    position={index + 1}
                    total={document.blocks.length}
                    selected={
                      selection?.kind === "block" &&
                      selection.blockId === block.id
                    }
                    invalid={invalidBlockIds.has(block.id)}
                    interactive={interactive}
                    canMoveUp={canMoveBlock(document, block.id, "up")}
                    canMoveDown={canMoveBlock(document, block.id, "down")}
                    callbacks={callbacks}
                  >
                    <CanvasBlock
                      block={block}
                      assetMetadata={assetMetadata}
                      featuredProjectLayout={showcased ? "showcase" : "standard"}
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

/** Shared block chrome used by both the explicit fallback and dnd-kit item. */
export function CanvasBlockChrome({
  block,
  position,
  total,
  selected,
  invalid,
  canMoveUp,
  canMoveDown,
  callbacks,
  children,
  dragHandle,
  containerRef,
  containerStyle,
  dragging = false,
}: CanvasBlockContainerProps & {
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
            {total > 1 ? (
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
            <button
              type="button"
              className={EDITOR_ICON_CONTROL}
              aria-label={`Duplicate ${label}`}
              onClick={() => callbacks.onDuplicate(block.id)}
            >
              <DuplicateIcon />
              <span className="sr-only">Duplicate</span>
            </button>
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
