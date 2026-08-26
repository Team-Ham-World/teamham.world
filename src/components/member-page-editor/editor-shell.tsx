"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import type { AssetMetadata } from "@/components/member-page-v2";
import themeStyles from "@/components/member-page-v2/MemberPageV2View.module.css";
import { memberThemeStyle } from "@/components/member-page-v2/member-theme-presentation";
import type { MemberPageDocumentV2 } from "@/lib/members/v2/document";
import { extractMemberPageAssetIds } from "@/lib/members/v2/asset-references";
import { MAX_BLOCKS } from "@/lib/members/v2/limits";
import { memberPath } from "@/lib/site";
import {
  resolveEnabledThemeAccent,
  type ResolvedMemberThemeAccent,
} from "@/lib/members/v2/themes";

import { AddBlockPanel } from "./add-block-panel";
import { AssetLibrary } from "./asset-library";
import type { EditorAsset } from "./asset-api";
import {
  assetMetadataMap,
  editorAssetsFromMetadata,
} from "./asset-model";
import availabilityStyles from "./editor-availability.module.css";
import { BlockOutline } from "./block-outline";
import { BlockInspector } from "./block-inspector";
import {
  blockTypeLabel,
  canAddBlock,
  canAddFeaturedProject,
} from "./document-ops";
import { memberPageDndContextId } from "./dnd-config";
import {
  blockDragHandleId,
  blockSelectControlId,
  FRAME_SELECT_CONTROL_ID,
} from "./editor-canvas";
import { EditorCanvasLazyDnd } from "./editor-canvas-lazy";
import {
  EDITOR_PRIMARY_CONTROL,
  EDITOR_QUIET_CONTROL,
} from "./editor-controls";
import { ArrowLeftIcon, CloseIcon } from "./editor-icons";
import { EditorRail, type EditorRailTab } from "./editor-rail";
import {
  EditorNoticeStrip,
  EditorTopBar,
  PUBLISH_CONTROL_ID,
  type EditorMode,
} from "./editor-topbar";
import {
  focusFirstInvalidControl,
  summarizeEditorValidation,
  type EditorValidationSummary,
} from "./editor-validation";
import { FrameInspector } from "./frame-inspector";
import { createRandomIdGenerator, type MemberEditorIdGenerator } from "./ids";
import {
  focusInspectorReturnTarget,
  MobileInspectorSheet,
} from "./mobile-inspector-sheet";
import type { RichTextTransientDraft } from "./rich-text-editor-lazy";
import {
  useDesktopEditorAvailability,
  useDesktopEditorLayout,
} from "./use-editor-layout";
import {
  applyBeforeUnloadWarning,
  useMemberPageEditor,
  type MemberEditorActions,
} from "./use-member-page-editor";

export interface MemberPageEditorProps {
  slug: string;
  initialDocument: MemberPageDocumentV2;
  initialDraftRev: number;
  initialIsPublished: boolean;
  initialModerationHold: boolean;
  initialHasPublishedSnapshot: boolean;
  theme: ResolvedMemberThemeAccent;
  assetMetadata: ReadonlyMap<string, AssetMetadata>;
  initialAssets?: readonly EditorAsset[];
  actions: MemberEditorActions;
  idGenerator?: MemberEditorIdGenerator;
  debounceMs?: number;
  /** Seam for the reset confirmation, so tests can answer it directly. */
  confirmReset?: (message: string) => boolean;
}

type PendingFocus =
  | { token: number; kind: "id"; id: string }
  | {
      token: number;
      kind: "invalid";
      fallbackId: string;
      preferredId: string | null;
    };

/** What the one responsive inspector is currently showing. */
type InspectorSubject = "selection" | "add-block";

const ADD_BLOCK_PANEL_ID = "member-page-add-block";
const RAIL_SHEET_TITLE_ID = "member-page-rail-sheet-title";
const RAIL_SHEET_DESCRIPTION_ID = "member-page-rail-sheet-description";

/**
 * Viewport gate around the editor's stateful client tree.
 *
 * A narrow browser receives only the requirement notice. Keeping the gate
 * outside DesktopMemberPageEditor is important: hiding controls with CSS
 * would still mount autosave, uploads, drag-and-drop, and publication actions.
 */
