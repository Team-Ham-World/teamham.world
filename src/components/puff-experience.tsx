"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

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

/**
 * The complete homepage Puff client island: live mascot and secret-code
 * discovery. The home page only places this module; it never needs to learn
 * the experience's internal states.
 */
export function PuffExperience({
  anchorId,
  className,
}: {
  anchorId: string;
  className?: string;
}) {
  const router = useRouter();
  const secretStateRef = useRef<SecretCodeState>({
    ...INITIAL_SECRET_CODE_STATE,
  });
  const logoTapStateRef = useRef<LogoTapState>({ ...INITIAL_LOGO_TAP_STATE });
  const logoTapTimerRef = useRef(0);
  const [logoTapProgress, setLogoTapProgress] = useState(0);

  const openPuffcade = useCallback(() => {
    setLogoTapProgress(0);
    router.push("/puffcade");
  }, [router]);

  const enterSecretInput = useCallback(
    (input: SecretCodeInput) => {
      const result = advanceSecretCode(secretStateRef.current, input);
      secretStateRef.current = result.state;
      if (result.unlocked) openPuffcade();
      return result;
    },
    [openPuffcade],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
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
  }, [enterSecretInput]);

  useEffect(() => {
    const launcher = document.querySelector<HTMLElement>(
      "[data-puff-launcher]",
    );
    if (!launcher) return;

    const resetLogoTaps = () => {
      window.clearTimeout(logoTapTimerRef.current);
      logoTapStateRef.current = { ...INITIAL_LOGO_TAP_STATE };
      setLogoTapProgress(0);
      launcher.style.removeProperty("--puff-tap-progress");
    };

    const onLogoClick = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();

      const result = advanceLogoTap(
        logoTapStateRef.current,
        performance.now(),
      );
      logoTapStateRef.current = result.state;

      if (result.unlocked) {
        resetLogoTaps();
        openPuffcade();
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
  }, [openPuffcade]);

  return (
    <>
      <PuffScene anchorId={anchorId} className={className} />
      {logoTapProgress > 0 && (
        <div className={styles.logoTapHint} role="status" aria-live="polite">
          Puff signal {logoTapProgress}/{PUFF_LOGO_TAP_TARGET}
        </div>
      )}
    </>
  );
}
