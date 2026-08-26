"use client";

import { useRef } from "react";

export type EditorRailTab = "outline" | "images";

const TAB_ORDER: readonly EditorRailTab[] = ["outline", "images"];

const TAB =
  "min-h-11 flex-1 border-b-2 px-3 text-xs font-bold tracking-[0.14em] uppercase transition-[background-color,color,border-color] focus-visible:outline-3 focus-visible:-outline-offset-2 focus-visible:outline-interactive-blue aria-selected:border-b-ink aria-selected:bg-surface aria-selected:text-ink motion-reduce:transition-none";

export function railTabPanelId(tab: EditorRailTab): string {
  return `member-page-rail-panel-${tab}`;
}

export function railTabId(tab: EditorRailTab): string {
  return `member-page-rail-tab-${tab}`;
}

/**
 * Left tool rail: the page's structure and its images, one at a time.
 *
 * Both live behind tabs rather than stacked, because the previous layout put
 * the image library a full page-length below the canvas at laptop widths,
 * where nobody would ever find it. A tab list keeps both one keystroke away at
 * every width the rail is shown at.
 */
export function EditorRail({
  activeTab,
  onTabChange,
  imageCount,
  outline,
  images,
}: {
  activeTab: EditorRailTab;
  onTabChange: (tab: EditorRailTab) => void;
  imageCount: number;
  outline: React.ReactNode;
  images: React.ReactNode;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    const delta =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (delta === 0) return;
    event.preventDefault();
    const index = TAB_ORDER.indexOf(activeTab);
    const next = TAB_ORDER[(index + delta + TAB_ORDER.length) % TAB_ORDER.length];
    onTabChange(next);
    listRef.current
      ?.querySelector<HTMLButtonElement>(`#${railTabId(next)}`)
      ?.focus();
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-col" data-editor-rail="true">
      <div
        ref={listRef}
        role="tablist"
        aria-label="Page tools"
        className="flex shrink-0 border-b-2 border-ink bg-paper"
        onKeyDown={onKeyDown}
      >
        {TAB_ORDER.map((tab) => (
          <button
            key={tab}
            id={railTabId(tab)}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            aria-controls={railTabPanelId(tab)}
            tabIndex={activeTab === tab ? 0 : -1}
            className={`${TAB} ${
              activeTab === tab ? "" : "border-b-transparent text-muted hover:text-ink"
            }`}
            onClick={() => onTabChange(tab)}
          >
            {tab === "outline" ? "Outline" : `Images (${imageCount})`}
          </button>
        ))}
      </div>

      <div
        id={railTabPanelId("outline")}
        role="tabpanel"
        aria-labelledby={railTabId("outline")}
        hidden={activeTab !== "outline"}
        className="flex min-h-0 flex-1 flex-col"
      >
        {outline}
      </div>

      <div
        id={railTabPanelId("images")}
        role="tabpanel"
        aria-labelledby={railTabId("images")}
        hidden={activeTab !== "images"}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        {images}
      </div>
    </div>
  );
}
