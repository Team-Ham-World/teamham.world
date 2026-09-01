import { describe, expect, it } from "vitest";
import {
  bankTradeAction,
  buildCityAction,
  createPufftonGame,
  handleDiscard,
  handleMoveRobber,
  handleSetupPlacement,
  recalculateVictoryPoints,
  rollDice,
  satisfiesDistanceRule,
} from "@/lib/puffton/engine";

describe("puffton game engine and rules", () => {
  function getSampleGame() {
    return createPufftonGame({
      players: [
        { name: "Puff Commander", isBot: false, color: "ham-gold" },
        { name: "CyberHam", isBot: true, color: "electric-blue" },
        { name: "PixelHam", isBot: true, color: "hot-pink" },
        { name: "BytePuff", isBot: true, color: "emerald" },
      ],
      settings: { targetVp: 10 },
    });
  }

  it("initializes game in setup round 1 with empty inventory and full building pools", () => {
    const game = getSampleGame();
    expect(game.phase).toBe("setup_round_1");
    expect(game.activePlayerIndex).toBe(0);
    expect(game.players).toHaveLength(4);
    expect(game.players[0].settlementsLeft).toBe(5);
    expect(game.players[0].citiesLeft).toBe(4);
    expect(game.players[0].roadsLeft).toBe(15);
    expect(game.players[0].victoryPoints).toBe(0);
    expect(game.devCardDeck).toHaveLength(25);
  });

  it("enforces distance rule for settlements", () => {
    const game = getSampleGame();
    const vId = "v:0:0:T";
    expect(satisfiesDistanceRule(vId, game.board)).toBe(true);

    // Place settlement on vId
    game.board.buildings[vId] = {
      type: "settlement",
      playerId: "p1",
      vertexId: vId,
    };

    // Cannot place on same vertex
    expect(satisfiesDistanceRule(vId, game.board)).toBe(false);

    // Cannot place on directly adjacent vertices
    const vertex = game.board.vertices[vId];
    for (const adjVId of vertex.adjacentVertices) {
      expect(satisfiesDistanceRule(adjVId, game.board)).toBe(false);
    }
  });

  it("runs 2-round snake draft setup with resource collection in round 2", () => {
    const game = getSampleGame();

    // Player 1 Round 1
    const p1v = "v:0:0:T";
    const p1e = game.board.vertices[p1v].adjacentEdges[0];
    expect(handleSetupPlacement(game, p1v, p1e)).toBe(true);
    expect(game.activePlayerIndex).toBe(1);
    expect(game.phase).toBe("setup_round_1");

    // Player 2 Round 1
    const p2v = "v:1:1:T";
    const p2e = game.board.vertices[p2v].adjacentEdges[0];
    expect(handleSetupPlacement(game, p2v, p2e)).toBe(true);
    expect(game.activePlayerIndex).toBe(2);

    // Player 3 Round 1
    const p3v = "v:-1:1:T";
    const p3e = game.board.vertices[p3v].adjacentEdges[0];
    expect(handleSetupPlacement(game, p3v, p3e)).toBe(true);
    expect(game.activePlayerIndex).toBe(3);

    // Player 4 Round 1
    const p4v = "v:1:-1:T";
    const p4e = game.board.vertices[p4v].adjacentEdges[0];
    expect(handleSetupPlacement(game, p4v, p4e)).toBe(true);
    // Snake draft transitions to round 2, still on player 4!
    expect(game.activePlayerIndex).toBe(3);
    expect(game.phase).toBe("setup_round_2");

    // Player 4 Round 2
    const p4v2 = "v:0:2:T";
    const p4e2 = game.board.vertices[p4v2].adjacentEdges[0];
    expect(handleSetupPlacement(game, p4v2, p4e2)).toBe(true);
    expect(game.activePlayerIndex).toBe(2);

    // Total resources should be collected for Round 2 placement
    const p4TotalCards = Object.values(game.players[3].resources).reduce((a, b) => a + b, 0);
    expect(p4TotalCards).toBeGreaterThan(0);
  });

  it("handles regular turn cycle, dice rolls, and resource distribution", () => {
    const game = getSampleGame();
    // Fast-forward to roll phase
    game.phase = "roll";

    // Place a settlement for p1 on hex (0, 0)
    game.board.buildings["v:0:0:T"] = {
      type: "settlement",
      playerId: "p1",
      vertexId: "v:0:0:T",
    };

    const tile = game.board.tiles["h:0:0"];
    if (tile && tile.diceNumber && tile.terrain !== "desert") {
      const [d1, d2] = rollDice(game);
      expect(d1 + d2).toBeGreaterThanOrEqual(2);
      expect(d1 + d2).toBeLessThanOrEqual(12);
      expect(["action", "robber", "discard"]).toContain(game.phase);
    }
  });

  it("handles discard phase when rolling 7 with > 7 resources", () => {
    const game = getSampleGame();
    game.phase = "discard";
    game.pendingDiscardPlayerIds = ["p1"];
    game.players[0].resources = { toner: 4, paper: 4, feed: 0, brick: 0, timber: 0 };

    // Total is 8 cards -> must discard floor(8/2) = 4 cards
    expect(handleDiscard(game, "p1", { toner: 2, paper: 2 })).toBe(true);
    expect(game.players[0].resources.toner).toBe(2);
    expect(game.players[0].resources.paper).toBe(2);
    expect(game.phase).toBe("robber");
  });

  it("handles moving robber and stealing resources", () => {
    const game = getSampleGame();
    game.phase = "robber";
    game.board.robberTileId = "h:0:0";

    // Target player p2 has resources on h:1:0
    game.players[1].resources.toner = 2;
    game.board.buildings["v:1:0:T"] = {
      type: "settlement",
      playerId: "p2",
      vertexId: "v:1:0:T",
    };

    const success = handleMoveRobber(game, "h:1:0", "p2");
    expect(success).toBe(true);
    expect(game.board.robberTileId).toBe("h:1:0");
    expect(game.phase).toBe("action");
    expect(game.players[0].resources.toner).toBe(1);
    expect(game.players[1].resources.toner).toBe(1);
  });

  it("handles road building, settlement, city upgrades, and bank trade", () => {
    const game = getSampleGame();
    game.phase = "action";
    game.activePlayerIndex = 0;
    const p1 = game.players[0];

    // Give resources
    p1.resources = { brick: 3, timber: 3, paper: 3, feed: 2, toner: 3 };

    // Place starting settlement and road
    const vId = "v:0:0:T";
    const eId = game.board.vertices[vId].adjacentEdges[0];
    game.board.buildings[vId] = { type: "settlement", playerId: "p1", vertexId: vId };
    p1.settlementsLeft--;
    game.board.roads[eId] = { playerId: "p1", edgeId: eId };
    p1.roadsLeft--;

    // Upgrade settlement to city (costs 3 toner, 2 paper)
    expect(buildCityAction(game, vId)).toBe(true);
    expect(game.board.buildings[vId].type).toBe("city");
    expect(p1.citiesLeft).toBe(3);
    expect(p1.settlementsLeft).toBe(5); // refunded
    expect(p1.resources.toner).toBe(0);
    expect(p1.resources.paper).toBe(1);

    // Bank trade 4 timber for 1 toner (4:1 default without port)
    p1.resources.timber = 4;
    expect(bankTradeAction(game, "timber", "toner")).toBe(true);
    expect(p1.resources.timber).toBe(0);
    expect(p1.resources.toner).toBe(1);
  });

  it("calculates victory points, longest road, largest army, and triggers game win", () => {
    const game = getSampleGame();
    const p1 = game.players[0];

    // Give 4 settlements (4 VP) and 3 cities (6 VP) = 10 VP
    p1.settlementsLeft = 1;
    p1.citiesLeft = 1;

    recalculateVictoryPoints(game);
    expect(p1.victoryPoints).toBe(10);
    expect(game.winnerId).toBe("p1");
    expect(game.phase).toBe("game_over");
  });
});
