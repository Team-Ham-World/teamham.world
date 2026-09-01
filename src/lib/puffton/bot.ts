import {
  bankTradeAction,
  buildCityAction,
  buildRoadAction,
  buildSettlementAction,
  buyDevCardAction,
  endTurnAction,
  getPlayerBestTradeRatio,
  handleDiscard,
  handleMoveRobber,
  handleSetupPlacement,
  playDevCardAction,
  rollDice,
  satisfiesDistanceRule,
} from "./engine";
import {
  ALL_RESOURCES,
  BUILDING_COSTS,
  type BoardState,
  type Player,
  type PufftonGameState,
  type ResourceType,
  type Vertex,
} from "./types";

/**
 * AI Bot Logic for Puffton with 3 difficulty levels: Easy, Medium, Hard.
 */

// Calculates pip value of a dice number (e.g. 6 & 8 have 5 pips, 2 & 12 have 1 pip)
export function getDicePips(num: number | null): number {
  if (!num || num === 7) return 0;
  return 6 - Math.abs(7 - num);
}

/**
 * Rates a vertex for setup placement.
 */
export function scoreVertex(
  vertex: Vertex,
  board: BoardState,
  bot: Player,
  difficulty: "easy" | "medium" | "hard" = "medium",
): number {
  if (!satisfiesDistanceRule(vertex.id, board)) return -1;

  let totalPips = 0;
  const uniqueResources = new Set<ResourceType>();

  for (const hexId of vertex.adjacentHexes) {
    const tile = board.tiles[hexId];
    if (tile && tile.terrain !== "desert" && tile.terrain !== "ocean") {
      const pips = getDicePips(tile.diceNumber);
      totalPips += pips;
      uniqueResources.add(tile.terrain);
    }
  }

  if (difficulty === "easy") {
    return totalPips + Math.random() * 5;
  }

  // Medium & Hard: weight pips, diversity, port presence
  let score = totalPips * 10 + uniqueResources.size * 15;

  if (vertex.port) {
    score += vertex.port.type === "three_to_one" ? 8 : 12;
  }

  if (difficulty === "hard") {
    // Favor brick and timber for early expansion, or toner and paper for city development
    for (const res of uniqueResources) {
      if (res === "brick" || res === "timber") score += 5;
    }
  }

  return score;
}

/**
 * Finds best vertex for setup placement.
 */
export function findBestSetupVertex(
  state: PufftonGameState,
  bot: Player,
): { vertexId: string; edgeId: string } | null {
  const vertices = Object.values(state.board.vertices);
  let bestScore = -1;
  let bestVertex: Vertex | null = null;

  for (const v of vertices) {
    const score = scoreVertex(v, state.board, bot, bot.botDifficulty);
    if (score > bestScore) {
      bestScore = score;
      bestVertex = v;
    }
  }

  if (!bestVertex) return null;

  // Pick edge from this vertex that points towards center or best adjacent tile
  let bestEdgeId = bestVertex.adjacentEdges[0];
  let maxEdgeValue = -1;

  for (const eId of bestVertex.adjacentEdges) {
    const edge = state.board.edges[eId];
    if (edge) {
      const otherVId = edge.vertex1 === bestVertex.id ? edge.vertex2 : edge.vertex1;
      const otherV = state.board.vertices[otherVId];
      if (otherV) {
        const val = scoreVertex(otherV, state.board, bot, "easy");
        if (val > maxEdgeValue) {
          maxEdgeValue = val;
          bestEdgeId = eId;
        }
      }
    }
  }

  return { vertexId: bestVertex.id, edgeId: bestEdgeId };
}

/**
 * Automates discarding cards for a bot when 7 is rolled.
 */
export function botAutoDiscard(state: PufftonGameState, botId: string): boolean {
  const bot = state.players.find((p) => p.id === botId);
  if (!bot) return false;

  const totalCards = Object.values(bot.resources).reduce((sum, n) => sum + n, 0);
  let needed = Math.floor(totalCards / 2);
  const discard: Partial<Record<ResourceType, number>> = {};

  const tempRes = { ...bot.resources };

  // Discard resources that are most plentiful first
  while (needed > 0) {
    let maxRes: ResourceType = "timber";
    let maxCount = -1;

    for (const r of ALL_RESOURCES) {
      if ((tempRes[r] || 0) > maxCount) {
        maxCount = tempRes[r] || 0;
        maxRes = r;
      }
    }

    if (maxCount <= 0) break;

    tempRes[maxRes]--;
    discard[maxRes] = (discard[maxRes] || 0) + 1;
    needed--;
  }

  return handleDiscard(state, botId, discard);
}

