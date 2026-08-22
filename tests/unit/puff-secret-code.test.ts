import { describe, expect, it } from "vitest";

import {
  INITIAL_SECRET_CODE_STATE,
  INITIAL_LOGO_TAP_STATE,
  LOGO_TAP_TIMEOUT_MS,
  PUFF_LOGO_TAP_TARGET,
  PUFF_SECRET_SEQUENCE,
  SECRET_CODE_TIMEOUT_MS,
  advanceLogoTap,
  advanceSecretCode,
} from "@/lib/puff/secret-code";

function enterSequence(
  sequence: readonly string[],
  start = 100,
) {
  let state = { ...INITIAL_SECRET_CODE_STATE };
  let unlocked = false;

  for (const [index, code] of sequence.entries()) {
    const result = advanceSecretCode(state, {
      code,
      now: start + index * 100,
    });
    state = result.state;
    unlocked = result.unlocked;
  }

  return { state, unlocked };
}

describe("Puff secret code", () => {
  it("unlocks on the exact classic sequence", () => {
    const result = enterSequence(PUFF_SECRET_SEQUENCE);

    expect(result.unlocked).toBe(true);
    expect(result.state).toEqual(INITIAL_SECRET_CODE_STATE);
  });

  it("does not unlock from A, B, Enter alone", () => {
    expect(enterSequence(["KeyA", "KeyB", "Enter"]).unlocked).toBe(false);
  });

  it("lets a mismatched up-arrow begin an overlapping attempt", () => {
    const result = enterSequence([
      "ArrowUp",
      "ArrowUp",
      "ArrowDown",
      ...PUFF_SECRET_SEQUENCE,
    ]);

    expect(result.unlocked).toBe(true);
  });

  it("resets an attempt after the idle timeout", () => {
    const first = advanceSecretCode(INITIAL_SECRET_CODE_STATE, {
      code: "ArrowUp",
      now: 100,
    });
    const timedOut = advanceSecretCode(first.state, {
      code: "ArrowUp",
      now: 100 + SECRET_CODE_TIMEOUT_MS + 1,
    });

    expect(timedOut.state.progress).toBe(1);
    expect(timedOut.unlocked).toBe(false);
  });

  it("ignores repeats, shortcuts, composition, and editable targets", () => {
    const first = advanceSecretCode(INITIAL_SECRET_CODE_STATE, {
      code: "ArrowUp",
      now: 100,
    });

    for (const ignored of [
      { repeat: true },
      { ctrlKey: true },
      { altKey: true },
      { metaKey: true },
      { composing: true },
      { editable: true },
    ]) {
      const result = advanceSecretCode(first.state, {
        code: "ArrowDown",
        now: 200,
        ...ignored,
      });
      expect(result.state).toBe(first.state);
    }
  });

  it("allows shifted A and B because matching uses physical key codes", () => {
    let state = { ...INITIAL_SECRET_CODE_STATE };
    let unlocked = false;

    for (const [index, code] of PUFF_SECRET_SEQUENCE.entries()) {
      const result = advanceSecretCode(state, {
        code,
        now: index * 100,
      });
      state = result.state;
      unlocked = result.unlocked;
    }

    expect(unlocked).toBe(true);
  });

  it("unlocks after five quick HAM-logo taps", () => {
    let state = { ...INITIAL_LOGO_TAP_STATE };
    let unlocked = false;

    for (let index = 0; index < PUFF_LOGO_TAP_TARGET; index += 1) {
      const result = advanceLogoTap(state, 100 + index * 150);
      state = result.state;
      unlocked = result.unlocked;
    }

    expect(unlocked).toBe(true);
    expect(state).toEqual(INITIAL_LOGO_TAP_STATE);
  });

  it("restarts logo-tap progress after the idle timeout", () => {
    const first = advanceLogoTap(INITIAL_LOGO_TAP_STATE, 100);
    const timedOut = advanceLogoTap(
      first.state,
      100 + LOGO_TAP_TIMEOUT_MS + 1,
    );

    expect(timedOut).toEqual({
      state: { taps: 1, lastTapAt: 100 + LOGO_TAP_TIMEOUT_MS + 1 },
      unlocked: false,
    });
  });
});
