"use client";

import { useMemo, useRef, useSyncExternalStore } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragCancelEvent,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import type { MemberPageDocumentV2 } from "@/lib/members/v2/document";
import { analyzeMemberPageEntries } from "@/lib/members/v2/member-page-entries";

import { blockTypeLabel } from "./document-ops";
import {
  MEMBER_ROW_ENTRY_LABEL,
  blockDragHandleId,
  CanvasBlockChrome,
  CanvasRowChrome,
  EditorCanvas,
  type CanvasBlockContainerProps,
  type CanvasRowContainerProps,
  type EditorCanvasProps,
} from "./editor-canvas";
import { EDITOR_ICON_CONTROL } from "./editor-controls";
import { GripIcon } from "./editor-icons";

export { MEMBER_PAGE_DND_CONTEXT_ID } from "./dnd-config";
export const POINTER_ACTIVATION_DISTANCE = 8;
export const DND_INSTRUCTIONS_ID = "member-page-block-sort-instructions";
export const REDUCED_MOTION_MEDIA_QUERY = "(prefers-reduced-motion: reduce)";

const SILENT_DND_ANNOUNCEMENTS: Announcements = {
  onDragStart: () => undefined,
  onDragOver: () => undefined,
  onDragEnd: () => undefined,
  onDragCancel: () => undefined,
};

export interface SortableEditorCanvasProps
  extends Omit<EditorCanvasProps, "BlockContainer" | "RowContainer"> {
  dndContextId: string;
  onReorder: (blockId: string, targetIndex: number) => void;
  onAnnounce: (message: string) => void;
}

export interface ResolvedDragTarget {
  /** React/DnD identity of the entry: a leaf ID or the row's descriptor key. */
  key: string;
  /** The leaf ID the leaf-based mutation APIs accept for this entry. */
  representativeId: string;
  label: string;
  index: number;
  total: number;
}

/**
 * Resolves a DnD ID (a leaf ID or a row's descriptor key) to its entry.
 *
 * Rows have no ID of their own, so dragging one resolves to its first child
 * before any mutation API is called; the row still travels as one entry.
 */
export function resolveDragTarget(
  entries: MemberPageDocumentV2["blocks"],
  dragId: string,
): ResolvedDragTarget | null {
  const analysis = analyzeMemberPageEntries(entries);
  const descriptor =
    analysis.entries.find((candidate) => candidate.key === dragId) ??
    analysis.entryDescriptorFor(dragId);
  if (!descriptor) return null;
  const entry = descriptor.entry;
  return {
    key: descriptor.key,
    representativeId: descriptor.leafIds[0],
    label:
      entry.type === "row" ? MEMBER_ROW_ENTRY_LABEL : blockTypeLabel(entry.type),
    index: descriptor.index,
    total: entries.length,
  };
}

/**
 * dnd-kit lives only in this lazy editor module. Pointer events cover mouse,
 * pen, and touch; keyboard sorting uses dnd-kit's sortable coordinates. The
 * visible one-step controls remain beside every handle.
 */
export function SortableEditorCanvas({
  document,
  dndContextId,
  onReorder,
  onAnnounce,
  ...canvasProps
}: SortableEditorCanvasProps) {
  const reducedMotion = useReducedMotion();
  const lastOverId = useRef<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: POINTER_ACTIVATION_DISTANCE },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const accessibilityContainer = useMemo(
    () =>
      typeof window === "undefined"
        ? undefined
        : window.document.createElement("div"),
    [],
  );

  const entryKeys = useMemo(
    () => analyzeMemberPageEntries(document.blocks).entries.map((e) => e.key),
    [document.blocks],
  );

  function announceStart(event: DragStartEvent): void {
    const target = resolveDragTarget(document.blocks, String(event.active.id));
    if (!target) return;
    lastOverId.current = target.key;
    onAnnounce(
      dragStartAnnouncement(target.label, target.index + 1, target.total),
    );
  }

  function announceOver(event: DragOverEvent): void {
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    if (!overId || overId === lastOverId.current) return;
    lastOverId.current = overId;
    const active = resolveDragTarget(document.blocks, activeId);
    const over = resolveDragTarget(document.blocks, overId);
    if (!active || !over) return;
    onAnnounce(
      dragOverAnnouncement(active.label, over.index + 1, over.total),
    );
  }

  function finishDrag(event: DragEndEvent): void {
    const activeTarget = resolveDragTarget(
      document.blocks,
      String(event.active.id),
    );
    lastOverId.current = null;
    if (!activeTarget) return;
    const overId = event.over ? String(event.over.id) : null;
    if (!overId) {
      onAnnounce(
        dragCancelAnnouncement(
          activeTarget.label,
          activeTarget.index + 1,
          activeTarget.total,
        ),
      );
      return;
    }
    const overTarget = resolveDragTarget(document.blocks, overId);
    if (!overTarget) return;
    if (overTarget.key === activeTarget.key) {
      onAnnounce(
        dragStayedAnnouncement(
          activeTarget.label,
          activeTarget.index + 1,
          activeTarget.total,
        ),
      );
      return;
    }
    onReorder(activeTarget.representativeId, overTarget.index);
  }

  function cancelDrag(event: DragCancelEvent): void {
    lastOverId.current = null;
    const target = resolveDragTarget(
      document.blocks,
      String(event.active.id),
    );
    if (!target) return;
    onAnnounce(
      dragCancelAnnouncement(target.label, target.index + 1, target.total),
    );
  }

  return (
    <div
      className="min-w-0 max-w-full"
      data-editor-dnd-context-id={dndContextId}
    >
      <DndContext
        id={dndContextId}
        sensors={sensors}
        collisionDetection={closestCenter}
        autoScroll={!reducedMotion}
        accessibility={{
          // dnd-kit's built-in region is assertive. Keep it in a detached
          // container and route concise messages through the editor's one polite
          // live region instead, avoiding duplicate or competing speech.
          container: accessibilityContainer,
          announcements: SILENT_DND_ANNOUNCEMENTS,
          screenReaderInstructions: { draggable: "" },
          restoreFocus: true,
        }}
        onDragStart={announceStart}
        onDragOver={announceOver}
        onDragEnd={finishDrag}
        onDragCancel={cancelDrag}
      >
        <p id={DND_INSTRUCTIONS_ID} className="sr-only">
          To move this block with the keyboard, press Space on its drag handle,
          use the arrow keys, then press Space again to drop it. Press Escape to
          cancel. Move up and Move down buttons are always available instead.
        </p>
        <SortableContext
          items={entryKeys}
          strategy={verticalListSortingStrategy}
        >
          <EditorCanvas
            {...canvasProps}
            document={document}
            BlockContainer={SortableCanvasBlockContainer}
            RowContainer={SortableCanvasRowContainer}
          />
        </SortableContext>
      </DndContext>
    </div>
  );
}

