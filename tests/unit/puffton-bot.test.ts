import { describe, expect, it } from "vitest";
import {
  findBestSetupVertex,
  getDicePips,
  scoreVertex,
  stepBot,
} from "@/lib/puffton/bot";
import { createPufftonGame } from "@/lib/puffton/engine";

describe("puffton bot AI", () => {
  it("calculates dice pip weights correctly", () => {
    expect(getDicePips(null)).toBe(0);
    expect(getDicePips(7)).toBe(0);
    expect(getDicePips(6)).toBe(5);
    expect(getDicePips(8)).toBe(5);
    expect(getDicePips(5)).toBe(4);
    expect(getDicePips(9)).toBe(4);
    expect(getDicePips(2)).toBe(1);
    expect(getDicePips(12)).toBe(1);
  });

  it("finds optimal setup placement with high pips and resource diversity", () => {
    const game = createPufftonGame({
      players: [
        { name: "Bot Alpha", isBot: true, color: "ham-gold" },
        { name: "Bot Beta", isBot: true, color: "electric-blue" },
      ],
    });

    const bestPlacement = findBestSetupVertex(game, game.players[0]);
    expect(bestPlacement).not.toBeNull();
    expect(bestPlacement?.vertexId).toBeTruthy();
    expect(bestPlacement?.edgeId).toBeTruthy();

    const vertex = game.board.vertices[bestPlacement!.vertexId];
    expect(vertex).toBeDefined();
    const score = scoreVertex(vertex, game.board, game.players[0], "hard");
    expect(score).toBeGreaterThan(0);
  });

  it("executes bot turns autonomously through setup, roll, and action phases", () => {
    const game = createPufftonGame({
      players: [
        { name: "Bot 1", isBot: true, color: "ham-gold" },
        { name: "Bot 2", isBot: true, color: "electric-blue" },
      ],
    });

    // Step through round 1 setup for Bot 1 & Bot 2
    expect(stepBot(game)).toBe(true);
    expect(game.activePlayerIndex).toBe(1);
    expect(stepBot(game)).toBe(true);
    // Reverse draft round 2 setup for Bot 2 & Bot 1
    expect(game.activePlayerIndex).toBe(1);
    expect(game.phase).toBe("setup_round_2");
    expect(stepBot(game)).toBe(true);
    expect(game.activePlayerIndex).toBe(0);
    expect(stepBot(game)).toBe(true);

    // Regular game began!
    expect(game.phase).toBe("roll");
    expect(game.turnNumber).toBe(1);

    // Bot 1 rolls
    expect(stepBot(game)).toBe(true);
    expect(game.lastDiceRoll).not.toBeNull();
  });
});
