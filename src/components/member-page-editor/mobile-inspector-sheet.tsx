"use client";

import { useEffect, useRef } from "react";

import { EDITOR_QUIET_CONTROL } from "./editor-controls";
import { CloseIcon } from "./editor-icons";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export interface InspectorKeyboardEvent {
  key: string;
  shiftKey: boolean;
  target: EventTarget | null;
  preventDefault: () => void;
  stopPropagation: () => void;
}

/** Escape closes; Tab and Shift+Tab remain inside the modal sheet. */
export function handleInspectorDialogKeyDown(
  event: InspectorKeyboardEvent,
  dialog: Pick<HTMLElement, "querySelectorAll">,
  onClose: () => void,
): void {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    onClose();
    return;
  }
  if (event.key !== "Tab") return;

  const focusable = Array.from(
    dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((element) => element.getAttribute("aria-hidden") !== "true");
  if (focusable.length === 0) {
    event.preventDefault();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && event.target === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && event.target === last) {
    event.preventDefault();
    first.focus();
  }
}

/** Restores focus to the real invoker, or its stable replacement after render. */
export function focusInspectorReturnTarget(
  directTarget: Pick<HTMLElement, "focus" | "isConnected"> | null,
  fallbackTarget: Pick<HTMLElement, "focus"> | null,
): Pick<HTMLElement, "focus"> | null {
  const target = directTarget?.isConnected ? directTarget : fallbackTarget;
  target?.focus();
  return target;
}

export function MobileInspectorSheet({
  title,
  titleId,
  descriptionId,
  kicker = "Inspector",
  description = "Changes appear on the page as you type.",
  onClose,
  children,
}: {
  title: string;
  titleId: string;
  descriptionId: string;
  /** Overline above the title; names which sheet this is. */
  kicker?: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus());
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousBodyOverflow;
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/45 xl:hidden"
      data-mobile-inspector-backdrop="true"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        data-mobile-inspector-sheet="true"
        className="fixed inset-x-0 bottom-0 box-border w-full min-w-0 max-w-full overflow-x-hidden overflow-y-auto overscroll-contain border-x-0 border-t-2 border-ink bg-surface p-5 shadow-[0_-8px_0_0_var(--color-ink)] focus:outline-none sm:inset-x-4 sm:bottom-4 sm:w-auto sm:border-2"
        style={{
          maxHeight:
            "min(78dvh, calc(100dvh - max(1rem, env(safe-area-inset-top))))",
          paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))",
          scrollPaddingBottom: "max(6rem, env(safe-area-inset-bottom))",
        }}
        onKeyDown={(event) => {
          if (!dialogRef.current) return;
          handleInspectorDialogKeyDown(event, dialogRef.current, onClose);
        }}
        onFocusCapture={(event) => {
          const target = event.target;
          if (!(target instanceof HTMLElement)) return;
          requestAnimationFrame(() =>
            target.scrollIntoView({ block: "nearest", inline: "nearest" }),
          );
        }}
      >
        <div className="flex min-w-0 items-start justify-between gap-4 border-b-2 border-ink pb-4">
          <div className="min-w-0">
            <p className="text-[0.65rem] font-bold tracking-[0.18em] text-muted uppercase">
              {kicker}
            </p>
            <h3 id={titleId} className="font-display mt-1 text-2xl break-words">
              {title}
            </h3>
            <p id={descriptionId} className="mt-2 text-sm leading-relaxed text-muted">
              {description}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            className={`${EDITOR_QUIET_CONTROL} shrink-0`}
            aria-label={`Close ${title}`}
            onClick={onClose}
          >
            <CloseIcon />
            <span className="sr-only">Close</span>
          </button>
        </div>
        <div className="mt-5 min-w-0">{children}</div>
      </div>
    </div>
  );
}
