"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { PuffGame } from "@/components/puff-game";
import { PuffScene } from "@/components/puff-scene";
import styles from "@/components/puff-experience.module.css";
import {
  INITIAL_LOGO_TAP_STATE,
  INITIAL_SECRET_CODE_STATE,
  LOGO_TAP_TIMEOUT_MS,
  PUFF_LOGO_TAP_TARGET,
  advanceLogoTap,
  advanceSecretCode,
  type LogoTapState,
  type SecretCodeInput,
  type SecretCodeState,
} from "@/lib/puff/secret-code";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName;
  return (
    target.isContentEditable ||
    tagName === "INPUT" ||
    tagName === "TEXTAREA" ||
    tagName === "SELECT"
  );
}

function restorePagePosition(position: { x: number; y: number }): void {
  window.scrollTo(position.x, position.y);
  /* Root assignments cover engines that defer scrollTo around top-layer
     dialog transitions. */
  document.documentElement.scrollLeft = position.x;
  document.documentElement.scrollTop = position.y;
}

/**
 * The complete Puff client island: live mascot, secret-code discovery, and
 * the modal game. The home page only places this module; it never needs to
 * learn the experience's internal states.
 */
export function PuffExperience({
  anchorId,
  className,
}: {
  anchorId: string;
  className?: string;
}) {
  const secretStateRef = useRef<SecretCodeState>({
    ...INITIAL_SECRET_CODE_STATE,
  });
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const scrollOriginRef = useRef({ x: 0, y: 0 });
  const logoTapStateRef = useRef<LogoTapState>({ ...INITIAL_LOGO_TAP_STATE });
  const logoTapTimerRef = useRef(0);
  const [gameOpen, setGameOpen] = useState(false);
  const [logoTapProgress, setLogoTapProgress] = useState(0);

  const openGame = useCallback(() => {
    restorePagePosition(scrollOriginRef.current);
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setLogoTapProgress(0);
    setGameOpen(true);
  }, []);

  const enterSecretInput = useCallback(
    (input: SecretCodeInput) => {
      if (gameOpen) return null;

      const result = advanceSecretCode(secretStateRef.current, input);
      secretStateRef.current = result.state;
      if (result.unlocked) openGame();
      return result;
    },
    [gameOpen, openGame],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (gameOpen) return;

      if (
        secretStateRef.current.progress === 0 &&
        event.code === "ArrowUp"
      ) {
        scrollOriginRef.current = { x: window.scrollX, y: window.scrollY };
      }

      const result = enterSecretInput({
        code: event.code,
        now: performance.now(),
        repeat: event.repeat,
        composing: event.isComposing,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        editable: isEditableTarget(event.target),
      });
      if (!result) return;

      /* One up-arrow remains ordinary navigation. Once the distinctive
         double-up prefix is recognized, keep the remaining arrows from
         walking the page away underneath the visitor. */
      if (
        event.code.startsWith("Arrow") &&
        result.state.progress >= 2
      ) {
        event.preventDefault();
      }

      if (result.unlocked) {
        /* Capture phase gets here before a focused link can consume Enter. */
        event.preventDefault();
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [enterSecretInput, gameOpen]);

  useEffect(() => {
    const launcher = document.querySelector<HTMLElement>(
      "[data-puff-launcher]",
    );
    if (!launcher || gameOpen) return;

    const resetLogoTaps = () => {
      window.clearTimeout(logoTapTimerRef.current);
      logoTapStateRef.current = { ...INITIAL_LOGO_TAP_STATE };
      setLogoTapProgress(0);
      launcher.style.removeProperty("--puff-tap-progress");
    };

    const onLogoClick = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (logoTapStateRef.current.taps === 0) {
        scrollOriginRef.current = { x: window.scrollX, y: window.scrollY };
      }

      const result = advanceLogoTap(
        logoTapStateRef.current,
        performance.now(),
      );
      logoTapStateRef.current = result.state;

      if (result.unlocked) {
        resetLogoTaps();
        openGame();
        return;
      }

      setLogoTapProgress(result.state.taps);
      launcher.style.setProperty(
        "--puff-tap-progress",
        String(result.state.taps / PUFF_LOGO_TAP_TARGET),
      );
      window.clearTimeout(logoTapTimerRef.current);
      logoTapTimerRef.current = window.setTimeout(
        resetLogoTaps,
        LOGO_TAP_TIMEOUT_MS,
      );
    };

    launcher.addEventListener("click", onLogoClick, true);
    return () => {
      launcher.removeEventListener("click", onLogoClick, true);
      resetLogoTaps();
    };
  }, [gameOpen, openGame]);

  const closeGame = useCallback(() => {
    /* PuffGame releases its body scroll lock before calling this handler. */
    restorePagePosition(scrollOriginRef.current);
    setGameOpen(false);
    setLogoTapProgress(0);
    logoTapStateRef.current = { ...INITIAL_LOGO_TAP_STATE };
    secretStateRef.current = { ...INITIAL_SECRET_CODE_STATE };
    requestAnimationFrame(() => {
      restorePagePosition(scrollOriginRef.current);
      previousFocusRef.current?.focus();
    });
  }, []);

  return (
    <>
      <PuffScene
        anchorId={anchorId}
        className={className}
        suspended={gameOpen}
      />
      {logoTapProgress > 0 && !gameOpen && (
        <div className={styles.logoTapHint} role="status" aria-live="polite">
          Puff signal {logoTapProgress}/{PUFF_LOGO_TAP_TARGET}
        </div>
      )}
      {gameOpen && <PuffGame onExit={closeGame} />}
    </>
  );
}