export function MemberPageEditor(props: MemberPageEditorProps) {
  const available = useDesktopEditorAvailability();
  if (!available) return <EditorScreenRequirement slug={props.slug} />;
  return <DesktopMemberPageEditor {...props} />;
}

export function EditorScreenRequirement({ slug }: { slug: string }) {
  return (
    <section
      id="edit-page"
      aria-labelledby="editor-screen-requirement-title"
      data-editor-unavailable="small-screen"
      className={`${availabilityStyles.requirement} mx-auto min-h-[calc(100dvh-var(--nav-height))] max-w-5xl items-center px-5 py-12 sm:px-8`}
    >
      <div className="relative w-full border-2 border-ink bg-surface p-6 shadow-[7px_7px_0_0_var(--color-ink)] sm:p-10 sm:shadow-[10px_10px_0_0_var(--color-ink)]">
        <p className="inline-block -rotate-1 border-2 border-ink bg-paper px-3 py-1 text-xs font-bold tracking-[0.18em] uppercase">
          Desktop editor
        </p>
        <div className="mt-7 grid gap-8 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <div>
            <h2
              id="editor-screen-requirement-title"
              className="font-display max-w-2xl text-4xl leading-[0.95] sm:text-6xl"
            >
              Make room to edit.
            </h2>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-muted sm:text-lg">
              The page editor needs a desktop or laptop browser window at least
              1280 pixels wide, with a mouse or trackpad. Your page and saved
              draft are unchanged.
            </p>
          </div>
          <p
            aria-hidden="true"
            className="w-fit border-y-2 border-ink py-2 font-display text-2xl tracking-tight whitespace-nowrap sm:text-3xl"
          >
            ≥ 1280 px
          </p>
        </div>
        <Link
          href={memberPath(slug)}
          className={`${EDITOR_PRIMARY_CONTROL} mt-8 w-fit`}
        >
          <ArrowLeftIcon />
          View your page
        </Link>
      </div>
    </section>
  );
}

/**
 * Owner editor, laid out as a workbench rather than as a page section.
 *
 * Three fixed regions — a persistent bar, the tool rail, and the inspector —
 * frame one scrolling canvas that shows the real page. Each region scrolls on
 * its own from `xl` up, so save state, the page's structure, and the fields
 * for the selected thing are all reachable no matter how far down a long page
 * the owner has scrolled. Below `xl` the canvas takes the full width and the
 * two side regions become sheets, because there is no room for three columns
 * and a readable page at once.
 */
