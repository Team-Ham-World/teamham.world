"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Editor, JSONContent } from "@tiptap/core";
import Link from "@tiptap/extension-link";
import TextAlign from "@tiptap/extension-text-align";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

import {
  RICH_TEXT_ALIGNMENTS,
  type RichTextAlignment,
  type RichTextDoc,
} from "@/lib/members/v2/document";

import type { RichTextEditorProps } from "./rich-text-editor-lazy";
import {
  canonicalRichTextToTipTapJson,
  evaluateTipTapEdit,
  normalizeRichTextHttpsLink,
  richTextDocsEqual,
} from "./rich-text-adapter";
import styles from "./rich-text-tiptap-editor.module.css";

type ProseMirrorState = Editor["state"];
type ProseMirrorNode = Editor["state"]["doc"];

const EMPTY_EDITOR_DOC: JSONContent = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

const TOOLBAR_CONTROL =
  "inline-flex min-h-11 min-w-11 items-center justify-center border-2 border-ink bg-surface px-3 py-2 text-sm font-bold text-ink transition-[transform,background-color,color,box-shadow] hover:-translate-y-0.5 hover:bg-ink hover:text-paper active:translate-x-0.5 active:translate-y-0.5 disabled:cursor-not-allowed disabled:border-muted disabled:bg-paper disabled:text-muted disabled:hover:translate-y-0 disabled:hover:bg-paper disabled:hover:text-muted motion-reduce:transform-none motion-reduce:transition-none";

/*
 * The pressed look is stated as `aria-pressed:` variants rather than as plain
 * utilities appended to the class list. Appending `bg-ink text-paper` put two
 * same-specificity rules in play against the base `bg-surface text-ink`, and
 * Tailwind's own emission order settled each one separately: surface won the
 * background, paper won the text, and an active button came out near-white on
 * near-white. Every variant here carries the attribute selector, so the
 * pressed state wins on specificity and no ordering can undo it.
 */
const ACTIVE_TOOLBAR_STATE =
  "aria-pressed:bg-ink aria-pressed:text-paper aria-pressed:shadow-[3px_3px_0_0_var(--color-interactive-blue)] aria-pressed:hover:bg-interactive-blue aria-pressed:hover:text-paper";

interface ToolbarState {
  paragraph: boolean;
  heading2: boolean;
  heading3: boolean;
  bold: boolean;
  italic: boolean;
  bulletList: boolean;
  orderedList: boolean;
  blockquote: boolean;
  link: boolean;
  linkHref: string;
  selectionEmpty: boolean;
  align: RichTextAlignment | "mixed";
}

const EMPTY_TOOLBAR_STATE: ToolbarState = {
  paragraph: false,
  heading2: false,
  heading3: false,
  bold: false,
  italic: false,
  bulletList: false,
  orderedList: false,
  blockquote: false,
  link: false,
  linkHref: "",
  selectionEmpty: true,
  align: "left",
};

/**
 * The alignment a selection would edit: the shared value for a caret or a
 * uniform selection, "mixed" when the covered paragraph/heading blocks
 * disagree. Non-alignable textblocks never occur in this schema, but a
 * selection that covers none of them still reads as mixed rather than left.
 */
function selectionTextAlign(
  state: ProseMirrorState,
): ToolbarState["align"] {
  const normalize = (value: unknown): RichTextAlignment =>
    value === "center" || value === "right" ? value : "left";

  const { from, to, empty } = state.selection;
  let found: RichTextAlignment | null = null;
  let mixed = false;

  const read = (node: ProseMirrorNode): boolean => {
    if (
      !node.isTextblock ||
      (node.type.name !== "paragraph" && node.type.name !== "heading")
    ) {
      return true;
    }
    const aligned = normalize(node.attrs.textAlign);
    if (found !== null && found !== aligned) {
      mixed = true;
      return false;
    }
    found ??= aligned;
    return true;
  };

  if (empty) {
    found = normalize(state.selection.$from.parent.attrs.textAlign);
  } else {
    state.doc.nodesBetween(from, to, read);
  }

  return mixed || found === null ? "mixed" : found;
}

