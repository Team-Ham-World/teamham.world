"use client";

import dynamic from "next/dynamic";

import type { RichTextDoc } from "@/lib/members/v2/document";

export interface RichTextTransientDraft {
  editorJson: unknown;
  message: string;
}

export interface RichTextEditorProps {
  content: RichTextDoc | null;
  controlId?: string;
  label: string;
  transientDraft?: RichTextTransientDraft;
  onTransientChange?: (draft: RichTextTransientDraft | null) => void;
  onCanonicalChange: (content: RichTextDoc | null) => void;
}

/**
 * This boundary is intentionally tiny and TipTap-free.
 *
 * It is rendered only by the selected rich-text inspector or the transient
 * rich-text add flow. The actual editor and every TipTap package therefore
 * stay in their own client chunk until one of those two moments.
 */
const RichTextTipTapEditor = dynamic(
  () =>
    import("./rich-text-tiptap-editor").then(
      (module) => module.RichTextTipTapEditor,
    ),
  {
    ssr: false,
    loading: () => (
      <div
        role="status"
        aria-live="polite"
        className="border-2 border-dashed border-muted bg-paper p-4 text-sm font-bold text-muted"
      >
        Loading writing tools…
      </div>
    ),
  },
);

export function RichTextEditorLazy(props: RichTextEditorProps) {
  return <RichTextTipTapEditor {...props} />;
}
