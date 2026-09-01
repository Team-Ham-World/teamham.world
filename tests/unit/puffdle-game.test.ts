import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import PuffdlePage from "@/app/puffdle/page";
import { PuffdleGame } from "@/components/puffdle/puffdle-game";
import { PuffdleMascot } from "@/components/puffdle/puffdle-mascot";
import { renderPuff } from "@/lib/puff/render";
import {
  calculatePuffdlePoints,
  createDefaultStats,
  createInitialPuffdleState,
  evaluateGuess,
  generateShareGrid,
  recordGameResult,
  submitGuess,
  updateKeyboardStatus,
} from "@/lib/puffdle/game";

describe("Puffdle game evaluation and mechanics", () => {
  it("evaluates exact matching words", () => {
    const result = evaluateGuess("SPEED", "SPEED");
    expect(result).toEqual(["correct", "correct", "correct", "correct", "correct"]);
  });

  it("evaluates words with no common letters", () => {
    const result = evaluateGuess("SPEED", "ABOUT");
    expect(result).toEqual(["absent", "absent", "absent", "absent", "absent"]);
  });

  it("handles duplicate letters accurately (target: SPEED, guess: ERASE)", () => {
    // Target: S(1), P(1), E(2), D(1)
    // Guess:  E  R  A  S  E
    // E at 0: present (1 remaining E)
    // R at 1: absent
    // A at 2: absent
    // S at 3: present (0 remaining S)
    // E at 4: present (0 remaining E)
    const result = evaluateGuess("SPEED", "ERASE");
    expect(result).toEqual(["present", "absent", "absent", "present", "present"]);
  });

  it("handles duplicate letters with exact matches taking precedence (target: SPEED, guess: GEESE)", () => {
    // Target: S P E E D
    // Guess:  G E E S E
    // Exact pass: pos 2 (E == E) -> correct, target E remaining = 1
    // Present pass:
    // pos 0: G -> absent
    // pos 1: E -> present (target E remaining becomes 0)
    // pos 3: S -> present (target S remaining becomes 0)
    // pos 4: E -> absent (no remaining E in target)
    const result = evaluateGuess("SPEED", "GEESE");
    expect(result).toEqual(["absent", "present", "correct", "present", "absent"]);
  });

  it("handles duplicate letters with multiple matches (target: ROBOT, guess: TOOTH)", () => {
    // Target: R O B O T
    // Guess:  T O O T H
    // Exact pass: pos 1 (O == O) -> correct, pos 3 (T != O)
    // Remaining counts: R:1, O:1, B:1, T:1
    // Present pass:
    // pos 0: T -> present (T remaining 0)
    // pos 2: O -> present (O remaining 0)
    // pos 3: T -> absent (T remaining 0)
    // pos 4: H -> absent
    const result = evaluateGuess("ROBOT", "TOOTH");
    expect(result).toEqual(["present", "correct", "present", "absent", "absent"]);
  });

  it("calculates correct Puffdle score points based on attempts", () => {
    expect(calculatePuffdlePoints(1)).toBe(600);
    expect(calculatePuffdlePoints(2)).toBe(500);
    expect(calculatePuffdlePoints(3)).toBe(400);
    expect(calculatePuffdlePoints(4)).toBe(300);
    expect(calculatePuffdlePoints(5)).toBe(200);
    expect(calculatePuffdlePoints(6)).toBe(100);
    expect(calculatePuffdlePoints(7)).toBe(0);
    expect(calculatePuffdlePoints(0)).toBe(0);
  });

  it("manages game state transitions from in-progress to won", () => {
    let state = createInitialPuffdleState("SPEED", "daily", 42);
    expect(state.status).toBe("IN_PROGRESS");
    expect(state.guesses).toHaveLength(0);

    const step1 = submitGuess(state, "CRANE");
    state = step1.state;
    expect(state.status).toBe("IN_PROGRESS");
    expect(state.guesses).toEqual(["CRANE"]);
    expect(state.evaluations).toHaveLength(1);

    const step2 = submitGuess(state, "SPEED");
    state = step2.state;
    expect(state.status).toBe("WON");
    expect(state.pointsEarned).toBe(500); // 2nd attempt
  });

  it("manages game state transition to lost after 6 failed attempts", () => {
    let state = createInitialPuffdleState("SPEED", "unlimited");
    for (let i = 0; i < 5; i += 1) {
      state = submitGuess(state, "CRANE").state;
      expect(state.status).toBe("IN_PROGRESS");
    }

    state = submitGuess(state, "FLICK").state;
    expect(state.status).toBe("LOST");
    expect(state.pointsEarned).toBe(0);
  });

  it("updates keyboard letter statuses with highest priority", () => {
    let kb: Record<string, "correct" | "present" | "absent"> = {};
    kb = updateKeyboardStatus(kb, "CRANE", ["absent", "present", "absent", "absent", "correct"]);
    expect(kb.C).toBe("absent");
    expect(kb.R).toBe("present");
    expect(kb.E).toBe("correct");

    // Upgrade 'present' to 'correct' if found later
    kb = updateKeyboardStatus(kb, "RIVER", ["correct", "absent", "absent", "correct", "absent"]);
    expect(kb.R).toBe("correct");
  });

  it("updates and records player statistics", () => {
    let stats = createDefaultStats();
    stats = recordGameResult(stats, true, 3);
    expect(stats.gamesPlayed).toBe(1);
    expect(stats.gamesWon).toBe(1);
    expect(stats.currentStreak).toBe(1);
    expect(stats.maxStreak).toBe(1);
    expect(stats.guessDistribution[3]).toBe(1);

    // Lost game resets current streak
    stats = recordGameResult(stats, false, 6);
    expect(stats.gamesPlayed).toBe(2);
    expect(stats.gamesWon).toBe(1);
    expect(stats.currentStreak).toBe(0);
    expect(stats.maxStreak).toBe(1);
  });

  it("generates spoiler-free emoji share text", () => {
    let state = createInitialPuffdleState("SPEED", "daily", 12);
    state = submitGuess(state, "CRANE").state;
    state = submitGuess(state, "SPEED").state;

    const shareText = generateShareGrid(state);
    expect(shareText).toContain("PUFFDLE #12 2/6");
    expect(shareText).toContain("🟩");
    expect(shareText).not.toContain("SPEED");
    expect(shareText).not.toContain("CRANE");
    expect(shareText).toContain("https://teamham.world/puffdle");
  });

  it("renders mascot ASCII frames correctly", () => {
    const frame = renderPuff(
      36,
      26,
      0.6 / 0.74,
      { time: 1.2, bob: 0, squash: 0, blink: 1, gazeX: -0.04, gazeY: 0.02 },
      { yaw: -0.22, pitch: 0.04 },
    );
    expect(frame.ink.split("\n")).toHaveLength(26);
    expect(frame.accent.split("\n")).toHaveLength(26);
    expect(frame.ink.length).toBeGreaterThan(500);
  });

  it("renders PuffdlePage without duplicate SiteNav header", () => {
    const html = renderToStaticMarkup(React.createElement(PuffdlePage));
    // PuffdlePage should not render its own SiteNav because RootLayout renders it globally
    expect(html).not.toContain('data-puff-launcher="true"');
    expect(html).toContain("PUFFDLE");
    expect(html).toContain("DAILY PUFFDLE");
    expect(html).toContain("PUFFDLE UNLIMITED");
  });

  it("renders PuffdleGame with upgraded tactile board and live ASCII mascot companion", () => {
    const html = renderToStaticMarkup(React.createElement(PuffdleGame));
    expect(html).toContain('aria-label="Wordle guess board"');
    expect(html).toContain('aria-label="Virtual keyboard"');
    expect(html).toContain('aria-label="Puff Companion live mascot readout"');
    expect(html).toContain("PUFF://COMPANION_V1");
    expect(html).toContain("MONITORING");
    expect(html).toContain("RULES");
    expect(html).toContain("STATS");
    expect(html).toContain("RANKS");
  });

  it("renders PuffdleMascot with stacked ink and accent character layers", () => {
    const state = createInitialPuffdleState("SPEED", "daily", 1);
    const stats = createDefaultStats();
    const html = renderToStaticMarkup(
      React.createElement(PuffdleMascot, {
        gameState: state,
        stats,
        isShaking: false,
      }),
    );
    expect(html).toContain("asciiLayerInk");
    expect(html).toContain("asciiLayerAccent");
    expect(html).toContain("PUFF SAYS:");
    expect(html).toContain("SOLVED");
    expect(html).toContain("STREAK");
  });
});