/** The only module that imports TipTap. It is reached through next/dynamic. */
export function RichTextTipTapEditor({
  content,
  controlId,
  label,
  transientDraft,
  onTransientChange,
  onCanonicalChange,
}: RichTextEditorProps) {
  const hintId = useId();
  const errorId = useId();
  const callbackRef = useRef(onCanonicalChange);
  const transientCallbackRef = useRef(onTransientChange);
  const lastReportedRef = useRef<RichTextDoc | null>(content);
  const [validationMessage, setValidationMessage] = useState<string | null>(
    transientDraft?.message ??
      (content === null ? "Add some text before this block can save." : null),
  );

  useEffect(() => {
    callbackRef.current = onCanonicalChange;
  }, [onCanonicalChange]);

  useEffect(() => {
    transientCallbackRef.current = onTransientChange;
  }, [onTransientChange]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        code: false,
        codeBlock: false,
        hardBreak: false,
        horizontalRule: false,
        strike: false,
        underline: false,
        link: false,
        dropcursor: false,
        gapcursor: false,
        trailingNode: false,
      }),
      Link.configure({
        autolink: false,
        linkOnPaste: false,
        markdownLinks: false,
        openOnClick: false,
        enableClickSelection: true,
        defaultProtocol: "https",
        protocols: ["https"],
        isAllowedUri: (url) => normalizeRichTextHttpsLink(url) !== null,
        shouldAutoLink: () => false,
        HTMLAttributes: {
          rel: "noopener noreferrer",
        },
      }),
      TextAlign.configure({
        types: ["paragraph", "heading"],
        alignments: [...RICH_TEXT_ALIGNMENTS],
        defaultAlignment: null,
      }),
    ],
    content: transientDraft
      ? (transientDraft.editorJson as JSONContent)
      : content
        ? canonicalRichTextToTipTapJson(content)
        : EMPTY_EDITOR_DOC,
    onCreate: ({ editor: createdEditor }) => {
      // The toolbar state store only re-reads the editor on a transaction, so
      // a mounted-but-unfocused editor would otherwise leave every button on
      // its null-editor fallback until the first keystroke. One no-op
      // transaction wakes it without touching the document or taking focus.
      createdEditor.view.dispatch(createdEditor.state.tr);
    },
    editorProps: {
      attributes: {
        ...(controlId ? { id: controlId } : {}),
        role: "textbox",
        "aria-label": label,
        "aria-multiline": "true",
        "aria-describedby": `${hintId} ${errorId}`,
        ...(validationMessage ? { "aria-invalid": "true" } : {}),
        "data-placeholder": "Start writing…",
        class: styles.editor,
      },
    },
    onUpdate: ({ editor: activeEditor }) => {
      const evaluated = evaluateTipTapEdit(activeEditor.getJSON());
      if (evaluated.status === "invalid") {
        lastReportedRef.current = null;
        setEditorInvalid(activeEditor, true);
        setValidationMessage(evaluated.message);
        transientCallbackRef.current?.({
          editorJson: evaluated.editorJson,
          message: evaluated.message,
        });
        callbackRef.current(null);
        return;
      }

      setEditorInvalid(activeEditor, false);
      setValidationMessage(null);
      transientCallbackRef.current?.(null);
      if (richTextDocsEqual(lastReportedRef.current, evaluated.doc)) return;
      lastReportedRef.current = evaluated.doc;
      callbackRef.current(evaluated.doc);
    },
  });

  // Reset and other server-led document replacement can update the selected
  // block while this chunk stays mounted. Own edits are skipped via the
  // last-reported value, so setContent never fights the owner's cursor.
  useEffect(() => {
    if (
      !editor ||
      transientDraft ||
      richTextDocsEqual(content, lastReportedRef.current)
    ) {
      return;
    }
    const nextContent = content
      ? canonicalRichTextToTipTapJson(content)
      : EMPTY_EDITOR_DOC;
    editor.commands.setContent(nextContent, { emitUpdate: false });
    lastReportedRef.current = content;
    const message =
      content === null ? "Add some text before this block can save." : null;
    setEditorInvalid(editor, message !== null);
    setValidationMessage(message);
  }, [content, editor, transientDraft]);

  const toolbarState = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => {
      if (!currentEditor) return EMPTY_TOOLBAR_STATE;
      const href = currentEditor.getAttributes("link").href;
      return {
        paragraph: currentEditor.isActive("paragraph"),
        heading2: currentEditor.isActive("heading", { level: 2 }),
        heading3: currentEditor.isActive("heading", { level: 3 }),
        bold: currentEditor.isActive("bold"),
        italic: currentEditor.isActive("italic"),
        bulletList: currentEditor.isActive("bulletList"),
        orderedList: currentEditor.isActive("orderedList"),
        blockquote: currentEditor.isActive("blockquote"),
        link: currentEditor.isActive("link"),
        linkHref: typeof href === "string" ? href : "",
        selectionEmpty: currentEditor.state.selection.empty,
        align: selectionTextAlign(currentEditor.state),
      } satisfies ToolbarState;
    },
  }) ?? EMPTY_TOOLBAR_STATE;

  if (!editor) {
    return (
      <p role="status" aria-live="polite" className="text-sm font-bold text-muted">
        Preparing writing tools…
      </p>
    );
  }

  return (
    <div className="min-w-0">
      <RichTextToolbar editor={editor} state={toolbarState} />

      <div
        className={`mt-3 min-w-0 overflow-hidden border-2 bg-paper ${
          validationMessage ? "border-decorative-red" : "border-ink"
        }`}
      >
        <EditorContent editor={editor} />
      </div>

      <p id={hintId} className="mt-3 text-sm leading-relaxed text-muted">
        Use paragraphs, H2 or H3 headings, bold, italic, links, lists, quotes,
        and left, center, or right text alignment.
        Empty text stays here until it is ready and does not autosave.
      </p>
      <p
        id={errorId}
        aria-live="polite"
        className={
          validationMessage
            ? "mt-3 flex items-start gap-2 border-l-4 border-decorative-red pl-2 text-sm font-bold text-ink"
            : "sr-only"
        }
      >
        {validationMessage ? (
          <>
            <span aria-hidden="true" className="text-decorative-red">&#9888;</span>
            <span>{validationMessage}</span>
          </>
        ) : (
          "Rich text is valid."
        )}
      </p>
    </div>
  );
}