export function DesktopMemberPageEditor(props: MemberPageEditorProps) {
  const rootRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const focusToken = useRef(0);
  const inspectorReturnElement = useRef<HTMLElement | null>(null);
  const inspectorReturnId = useRef<string>(FRAME_SELECT_CONTROL_ID);
  const previousDocument = useRef(props.initialDocument);
  const [idGenerator] = useState(
    () => props.idGenerator ?? createRandomIdGenerator(),
  );
  const [mode, setMode] = useState<EditorMode>("edit");
  const [frameSelected, setFrameSelected] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorSubject, setInspectorSubject] =
    useState<InspectorSubject>("selection");
  const [railTab, setRailTab] = useState<EditorRailTab>("outline");
  const [railSheetOpen, setRailSheetOpen] = useState(false);
  const [pendingFocus, setPendingFocus] = useState<PendingFocus | null>(null);
  const [publishErrors, setPublishErrors] = useState<string[]>([]);
  const [richTextTransients, setRichTextTransients] = useState<
    Record<string, RichTextTransientDraft>
  >({});
  const [resetSequence, setResetSequence] = useState(0);
  const [assets, setAssets] = useState<EditorAsset[]>(() =>
    props.initialAssets
      ? [...props.initialAssets]
      : editorAssetsFromMetadata(props.assetMetadata),
  );
  const desktopLayout = useDesktopEditorLayout();

  const editor = useMemberPageEditor({
    slug: props.slug,
    initialDocument: props.initialDocument,
    initialDraftRev: props.initialDraftRev,
    initialIsPublished: props.initialIsPublished,
    initialModerationHold: props.initialModerationHold,
    initialHasPublishedSnapshot: props.initialHasPublishedSnapshot,
    actions: props.actions,
    idGenerator,
    debounceMs: props.debounceMs,
    confirmReset: props.confirmReset,
  });
  const liveTheme = useMemo(() => {
    if (
      props.theme.themeId === editor.document.frame.theme.id &&
      props.theme.accentId === editor.document.frame.theme.accentId
    ) {
      return props.theme;
    }
    const resolved = resolveEnabledThemeAccent(
      editor.document.frame.theme.id,
      editor.document.frame.theme.accentId,
    );
    if (!resolved) {
      throw new Error("Editor document contains an unavailable theme/accent pair.");
    }
    return resolved;
  }, [
    editor.document.frame.theme.accentId,
    editor.document.frame.theme.id,
    props.theme,
  ]);

  const selectedBlock =
    editor.selectedBlockId === null
      ? null
      : editor.document.blocks.find((block) => block.id === editor.selectedBlockId) ??
        null;
  const selection = useMemo(
    () =>
      selectedBlock
        ? ({ kind: "block", blockId: selectedBlock.id } as const)
        : frameSelected
          ? ({ kind: "frame" } as const)
          : null,
    [frameSelected, selectedBlock],
  );
  const previewing = mode === "preview";
  const liveAssetMetadata = useMemo(() => assetMetadataMap(assets), [assets]);
  const referencedAssetIds = useMemo(
    () => new Set(extractMemberPageAssetIds(editor.document)),
    [editor.document],
  );
  const validation = useMemo(
    () => summarizeEditorValidation(editor.document),
    [editor.document],
  );
  const transientRichTextValidation = useMemo(
    () => summarizeTransientRichTextValidation(editor.document, richTextTransients),
    [editor.document, richTextTransients],
  );
  const invalidBlockIds = useMemo(
    () =>
      new Set([
        ...validation.invalidBlockIds,
        ...transientRichTextValidation.invalidBlockIds,
      ]),
    [transientRichTextValidation.invalidBlockIds, validation.invalidBlockIds],
  );

  useEffect(() => {
    if (previousDocument.current === editor.document) return;
    previousDocument.current = editor.document;
    setPublishErrors([]);
  }, [editor.document]);

  useEffect(() => {
    if (transientRichTextValidation.messages.length === 0) return;
    const handler = (event: BeforeUnloadEvent) => applyBeforeUnloadWarning(event);
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [transientRichTextValidation.messages.length]);

  useEffect(() => {
    if (!pendingFocus || !rootRef.current) return;
    const request = pendingFocus;
    const frame = window.requestAnimationFrame(() => {
      const root = rootRef.current;
      if (!root) return;
      const fallbackId = request.kind === "id" ? request.id : request.fallbackId;
      const fallback = document.getElementById(fallbackId);
      if (request.kind === "invalid") {
        const preferred = request.preferredId
          ? document.getElementById(request.preferredId)
          : null;
        focusFirstInvalidControl(
          root,
          fallback && root.contains(fallback) ? fallback : null,
          preferred && root.contains(preferred) ? preferred : null,
        );
      } else if (fallback && root.contains(fallback)) {
        fallback.focus();
      }
      setPendingFocus((current) =>
        current?.token === request.token ? null : current,
      );
    });
    return () => window.cancelAnimationFrame(frame);
  }, [desktopLayout, inspectorOpen, pendingFocus, selection]);

  function scheduleFocusById(id: string): void {
    focusToken.current += 1;
    setPendingFocus({ token: focusToken.current, kind: "id", id });
  }

  function scheduleInvalidFocus(
    fallbackId: string,
    preferredId: string | null = null,
  ): void {
    focusToken.current += 1;
    setPendingFocus({
      token: focusToken.current,
      kind: "invalid",
      fallbackId,
      preferredId,
    });
  }

  /**
   * Brings a canvas region into view after a rail selection.
   *
   * The rail is the only place that can select something several screens away,
   * so it is the only place that needs to move the canvas. Jumping instantly
   * rather than smoothly keeps the behaviour identical under reduced motion.
   */
  function revealRegion(selector: string): void {
    window.requestAnimationFrame(() => {
      canvasRef.current
        ?.querySelector(selector)
        ?.scrollIntoView({ block: "center", inline: "nearest" });
    });
  }

  function openInspectorSheet(invoker: HTMLElement, fallbackId: string): void {
    if (desktopLayout) return;
    inspectorReturnElement.current = invoker;
    inspectorReturnId.current = fallbackId;
    setInspectorOpen(true);
  }

  function closeInspectorSheet(): void {
    const directTarget = inspectorReturnElement.current;
    const fallbackId = inspectorReturnId.current;
    setInspectorOpen(false);
    window.requestAnimationFrame(() => {
      const fallback = document.getElementById(fallbackId);
      focusInspectorReturnTarget(directTarget, fallback);
    });
  }

  function selectFrame(invoker: HTMLElement, reveal = false): void {
    setInspectorSubject("selection");
    editor.selectBlock(null);
    setFrameSelected(true);
    openInspectorSheet(invoker, FRAME_SELECT_CONTROL_ID);
    if (reveal) revealRegion('[data-canvas-region="frame"]');
  }

  function selectBlock(
    blockId: string,
    invoker: HTMLElement,
    reveal = false,
  ): void {
    setInspectorSubject("selection");
    setFrameSelected(false);
    editor.selectBlock(blockId);
    openInspectorSheet(invoker, blockSelectControlId(blockId));
    if (reveal) revealRegion(`[data-block-id="${blockId}"]`);
  }

  function startAddingBlock(invoker: HTMLElement): void {
    setInspectorSubject("add-block");
    setRailSheetOpen(false);
    openInspectorSheet(invoker, ADD_BLOCK_PANEL_ID);
    scheduleFocusById(ADD_BLOCK_PANEL_ID);
  }

  function focusValidationTarget(
    summary: EditorValidationSummary,
    invoker: HTMLElement,
  ): void {
    setInspectorSubject("selection");
    if (summary.firstTarget?.kind === "block") {
      setFrameSelected(false);
      editor.selectBlock(summary.firstTarget.blockId);
      const fallbackId = blockSelectControlId(summary.firstTarget.blockId);
      openInspectorSheet(invoker, fallbackId);
      revealRegion(`[data-block-id="${summary.firstTarget.blockId}"]`);
      scheduleInvalidFocus(fallbackId, summary.firstControlId);
      return;
    }
    setFrameSelected(true);
    editor.selectBlock(null);
    openInspectorSheet(invoker, FRAME_SELECT_CONTROL_ID);
    revealRegion('[data-canvas-region="frame"]');
    scheduleInvalidFocus(FRAME_SELECT_CONTROL_ID, summary.firstControlId);
  }

  async function handlePublish(invoker: HTMLButtonElement): Promise<void> {
    if (validation.messages.length > 0) {
      setPublishErrors(validation.messages);
      focusValidationTarget(validation, invoker);
      return;
    }

    if (transientRichTextValidation.messages.length > 0) {
      setPublishErrors(transientRichTextValidation.messages);
      focusValidationTarget(transientRichTextValidation, invoker);
      return;
    }

    const mountedInvalid = rootRef.current?.querySelector<HTMLElement>(
      '[aria-invalid="true"]',
    );
    if (mountedInvalid) {
      setPublishErrors(["Review the highlighted field before publishing."]);
      mountedInvalid.focus();
      return;
    }

    const result = await editor.publish();
    if (result.status !== "invalid") return;
    const messages = Object.values(result.fieldErrors).filter(
      (message): message is string => Boolean(message),
    );
    setPublishErrors(
      messages.length > 0
        ? [...new Set(messages)]
        : ["Review the highlighted field before publishing."],
    );
    focusValidationTarget(validation, invoker);
  }

  async function handleReset(): Promise<void> {
    const result = await editor.reset();
    if (result.status !== "reset") return;
    setRichTextTransients({});
    setPublishErrors([]);
    setResetSequence((current) => current + 1);
  }

  const addBlockPanel = (
    <AddBlockPanel
      key={resetSequence}
      presentation="inspector"
      canAddBlock={canAddBlock(editor.document)}
      canAddFeaturedProject={canAddFeaturedProject(editor.document)}
      blockCount={editor.document.blocks.length}
      maxBlocks={MAX_BLOCKS}
      nextId={idGenerator}
      assets={assets}
      onAdd={(block) => {
        const result = editor.addBlock(block);
        if (result.status !== "ok") return;
        setInspectorSubject("selection");
        setFrameSelected(false);
        editor.selectBlock(block.id);
        revealRegion(`[data-block-id="${block.id}"]`);
        scheduleFocusById(blockSelectControlId(block.id));
      }}
    />
  );

  const addingBlock = inspectorSubject === "add-block";
  const inspectorTitle = addingBlock
    ? "Add a block"
    : selectedBlock
      ? `${blockTypeLabel(selectedBlock.type)} settings`
      : frameSelected
        ? "Profile header"
        : "Nothing selected";
  const inspectorFields = addingBlock ? (
    addBlockPanel
  ) : selectedBlock ? (
    <BlockInspector
      block={selectedBlock}
      nextId={idGenerator}
      assets={assets}
      richTextTransient={richTextTransients[selectedBlock.id]}
      onRichTextTransientChange={(draft) => {
        if (!draft) setPublishErrors([]);
        setRichTextTransients((current) => {
          if (draft) return { ...current, [selectedBlock.id]: draft };
          if (!(selectedBlock.id in current)) return current;
          const next = { ...current };
          delete next[selectedBlock.id];
          return next;
        });
      }}
      onChange={(block) => editor.updateBlock(block)}
    />
  ) : frameSelected ? (
    <FrameInspector
      frame={editor.document.frame}
      assets={assets}
      onChange={(patch) => editor.updateFrameFields(patch)}
    />
  ) : (
    <EditorInspectorEmptyState
      onSelectFrame={() => {
        editor.selectBlock(null);
        setFrameSelected(true);
      }}
    />
  );

  const rail = (
    <EditorRail
      activeTab={railTab}
      onTabChange={setRailTab}
      imageCount={assets.length}
      outline={
        <BlockOutline
          document={editor.document}
          selection={selection}
          invalidBlockIds={invalidBlockIds}
          frameInvalid={validation.frameInvalid}
          canAddBlock={canAddBlock(editor.document)}
          onSelectFrame={(invoker) => {
            selectFrame(invoker, true);
            setRailSheetOpen(false);
          }}
          onSelectBlock={(blockId, invoker) => {
            selectBlock(blockId, invoker, true);
            setRailSheetOpen(false);
          }}
          onAddBlock={startAddingBlock}
        />
      }
      images={
        <AssetLibrary
          slug={props.slug}
          assets={assets}
          referencedAssetIds={referencedAssetIds}
          onAssetsChange={setAssets}
          layout="rail"
        />
      }
    />
  );

  return (
    <section
      ref={rootRef}
      id="edit-page"
      aria-labelledby="edit-page-heading"
      data-editor-workspace="app-shell"
      className="flex min-w-0 flex-col xl:h-[calc(100dvh-var(--nav-height))] xl:overflow-hidden"
    >
      <h2 id="edit-page-heading" className="sr-only">
        Edit your page
      </h2>

      <div className="sticky top-0 z-30 shrink-0 xl:static">
        <EditorTopBar
          slug={props.slug}
          editor={editor}
          mode={mode}
          publishErrors={publishErrors}
          onModeChange={(next) => {
            if (next === "preview") {
              setInspectorOpen(false);
              setRailSheetOpen(false);
              setPendingFocus(null);
            }
            setMode(next);
          }}
          onPublish={(invoker) => void handlePublish(invoker)}
          onReset={() => void handleReset()}
        />
        <EditorNoticeStrip
          editor={editor}
          publishErrors={publishErrors}
          onFocusFirstError={() =>
            focusValidationTarget(
              validation.messages.length > 0
                ? validation
                : transientRichTextValidation,
              document.getElementById(PUBLISH_CONTROL_ID) ?? rootRef.current!,
            )
          }
        />
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col xl:flex-row">
        {/*
          * Gated on the media query, not just on a `hidden xl:flex` class: the
          * rail carries fixed control ids, and rendering it here as well as in
          * the sheet would put every one of them in the document twice.
          */}
        {!previewing && desktopLayout ? (
          <aside
            aria-label="Page tools"
            data-editor-rail-region="true"
            className="hidden min-h-0 w-[19rem] shrink-0 border-r-2 border-ink bg-surface xl:flex xl:flex-col 2xl:w-[23rem]"
          >
            {rail}
          </aside>
        ) : null}

        <div
          ref={canvasRef}
          data-editor-canvas="true"
          className="min-h-0 min-w-0 flex-1 overflow-x-clip bg-ink/[0.07] px-4 py-8 sm:px-8 sm:py-10 xl:overflow-y-auto xl:overscroll-contain"
        >
          {/*
            * The sheet is the member's page, so the sheet is what wears their
            * theme: stock, texture, rule, and shadow all the way to its edge.
            * Painting it further in left a coloured rectangle floating on HAM
            * paper with an untextured margin around it. Panel scope keeps that
            * to the sheet, so the workbench holding it stays house-coloured.
            */}
          <div
            data-editor-sheet="true"
            data-member-theme-surface="true"
            data-theme-scope="panel"
            data-theme-id={liveTheme.themeId}
            data-accent-id={liveTheme.accentId}
            style={memberThemeStyle(liveTheme)}
            className={`${themeStyles.themeSurface} mx-auto min-w-0 max-w-[62rem] border-2 border-ink px-5 pt-20 pb-16 shadow-[6px_6px_0_0_var(--color-ink)] sm:px-10 sm:shadow-[10px_10px_0_0_var(--color-ink)]`}
          >
            <EditorCanvasLazyDnd
              document={editor.document}
              theme={liveTheme}
              assetMetadata={liveAssetMetadata}
              selection={selection}
              interactive={!previewing}
              frameInvalid={validation.frameInvalid}
              invalidBlockIds={invalidBlockIds}
              dndContextId={memberPageDndContextId(props.slug)}
              onReorder={(blockId, targetIndex) => {
                const result = editor.reorderBlock(blockId, targetIndex);
                if (result.status === "ok") {
                  setFrameSelected(false);
                  scheduleFocusById(blockDragHandleId(blockId));
                }
              }}
              onAnnounce={editor.announce}
              callbacks={{
                onSelectFrame: (invoker) => selectFrame(invoker),
                onSelectBlock: (blockId, invoker) => selectBlock(blockId, invoker),
                onDuplicate: (blockId) => {
                  const result = editor.duplicateBlock(blockId);
                  if (result.status === "ok" && result.duplicatedId) {
                    setFrameSelected(false);
                    scheduleFocusById(blockSelectControlId(result.duplicatedId));
                  }
                },
                onDelete: (blockId) => {
                  const index = editor.document.blocks.findIndex(
                    (block) => block.id === blockId,
                  );
                  const result = editor.deleteBlock(blockId);
                  if (result.status !== "ok") return;
                  setInspectorOpen(false);
                  const nextBlock =
                    result.document.blocks[
                      Math.min(index, result.document.blocks.length - 1)
                    ];
                  if (nextBlock) {
                    editor.selectBlock(nextBlock.id);
                    setFrameSelected(false);
                    scheduleFocusById(blockSelectControlId(nextBlock.id));
                  } else {
                    // Nothing left to select. Land on the profile header,
                    // which is the one region a page always has, rather than
                    // dropping focus to the document with the block gone.
                    editor.selectBlock(null);
                    setFrameSelected(true);
                    scheduleFocusById(FRAME_SELECT_CONTROL_ID);
                  }
                },
                onMove: (blockId, direction) => {
                  if (editor.moveBlock(blockId, direction)) {
                    setFrameSelected(false);
                    scheduleFocusById(blockSelectControlId(blockId));
                  }
                },
              }}
            />
          </div>

          {!previewing && editor.undoable ? (
            <div className="mx-auto mt-6 flex max-w-[62rem] min-w-0 flex-wrap items-center justify-between gap-3 border-2 border-ink bg-surface p-4">
              <p className="text-sm font-bold">
                Deleted {editor.undoable.label}.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={EDITOR_QUIET_CONTROL}
                  onClick={() => {
                    const restoredId = editor.undoable?.block.id;
                    const result = editor.undoDelete();
                    if (restoredId && result?.status === "ok") {
                      setFrameSelected(false);
                      scheduleFocusById(blockSelectControlId(restoredId));
                    }
                  }}
                >
                  Undo
                </button>
                <button
                  type="button"
                  className={EDITOR_QUIET_CONTROL}
                  onClick={() => editor.dismissUndo()}
                >
                  Dismiss
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {!previewing && desktopLayout ? (
          <aside
            aria-label="Inspector"
            data-editor-inspector="true"
            className="hidden min-h-0 w-[21rem] shrink-0 flex-col border-l-2 border-ink bg-surface xl:flex 2xl:w-[26rem]"
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b-2 border-ink px-4 py-3">
              <h3 className="min-w-0 truncate text-xs font-bold tracking-[0.18em] text-muted uppercase">
                {inspectorTitle}
              </h3>
              {addingBlock ? (
                <button
                  type="button"
                  className={`${EDITOR_QUIET_CONTROL} shrink-0`}
                  onClick={() => setInspectorSubject("selection")}
                >
                  <CloseIcon />
                  Cancel
                </button>
              ) : null}
            </div>
            <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain p-4">
              {inspectorFields}
            </div>
          </aside>
        ) : null}
      </div>

      {!previewing && !desktopLayout ? (
        <div className="sticky bottom-0 z-30 flex shrink-0 gap-2 border-t-2 border-ink bg-surface px-4 py-2 xl:hidden">
          <button
            type="button"
            className={`${EDITOR_QUIET_CONTROL} flex-1`}
            onClick={() => {
              setRailTab("outline");
              setRailSheetOpen(true);
            }}
          >
            Outline
          </button>
          <button
            type="button"
            className={`${EDITOR_QUIET_CONTROL} flex-1`}
            onClick={() => {
              setRailTab("images");
              setRailSheetOpen(true);
            }}
          >
            Images ({assets.length})
          </button>
        </div>
      ) : null}

      {!previewing && !desktopLayout && railSheetOpen ? (
        <MobileInspectorSheet
          kicker="Page tools"
          title={railTab === "outline" ? "Outline" : "Images"}
          description="Choose a part of your page, or manage its images."
          titleId={RAIL_SHEET_TITLE_ID}
          descriptionId={RAIL_SHEET_DESCRIPTION_ID}
          onClose={() => setRailSheetOpen(false)}
        >
          {rail}
        </MobileInspectorSheet>
      ) : null}

      {!previewing && !desktopLayout && inspectorOpen ? (
        <MobileInspectorSheet
          title={inspectorTitle}
          titleId="mobile-inspector-title"
          descriptionId="mobile-inspector-description"
          onClose={closeInspectorSheet}
        >
          {inspectorFields}
        </MobileInspectorSheet>
      ) : null}

      <p
        key={editor.announcementSequence}
        aria-live="polite"
        aria-atomic="true"
        aria-relevant="additions text"
        role="status"
        className="sr-only"
      >
        {editor.announcement}
      </p>
    </section>
  );
}

/** Explicit inspector state for the gap after a block selection is cleared. */
export function EditorInspectorEmptyState({
  onSelectFrame,
}: {
  onSelectFrame: () => void;
}) {
  return (
    <div>
      <p className="max-w-prose leading-relaxed text-muted">
        Pick a block on your page to change it, or edit the profile header at the
        top.
      </p>
      <button
        type="button"
        className={`${EDITOR_QUIET_CONTROL} mt-5`}
        onClick={onSelectFrame}
      >
        Edit profile header
      </button>
    </div>
  );
}

export function summarizeTransientRichTextValidation(
  document: MemberPageDocumentV2,
  transients: Readonly<Record<string, RichTextTransientDraft | undefined>>,
): EditorValidationSummary {
  const messages: string[] = [];
  const invalidBlockIds = new Set<string>();
  let firstBlockId: string | null = null;
  for (let index = 0; index < document.blocks.length; index += 1) {
    const block = document.blocks[index];
    if (block.type !== "richText") continue;
    const transient = transients[block.id];
    if (!transient) continue;
    firstBlockId ??= block.id;
    invalidBlockIds.add(block.id);
    messages.push(`Rich text, block ${index + 1}: ${transient.message}`);
  }

  return {
    messages,
    frameInvalid: false,
    invalidBlockIds,
    firstTarget: firstBlockId
      ? { kind: "block", blockId: firstBlockId }
      : null,
    firstControlId: firstBlockId
      ? `block-${firstBlockId}-rich-text`
      : null,
  };
}
