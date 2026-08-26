"use client";

import { useEffect, useState, type ComponentType } from "react";

import {
  EditorCanvas,
  type EditorCanvasProps,
} from "./editor-canvas";
import type { SortableEditorCanvasProps } from "./sortable-editor-canvas";

/**
 * Server rendering and the editor's first client paint use the complete
 * explicit-control canvas. dnd-kit is requested only after the owner editor has
 * mounted, then replaces that fallback without changing the document order.
 */
export function EditorCanvasLazyDnd(props: SortableEditorCanvasProps) {
  const [EnhancedCanvas, setEnhancedCanvas] = useState<ComponentType<
    SortableEditorCanvasProps
  > | null>(null);

  useEffect(() => {
    let active = true;
    void import("./sortable-editor-canvas").then((module) => {
      if (active) setEnhancedCanvas(() => module.SortableEditorCanvas);
    });
    return () => {
      active = false;
    };
  }, []);

  if (EnhancedCanvas) return <EnhancedCanvas {...props} />;

  const fallbackProps: EditorCanvasProps = {
    document: props.document,
    theme: props.theme,
    assetMetadata: props.assetMetadata,
    selection: props.selection,
    callbacks: props.callbacks,
    interactive: props.interactive,
    frameInvalid: props.frameInvalid,
    invalidBlockIds: props.invalidBlockIds,
  };
  return <EditorCanvas {...fallbackProps} />;
}
