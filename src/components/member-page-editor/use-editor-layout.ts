"use client";

import { useSyncExternalStore } from "react";

/**
 * The editor's two capability thresholds. Both demand hover and a fine
 * pointer: drag-and-drop, hover chrome, and the workbench itself are
 * meaningless on a touch screen, so no width alone ever qualifies.
 *
 * - `EDITOR_MINIMUM_MEDIA_QUERY` — the least a browser needs to edit at all.
 *   From 64rem the compact workbench mounts, and the rail and inspector are
 *   bottom sheets.
 * - `DESKTOP_EDITOR_MEDIA_QUERY` — the least the full three-column workbench
 *   needs. From 80rem the rail and inspector become permanent side regions.
 *
 * Between them lies the compact band (64rem inclusive to 80rem exclusive):
 * the editor mounts, and the sheets are the layout. Below 64rem, and on
 * coarse-pointer or touch-only devices, nothing mounts at all.
 */
export const EDITOR_MINIMUM_MEDIA_QUERY =
  "(min-width: 64rem) and (hover: hover) and (pointer: fine)";

export const DESKTOP_EDITOR_MEDIA_QUERY =
  "(min-width: 80rem) and (hover: hover) and (pointer: fine)";

function subscribeToMediaQuery(query: string) {
  return (listener: () => void): (() => void) => {
    if (typeof window === "undefined" || !window.matchMedia)
      return () => undefined;
    const media = window.matchMedia(query);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  };
}

function mediaQuerySnapshot(query: string): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return true;
  return window.matchMedia(query).matches;
}

function unavailableServerSnapshot(): boolean {
  return false;
}

// Stable identities: `useSyncExternalStore` resubscribes whenever its subscribe
// function changes, so the hook arguments are created once, not per render.
const subscribeToEditorMinimum = subscribeToMediaQuery(
  EDITOR_MINIMUM_MEDIA_QUERY,
);
const subscribeToDesktopLayout = subscribeToMediaQuery(
  DESKTOP_EDITOR_MEDIA_QUERY,
);
function editorAvailableSnapshot(): boolean {
  return mediaQuerySnapshot(EDITOR_MINIMUM_MEDIA_QUERY);
}
function desktopLayoutSnapshot(): boolean {
  return mediaQuerySnapshot(DESKTOP_EDITOR_MEDIA_QUERY);
}

/**
 * Fails closed until a browser proves that the editor has enough room.
 *
 * The server cannot know the viewport width, so it renders the requirement
 * notice. A matching CSS media query keeps that notice out of the first
 * paint on any qualifying screen; after hydration, the editor mounts — full
 * workbench from 80rem, compact sheet workbench from 64rem. Phones, tablets,
 * and touch-only devices never mount the editor state machine or its
 * autosave controller, even if they request a wide desktop-style viewport.
 */
export function useDesktopEditorAvailability(): boolean {
  return useSyncExternalStore(
    subscribeToEditorMinimum,
    editorAvailableSnapshot,
    unavailableServerSnapshot,
  );
}

/**
 * The server starts with the pinned desktop inspector. React then swaps to
 * the sheet-based compact workbench after hydration when the browser sits in
 * the 64–80rem band. Rendering only one inspector avoids duplicate field IDs
 * and duplicate focus targets.
 */
export function useDesktopEditorLayout(): boolean {
  return useSyncExternalStore(
    subscribeToDesktopLayout,
    desktopLayoutSnapshot,
    () => true,
  );
}
