export const PUFF_SECRET_SEQUENCE = [
  "ArrowUp",
  "ArrowUp",
  "ArrowDown",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowLeft",
  "ArrowRight",
  "KeyA",
  "KeyB",
  "Enter",
] as const;

export const SECRET_CODE_TIMEOUT_MS = 8000;
export const PUFF_LOGO_TAP_TARGET = 5;
export const LOGO_TAP_TIMEOUT_MS = 1800;

export interface SecretCodeState {
  progress: number;
  lastMatchAt: number;
}

export interface SecretCodeInput {
  code: string;
  now: number;
  repeat?: boolean;
  composing?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  editable?: boolean;
}

export interface SecretCodeResult {
  state: SecretCodeState;
  unlocked: boolean;
}

export interface LogoTapState {
  taps: number;
  lastTapAt: number;
}

export interface LogoTapResult {
  state: LogoTapState;
  unlocked: boolean;
}

export const INITIAL_SECRET_CODE_STATE: SecretCodeState = {
  progress: 0,
  lastMatchAt: 0,
};

export const INITIAL_LOGO_TAP_STATE: LogoTapState = {
  taps: 0,
  lastTapAt: 0,
};

/** Advance the mobile-friendly five-tap HAM-logo activation. */
export function advanceLogoTap(
  current: LogoTapState,
  now: number,
): LogoTapResult {
  const timedOut =
    current.taps > 0 && now - current.lastTapAt > LOGO_TAP_TIMEOUT_MS;
  const taps = (timedOut ? 0 : current.taps) + 1;

  if (taps >= PUFF_LOGO_TAP_TARGET) {
    return { state: { ...INITIAL_LOGO_TAP_STATE }, unlocked: true };
  }

  return { state: { taps, lastTapAt: now }, unlocked: false };
}

/**
 * Advance the classic code without involving the DOM.
 *
 * Shift is deliberately allowed: `KeyboardEvent.code` stays `KeyA`/`KeyB`
 * for both lower- and uppercase input, so either version does what a visitor
 * expects. Control, alt, and command shortcuts are ignored entirely.
 */
export function advanceSecretCode(
  current: SecretCodeState,
  input: SecretCodeInput,
): SecretCodeResult {
  if (
    input.repeat ||
    input.composing ||
    input.altKey ||
    input.ctrlKey ||
    input.metaKey ||
    input.editable
  ) {
    return { state: current, unlocked: false };
  }

  const timedOut =
    current.progress > 0 &&
    input.now - current.lastMatchAt > SECRET_CODE_TIMEOUT_MS;
  const progress = timedOut ? 0 : current.progress;
  const expected = PUFF_SECRET_SEQUENCE[progress];

  if (input.code === expected) {
    const nextProgress = progress + 1;
    if (nextProgress === PUFF_SECRET_SEQUENCE.length) {
      return {
        state: { ...INITIAL_SECRET_CODE_STATE },
        unlocked: true,
      };
    }

    return {
      state: { progress: nextProgress, lastMatchAt: input.now },
      unlocked: false,
    };
  }

  /* A fresh up-arrow can be both the mismatch and the start of another try. */
  if (input.code === PUFF_SECRET_SEQUENCE[0]) {
    return {
      state: { progress: 1, lastMatchAt: input.now },
      unlocked: false,
    };
  }

  return {
    state: { ...INITIAL_SECRET_CODE_STATE },
    unlocked: false,
  };
}