function SortableCanvasBlockContainer(props: CanvasBlockContainerProps) {
  const reducedMotion = useReducedMotion();
  const label = blockTypeLabel(props.block.type);
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: props.entryKey,
    disabled: !props.interactive,
    data: { label, position: props.position, total: props.total },
    transition: reducedMotion ? null : undefined,
    animateLayoutChanges: reducedMotion ? () => false : undefined,
  });

  if (!props.interactive) return <div>{props.children}</div>;

  return (
    <CanvasBlockChrome
      {...props}
      containerRef={setNodeRef}
      dragging={isDragging}
      containerStyle={{
        /*
         * Translate only. `CSS.Transform` also emits the scaleX/scaleY that
         * dnd-kit derives from the two blocks trading places, and page blocks
         * are nothing like the same size: dropping a one-line quote where a
         * featured project with artwork stood asked for several times its own
         * height, and the block visibly burst across the page for the length
         * of the settle animation. Moving a block only ever moves it.
         */
        transform: CSS.Translate.toString(transform),
        transition: reducedMotion ? undefined : transition,
      }}
      dragHandle={
        <button
          {...attributes}
          {...listeners}
          ref={setActivatorNodeRef}
          id={blockDragHandleId(props.entryKey)}
          type="button"
          className={`${EDITOR_ICON_CONTROL} touch-none cursor-grab active:cursor-grabbing`}
          aria-describedby={DND_INSTRUCTIONS_ID}
          aria-label={`Drag ${label}, current position ${props.position} of ${props.total}`}
        >
          <GripIcon />
          <span className="sr-only">Drag</span>
        </button>
      }
    />
  );
}

function SortableCanvasRowContainer(props: CanvasRowContainerProps) {
  const reducedMotion = useReducedMotion();
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: props.entryKey,
    disabled: !props.interactive,
    data: {
      label: MEMBER_ROW_ENTRY_LABEL,
      position: props.position,
      total: props.total,
    },
    transition: reducedMotion ? null : undefined,
    animateLayoutChanges: reducedMotion ? () => false : undefined,
  });

  if (!props.interactive) return <div>{props.children}</div>;

  return (
    <CanvasRowChrome
      {...props}
      containerRef={setNodeRef}
      dragging={isDragging}
      containerStyle={{
        transform: CSS.Translate.toString(transform),
        transition: reducedMotion ? undefined : transition,
      }}
      dragHandle={
        <button
          {...attributes}
          {...listeners}
          ref={setActivatorNodeRef}
          id={blockDragHandleId(props.entryKey)}
          type="button"
          className={`${EDITOR_ICON_CONTROL} touch-none cursor-grab active:cursor-grabbing`}
          aria-describedby={DND_INSTRUCTIONS_ID}
          aria-label={`Drag ${MEMBER_ROW_ENTRY_LABEL}, current position ${props.position} of ${props.total}`}
        >
          <GripIcon />
          <span className="sr-only">Drag</span>
        </button>
      }
    />
  );
}

function subscribeReducedMotion(listener: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => undefined;
  const media = window.matchMedia(REDUCED_MOTION_MEDIA_QUERY);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

function reducedMotionSnapshot(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean(window.matchMedia?.(REDUCED_MOTION_MEDIA_QUERY).matches)
  );
}

function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    reducedMotionSnapshot,
    () => false,
  );
}

export function dragStartAnnouncement(
  label: string,
  position: number,
  total: number,
): string {
  return `Picked up ${label}, position ${position} of ${total}. Use the arrow keys to move it, Space to drop, or Escape to cancel.`;
}

export function dragOverAnnouncement(
  label: string,
  position: number,
  total: number,
): string {
  return `${label} is over position ${position} of ${total}.`;
}

export function dragStayedAnnouncement(
  label: string,
  position: number,
  total: number,
): string {
  return `${label} stayed at position ${position} of ${total}.`;
}

export function dragCancelAnnouncement(
  label: string,
  position: number,
  total: number,
): string {
  return `Cancelled moving ${label}. It is still at position ${position} of ${total}.`;
}