function RichTextToolbar({
  editor,
  state,
}: {
  editor: Editor;
  state: ToolbarState;
}) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const linkInputId = useId();
  const linkErrorId = `${linkInputId}-error`;
  const canEditLink = state.link || !state.selectionEmpty;

  function openLinkEditor(): void {
    setLinkValue(state.linkHref);
    setLinkError(null);
    setLinkOpen(true);
  }

  function applyLink(): void {
    const href = normalizeRichTextHttpsLink(linkValue);
    if (!href) {
      setLinkError("Use a full credential-free https:// address.");
      return;
    }

    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    setLinkOpen(false);
    setLinkError(null);
  }

  return (
    <div>
      <div
        role="toolbar"
        aria-label="Rich text formatting"
        className="flex max-w-full flex-wrap gap-2"
      >
        <ToolbarButton
          label="Paragraph"
          active={state.paragraph}
          onPress={() => editor.chain().focus().setParagraph().run()}
        />
        <ToolbarButton
          label="H2"
          active={state.heading2}
          onPress={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        />
        <ToolbarButton
          label="H3"
          active={state.heading3}
          onPress={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        />
        <ToolbarButton
          label="Left"
          ariaLabel="Align left"
          active={state.align === "left"}
          onPress={() => editor.chain().focus().unsetTextAlign().run()}
        />
        <ToolbarButton
          label="Center"
          ariaLabel="Align center"
          active={state.align === "center"}
          onPress={() => editor.chain().focus().setTextAlign("center").run()}
        />
        <ToolbarButton
          label="Right"
          ariaLabel="Align right"
          active={state.align === "right"}
          onPress={() => editor.chain().focus().setTextAlign("right").run()}
        />
        <ToolbarButton
          label="Bold"
          active={state.bold}
          onPress={() => editor.chain().focus().toggleBold().run()}
        />
        <ToolbarButton
          label="Italic"
          active={state.italic}
          onPress={() => editor.chain().focus().toggleItalic().run()}
        />
        <ToolbarButton
          label="Bullets"
          active={state.bulletList}
          onPress={() => editor.chain().focus().toggleBulletList().run()}
        />
        <ToolbarButton
          label="Numbers"
          active={state.orderedList}
          onPress={() => editor.chain().focus().toggleOrderedList().run()}
        />
        <ToolbarButton
          label="Quote"
          active={state.blockquote}
          onPress={() => editor.chain().focus().toggleBlockquote().run()}
        />
        <ToolbarButton
          label={state.link ? "Edit link" : "Add link"}
          active={state.link}
          disabled={!canEditLink}
          onPress={openLinkEditor}
        />
      </div>

      {!canEditLink ? (
        <p className="mt-2 text-sm text-muted">Select words before adding a link.</p>
      ) : null}

      {linkOpen ? (
        <div className="mt-3 border-2 border-ink bg-surface p-3">
          <label htmlFor={linkInputId} className="block text-sm font-bold text-ink">
            HTTPS address
          </label>
          <input
            id={linkInputId}
            type="url"
            inputMode="url"
            autoComplete="url"
            value={linkValue}
            aria-invalid={linkError ? true : undefined}
            aria-describedby={linkError ? linkErrorId : undefined}
            className="mt-2 min-h-11 w-full min-w-0 border-2 border-ink bg-paper px-3 py-2 text-ink outline-none focus:shadow-[3px_3px_0_0_var(--color-interactive-blue)]"
            onChange={(event) => {
              setLinkValue(event.target.value);
              if (linkError) setLinkError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                applyLink();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setLinkOpen(false);
                editor.commands.focus();
              }
            }}
          />
          {linkError ? (
            <p
              id={linkErrorId}
              className="mt-2 flex items-start gap-2 border-l-4 border-decorative-red pl-2 text-sm font-bold text-ink"
            >
              <span aria-hidden="true" className="text-decorative-red">&#9888;</span>
              <span>{linkError}</span>
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={TOOLBAR_CONTROL} onClick={applyLink}>
              Apply link
            </button>
            {state.link ? (
              <button
                type="button"
                className={TOOLBAR_CONTROL}
                onClick={() => {
                  editor.chain().focus().extendMarkRange("link").unsetLink().run();
                  setLinkOpen(false);
                }}
              >
                Remove link
              </button>
            ) : null}
            <button
              type="button"
              className={TOOLBAR_CONTROL}
              onClick={() => {
                setLinkOpen(false);
                setLinkError(null);
                editor.commands.focus();
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ToolbarButton({
  label,
  ariaLabel,
  active,
  disabled = false,
  onPress,
}: {
  label: string;
  ariaLabel?: string;
  active: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel ?? label}
      aria-pressed={active}
      disabled={disabled}
      className={`${TOOLBAR_CONTROL} ${ACTIVE_TOOLBAR_STATE}`}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onPress}
    >
      {label}
    </button>
  );
}

function setEditorInvalid(editor: Editor, invalid: boolean): void {
  if (invalid) {
    editor.view.dom.setAttribute("aria-invalid", "true");
  } else {
    editor.view.dom.removeAttribute("aria-invalid");
  }
}