/**
 * Bot picks tile to place robber and player to steal from.
 */
export function botPickRobberTarget(
  state: PufftonGameState,
  bot: Player,
): { tileId: string; targetPlayerId?: string } {
  // Find tiles owned by leading opponents
  const leadingOpponent = state.players
    .filter((p) => p.id !== bot.id)
    .sort((a, b) => b.victoryPoints - a.victoryPoints)[0];

  let bestTileId = "";
  let highestScore = -1;
  let targetPlayerId: string | undefined;

  for (const tile of Object.values(state.board.tiles)) {
    if (tile.id === state.board.robberTileId || tile.terrain === "desert" || tile.terrain === "ocean") {
      continue;
    }

    // Check if bot has buildings on this tile
    const tileVerts = [
      `v:${tile.q}:${tile.r}:T`,
      `v:${tile.q + 1}:${tile.r - 1}:B`,
      `v:${tile.q + 1}:${tile.r}:T`,
      `v:${tile.q}:${tile.r}:B`,
      `v:${tile.q}:${tile.r + 1}:T`,
      `v:${tile.q - 1}:${tile.r}:B`,
    ];

    let botHasBuilding = false;
    let leadingPlayerHasBuilding = false;
    const enemyPlayerIds: string[] = [];

    for (const vId of tileVerts) {
      const b = state.board.buildings[vId];
      if (b) {
        if (b.playerId === bot.id) botHasBuilding = true;
        if (leadingOpponent && b.playerId === leadingOpponent.id) leadingPlayerHasBuilding = true;
        if (b.playerId !== bot.id && !enemyPlayerIds.includes(b.playerId)) {
          enemyPlayerIds.push(b.playerId);
        }
      }
    }

    if (botHasBuilding) continue; // Don't block self

    const pips = getDicePips(tile.diceNumber);
    let tileScore = pips * 5;
    if (leadingPlayerHasBuilding) tileScore += 30;
    tileScore += enemyPlayerIds.length * 10;

    if (tileScore > highestScore) {
      highestScore = tileScore;
      bestTileId = tile.id;
      targetPlayerId = leadingPlayerHasBuilding
        ? leadingOpponent?.id
        : enemyPlayerIds[0];
    }
  }

  if (!bestTileId) {
    // Fallback: pick any non-desert tile
    const candidate = Object.values(state.board.tiles).find(
      (t) => t.id !== state.board.robberTileId && t.terrain !== "ocean",
    );
    bestTileId = candidate?.id || state.board.robberTileId;
  }

  return { tileId: bestTileId, targetPlayerId };
}

/**
 * Step function to execute one phase or full turn for a bot player.
 */
