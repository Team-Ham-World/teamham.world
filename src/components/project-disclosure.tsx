"use client";

import { useState, useSyncExternalStore } from "react";

interface ProjectDisclosureProps {
  /** Project slug — the deep-link target and the ID namespace for this pair. */
  slug: string;
  /** Visible trigger label. */
  label: string;
  /** Server-rendered panel content. Never pass an empty node — see the gate. */
  children: React.ReactNode;
}

function subscribeToHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

/**
 * Accessible expansion control for one shelf entry.
 *
 * It receives serializable props plus server-rendered children, so the details
 * markup stays out of the JS bundle.
 *
 * Rendering is gated by `hasExpandableContent` in the shelf — this component
 * assumes it has something to show.
 */
export function ProjectDisclosure({
  slug,
  label,
  children,
}: ProjectDisclosureProps) {
  // The URL hash is an external store, so it is read rather than copied into
  // state. The server snapshot is always `false`: there is no hash on the
  // server, and hydrating collapsed keeps the two renders identical.
  const hashMatchesSlug = useSyncExternalStore(
    subscribeToHash,
    () => window.location.hash === `#${slug}`,
    () => false,
  );

  // Null until the visitor touches the trigger, at which point their choice
  // takes over from the deep link.
  const [toggled, setToggled] = useState<boolean | null>(null);
  const open = toggled ?? hashMatchesSlug;

  const triggerId = `${slug}-disclosure-trigger`;
  const panelId = `${slug}-disclosure-panel`;

  function toggle() {
    const next = !open;
    setToggled(next);

    // The hash reflects the most recently opened item. `replaceState` adds no
    // history entry and never scrolls, so the trigger keeps focus and the page
    // does not jump.
    if (next) {
      window.history.replaceState(null, "", `#${slug}`);
    } else if (window.location.hash === `#${slug}`) {
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
    }
  }

  return (
    <>
      <button
        type="button"
        id={triggerId}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
        className="mt-5 inline-flex cursor-pointer items-center gap-2 border-2 border-ink bg-surface px-3 py-1.5 text-sm font-bold tracking-wide text-interactive-blue transition-colors hover:bg-ink hover:text-paper"
      >
        <span
          aria-hidden="true"
          className={`inline-block text-xs transition-transform duration-200 ${
            open ? "rotate-90" : ""
          }`}
        >
          &#9656;
        </span>
        {label}
      </button>

      {/*
        The panel expands instantly.

        An animated 0fr -> 1fr grid expansion was tried and rejected: when the
        deep-link hash flips the state during hydration, the transition never
        settles and the row stays at 0px, leaving a panel that reports itself
        expanded to assistive tech while being invisible. `hidden` has no such
        failure mode, and it keeps collapsed content out of both the
        accessibility tree and the tab order without a second mechanism.
      */}
      <div
        id={panelId}
        role="region"
        aria-labelledby={triggerId}
        hidden={!open}
        className="pt-4"
      >
        {children}
      </div>
    </>
  );
}
