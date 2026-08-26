"use client";

import { useSyncExternalStore } from "react";

export const DESKTOP_EDITOR_MEDIA_QUERY =
  "(min-width: 80rem) and (hover: hover) and (pointer: fine)";

function subscribeToDesktopLayout(listener: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => undefined;
  const media = window.matchMedia(DESKTOP_EDITOR_MEDIA_QUERY);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

function desktopSnapshot(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return true;
  return window.matchMedia(DESKTOP_EDITOR_MEDIA_QUERY).matches;
}

function unavailableServerSnapshot(): boolean {
  return false;
}

/**
 * Fails closed until a browser proves that the editor has enough room.
 *
 * The server cannot know the viewport width, so it renders the small-screen
 * notice. A matching CSS media query keeps that notice out of the first
 * desktop paint; after hydration, a qualifying browser mounts the real editor.
 * Mobile browsers never mount the editor state machine or its autosave
 * controller, even if they request a wide desktop-style viewport.
 */
export function useDesktopEditorAvailability(): boolean {
  return useSyncExternalStore(
    subscribeToDesktopLayout,
    desktopSnapshot,
    unavailableServerSnapshot,
  );
}

/**
 * The server starts with the pinned desktop inspector. React then swaps to the
 * single mobile sheet after hydration when the media query says it should.
 * Rendering only one inspector avoids duplicate field IDs and duplicate focus
 * targets.
 */
export function useDesktopEditorLayout(): boolean {
  return useSyncExternalStore(
    subscribeToDesktopLayout,
    desktopSnapshot,
    () => true,
  );
}