export function stepBot(state: PufftonGameState): boolean {
  const bot = state.players[state.activePlayerIndex];
  if (!bot || !bot.isBot) return false;

  // Handle Setup
  if (state.phase === "setup_round_1" || state.phase === "setup_round_2") {
    const placement = findBestSetupVertex(state, bot);
    if (placement) {
      return handleSetupPlacement(state, placement.vertexId, placement.edgeId);
    }
    return false;
  }

  // Handle Roll
  if (state.phase === "roll") {
    rollDice(state);
    return true;
  }

  // Handle Discard
  if (state.phase === "discard") {
    for (const pId of state.pendingDiscardPlayerIds) {
      const p = state.players.find((pl) => pl.id === pId);
      if (p && p.isBot) {
        botAutoDiscard(state, p.id);
      }
    }
    return true;
  }

  // Handle Robber
  if (state.phase === "robber") {
    const target = botPickRobberTarget(state, bot);
    return handleMoveRobber(state, target.tileId, target.targetPlayerId);
  }

  // Handle Action Phase
  if (state.phase === "action") {
    // 1. Play Dev Cards if beneficial
    const playableKnight = bot.devCards.find(
      (c) => c.type === "knight" && !c.played && c.boughtTurn < state.turnNumber,
    );
    if (playableKnight && !state.activeDevCardThisTurn) {
      // Check if robber is on one of bot's high pip hexes
      const currentRobberTile = state.board.tiles[state.board.robberTileId];
      if (currentRobberTile) {
        playDevCardAction(state, playableKnight.id);
        return true;
      }
    }

    const playableSurplus = bot.devCards.find(
      (c) => c.type === "year_of_plenty" && !c.played && c.boughtTurn < state.turnNumber,
    );
    if (playableSurplus && !state.activeDevCardThisTurn) {
      playDevCardAction(state, playableSurplus.id, {
        resource1: "toner",
        resource2: "paper",
      });
      return true;
    }

    // 2. Try Upgrade to City
    for (const [vId, b] of Object.entries(state.board.buildings)) {
      if (b.playerId === bot.id && b.type === "settlement" && bot.citiesLeft > 0) {
        if (bot.resources.toner >= 3 && bot.resources.paper >= 2) {
          if (buildCityAction(state, vId)) return true;
        } else {
          // Check if bank trading can complete city cost
          tryBankTradeForTarget(state, bot, BUILDING_COSTS.city);
          if (bot.resources.toner >= 3 && bot.resources.paper >= 2) {
            if (buildCityAction(state, vId)) return true;
          }
        }
      }
    }

    // 3. Try Build Settlement
    if (bot.settlementsLeft > 0) {
      for (const [vId, v] of Object.entries(state.board.vertices)) {
        if (satisfiesDistanceRule(vId, state.board)) {
          // Check road connectivity
          const connected = v.adjacentEdges.some(
            (eId) => state.board.roads[eId]?.playerId === bot.id,
          );
          if (connected) {
            if (
              bot.resources.brick >= 1 &&
              bot.resources.timber >= 1 &&
              bot.resources.paper >= 1 &&
              bot.resources.feed >= 1
            ) {
              if (buildSettlementAction(state, vId)) return true;
            } else {
              tryBankTradeForTarget(state, bot, BUILDING_COSTS.settlement);
              if (
                bot.resources.brick >= 1 &&
                bot.resources.timber >= 1 &&
                bot.resources.paper >= 1 &&
                bot.resources.feed >= 1
              ) {
                if (buildSettlementAction(state, vId)) return true;
              }
            }
          }
        }
      }
    }

    // 4. Try Buy Dev Card
    if (
      bot.resources.toner >= 1 &&
      bot.resources.paper >= 1 &&
      bot.resources.feed >= 1 &&
      state.devCardDeck.length > 0
    ) {
      if (buyDevCardAction(state)) return true;
    }

    // 5. Try Build Road
    if (bot.roadsLeft > 0 && bot.resources.brick >= 1 && bot.resources.timber >= 1) {
      for (const [eId, edge] of Object.entries(state.board.edges)) {
        if (!state.board.roads[eId]) {
          const v1 = state.board.vertices[edge.vertex1];
          const v2 = state.board.vertices[edge.vertex2];
          const connected =
            v1?.adjacentEdges.some((e) => state.board.roads[e]?.playerId === bot.id) ||
            v2?.adjacentEdges.some((e) => state.board.roads[e]?.playerId === bot.id) ||
            state.board.buildings[edge.vertex1]?.playerId === bot.id ||
            state.board.buildings[edge.vertex2]?.playerId === bot.id;

          if (connected) {
            if (buildRoadAction(state, eId)) return true;
          }
        }
      }
    }

    // 6. Nothing more to do, End Turn
    return endTurnAction(state);
  }

  // Handle Free Road Building phases
  if (state.phase === "road_building_1" || state.phase === "road_building_2") {
    for (const [eId, edge] of Object.entries(state.board.edges)) {
      if (!state.board.roads[eId]) {
        const v1 = state.board.vertices[edge.vertex1];
        const v2 = state.board.vertices[edge.vertex2];
        const connected =
          v1?.adjacentEdges.some((e) => state.board.roads[e]?.playerId === bot.id) ||
          v2?.adjacentEdges.some((e) => state.board.roads[e]?.playerId === bot.id) ||
          state.board.buildings[edge.vertex1]?.playerId === bot.id ||
          state.board.buildings[edge.vertex2]?.playerId === bot.id;

        if (connected) {
          if (buildRoadAction(state, eId)) return true;
        }
      }
    }
  }

  return false;
}

function tryBankTradeForTarget(
  state: PufftonGameState,
  bot: Player,
  targetCost: Partial<Record<ResourceType, number>>,
): void {
  for (const [res, needed] of Object.entries(targetCost)) {
    const r = res as ResourceType;
    const current = bot.resources[r] || 0;
    if (current < (needed || 0)) {
      // Look for surplus resource
      for (const surplusRes of ALL_RESOURCES) {
        if (surplusRes !== r) {
          const ratio = getPlayerBestTradeRatio(bot, surplusRes, state.board);
          if ((bot.resources[surplusRes] || 0) >= ratio + 1) {
            bankTradeAction(state, surplusRes, r);
            return;
          }
        }
      }
    }
  }
}
