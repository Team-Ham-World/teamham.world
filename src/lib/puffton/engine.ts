import { buildBoard, getHexVertices } from "./board";
import {
  ALL_RESOURCES,
  BUILDING_COSTS,
  MAX_BUILDINGS,
  type BoardState,
  type DevCard,
  type DevCardType,
  type GameLogEntry,
  type Player,
  type PlayerColor,
  type PufftonGameState,
  type PufftonSettings,
  type ResourceType,
} from "./types";

/**
 * Pure deterministic game state engine and rulebook for Puffton.
 */

export interface CreateGameOptions {
  players: {
    name: string;
    isBot: boolean;
    botDifficulty?: "easy" | "medium" | "hard";
    color: PlayerColor;
  }[];
  settings?: Partial<PufftonSettings>;
}

const DEFAULT_SETTINGS: PufftonSettings = {
  targetVp: 10,
  friendlyRobber: false,
  harborMaster: false,
  techPowers: false,
  balancedDice: false,
  map: "classic",
  fogOfWar: false,
  speed: "normal",
};

export function createPufftonGame(options: CreateGameOptions): PufftonGameState {
  const settings: PufftonSettings = {
    ...DEFAULT_SETTINGS,
    ...options.settings,
  };

  const board = buildBoard(settings.map);

  const players: Player[] = options.players.map((p, idx) => ({
    id: `p${idx + 1}`,
    name: p.name,
    isBot: p.isBot,
    botDifficulty: p.botDifficulty,
    color: p.color,
    resources: { toner: 0, paper: 0, feed: 0, brick: 0, timber: 0 },
    devCards: [],
    victoryPoints: 0,
    publicVictoryPoints: 0,
    settlementsLeft: MAX_BUILDINGS.settlements,
    citiesLeft: MAX_BUILDINGS.cities,
    roadsLeft: MAX_BUILDINGS.roads,
    longestRoadLength: 0,
    armySize: 0,
    hasLongestRoad: false,
    hasLargestArmy: false,
    hasHarborMaster: false,
    unlockedTechs: [],
  }));

  // Create standard 25 dev card deck
  const devCardDeck: DevCardType[] = [
    ...Array(14).fill("knight"),
    ...Array(5).fill("victory_point"),
    ...Array(2).fill("road_building"),
    ...Array(2).fill("year_of_plenty"),
    ...Array(2).fill("monopoly"),
  ].sort(() => Math.random() - 0.5);

  const log: GameLogEntry[] = [
    {
      id: "log-init",
      turn: 1,
      text: "Game initialized. Round 1 Placement started.",
      timestamp: Date.now(),
      type: "system",
    },
  ];

  return {
    id: `game-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    turnNumber: 1,
    activePlayerIndex: 0,
    phase: "setup_round_1",
    players,
    board,
    settings,
    devCardDeck,
    lastDiceRoll: null,
    pendingDiscardPlayerIds: [],
    currentTradeOffer: null,
    activeDevCardThisTurn: false,
    winnerId: null,
    log,
  };
}

function addLog(
  state: PufftonGameState,
  text: string,
  type: GameLogEntry["type"] = "system",
  playerId?: string,
): void {
  state.log.push({
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    turn: state.turnNumber,
    playerId: playerId ?? state.players[state.activePlayerIndex]?.id,
    text,
    timestamp: Date.now(),
    type,
  });
}

/**
 * Validates whether a vertex satisfies the Distance Rule:
 * No building may be built on a vertex if any directly adjacent vertex already has a building.
 */
export function satisfiesDistanceRule(vertexId: string, board: BoardState): boolean {
  if (board.buildings[vertexId]) return false;
  const vertex = board.vertices[vertexId];
  if (!vertex) return false;

  for (const adjVId of vertex.adjacentVertices) {
    if (board.buildings[adjVId]) {
      return false;
    }
  }
  return true;
}

/**
 * Checks whether a player has road connectivity to a vertex.
 */
export function hasRoadConnectivityToVertex(
  playerId: string,
  vertexId: string,
  board: BoardState,
): boolean {
  const vertex = board.vertices[vertexId];
  if (!vertex) return false;

  for (const edgeId of vertex.adjacentEdges) {
    const road = board.roads[edgeId];
    if (road && road.playerId === playerId) {
      return true;
    }
  }
  return false;
}

/**
 * Checks whether a player can build a road on an edge.
 */
export function canBuildRoad(
  playerId: string,
  edgeId: string,
  board: BoardState,
  isSetup = false,
): boolean {
  if (board.roads[edgeId]) return false;
  const edge = board.edges[edgeId];
  if (!edge) return false;

  const v1 = board.vertices[edge.vertex1];
  const v2 = board.vertices[edge.vertex2];

  // In setup mode, the road must connect directly to the settlement just placed
  if (isSetup) {
    const b1 = board.buildings[edge.vertex1];
    const b2 = board.buildings[edge.vertex2];
    return (b1 && b1.playerId === playerId) || (b2 && b2.playerId === playerId) || false;
  }

  // Check if player has a building on either vertex
  const b1 = board.buildings[edge.vertex1];
  const b2 = board.buildings[edge.vertex2];
  if (b1 && b1.playerId === playerId) return true;
  if (b2 && b2.playerId === playerId) return true;

  // Check adjacent roads (unless blocked by enemy building)
  if (v1 && (!b1 || b1.playerId === playerId)) {
    for (const adjE of v1.adjacentEdges) {
      if (board.roads[adjE]?.playerId === playerId) return true;
    }
  }

  if (v2 && (!b2 || b2.playerId === playerId)) {
    for (const adjE of v2.adjacentEdges) {
      if (board.roads[adjE]?.playerId === playerId) return true;
    }
  }

  return false;
}

/**
 * Deducts resources from player if they have enough.
 */
export function deductResources(
  player: Player,
  cost: Partial<Record<ResourceType, number>>,
): boolean {
  for (const [res, amt] of Object.entries(cost)) {
    const r = res as ResourceType;
    if ((player.resources[r] || 0) < (amt || 0)) {
      return false;
    }
  }
  for (const [res, amt] of Object.entries(cost)) {
    const r = res as ResourceType;
    player.resources[r] = (player.resources[r] || 0) - (amt || 0);
  }
  return true;
}

/**
 * Calculates victory points for all players and checks victory condition.
 */
export function recalculateVictoryPoints(state: PufftonGameState): void {
  // 1. Longest road evaluation
  updateLongestRoad(state);

  // 2. Largest army evaluation
  updateLargestArmy(state);

  // 3. Harbor master evaluation if enabled
  if (state.settings.harborMaster) {
    updateHarborMaster(state);
  }

  // 4. Calculate total & public VPs
  for (const player of state.players) {
    let vp = 0;
    // 1 VP per settlement
    vp += MAX_BUILDINGS.settlements - player.settlementsLeft;
    // 2 VP per city
    vp += (MAX_BUILDINGS.cities - player.citiesLeft) * 2;
    // 2 VP for longest road
    if (player.hasLongestRoad) vp += 2;
    // 2 VP for largest army
    if (player.hasLargestArmy) vp += 2;
    // 2 VP for harbor master
    if (player.hasHarborMaster) vp += 2;

    player.publicVictoryPoints = vp;

    // Secret VP cards
    const secretVp = player.devCards.filter((c) => c.type === "victory_point").length;
    player.victoryPoints = vp + secretVp;

    if (player.victoryPoints >= state.settings.targetVp && !state.winnerId) {
      state.winnerId = player.id;
      state.phase = "game_over";
      addLog(
        state,
        `👑 ${player.name} has reached ${player.victoryPoints} Victory Points and won the game!`,
        "victory",
        player.id,
      );
    }
  }
}

function updateLongestRoad(state: PufftonGameState): void {
  let maxLen = 4; // threshold is >= 5
  let holderId: string | null = null;

  for (const player of state.players) {
    const len = calculatePlayerLongestRoad(player.id, state.board);
    player.longestRoadLength = len;
    if (len > maxLen) {
      maxLen = len;
      holderId = player.id;
    }
  }

  for (const player of state.players) {
    player.hasLongestRoad = player.id === holderId;
  }
}

function calculatePlayerLongestRoad(playerId: string, board: BoardState): number {
  const playerRoadEdges = Object.values(board.roads)
    .filter((r) => r.playerId === playerId)
    .map((r) => r.edgeId);

  if (playerRoadEdges.length === 0) return 0;

  // DFS to find longest simple path of road segments
  let maxPath = 0;

  const visitedEdges = new Set<string>();

  function dfs(currVertexId: string, currentLength: number): void {
    if (currentLength > maxPath) {
      maxPath = currentLength;
    }

    const vertex = board.vertices[currVertexId];
    if (!vertex) return;

    // Blocked if vertex has an enemy building
    const building = board.buildings[currVertexId];
    if (building && building.playerId !== playerId && currentLength > 0) {
      return;
    }

    for (const edgeId of vertex.adjacentEdges) {
      if (playerRoadEdges.includes(edgeId) && !visitedEdges.has(edgeId)) {
        visitedEdges.add(edgeId);
        const edge = board.edges[edgeId];
        const nextVertexId = edge.vertex1 === currVertexId ? edge.vertex2 : edge.vertex1;
        dfs(nextVertexId, currentLength + 1);
        visitedEdges.delete(edgeId);
      }
    }
  }

  for (const edgeId of playerRoadEdges) {
    const edge = board.edges[edgeId];
    if (edge) {
      visitedEdges.add(edgeId);
      dfs(edge.vertex1, 1);
      dfs(edge.vertex2, 1);
      visitedEdges.delete(edgeId);
    }
  }

  return maxPath;
}

function updateLargestArmy(state: PufftonGameState): void {
  let maxKnights = 2; // threshold is >= 3
  let holderId: string | null = null;

  for (const player of state.players) {
    if (player.armySize > maxKnights) {
      maxKnights = player.armySize;
      holderId = player.id;
    }
  }

  for (const player of state.players) {
    player.hasLargestArmy = player.id === holderId;
  }
}

function updateHarborMaster(state: PufftonGameState): void {
  let maxPortPoints = 2; // threshold is >= 3
  let holderId: string | null = null;

  for (const player of state.players) {
    let portPoints = 0;
    for (const [vId, building] of Object.entries(state.board.buildings)) {
      if (building.playerId === player.id) {
        const vertex = state.board.vertices[vId];
        if (vertex?.port) {
          portPoints += building.type === "city" ? 2 : 1;
        }
      }
    }

    if (portPoints > maxPortPoints) {
      maxPortPoints = portPoints;
      holderId = player.id;
    }
  }

  for (const player of state.players) {
    player.hasHarborMaster = player.id === holderId;
  }
}

// ----------------------------------------------------
// Action Handlers
// ----------------------------------------------------

export function handleSetupPlacement(
  state: PufftonGameState,
  vertexId: string,
  edgeId: string,
): boolean {
  if (state.phase !== "setup_round_1" && state.phase !== "setup_round_2") return false;

  const player = state.players[state.activePlayerIndex];
  if (!satisfiesDistanceRule(vertexId, state.board)) return false;

  // Temporarily place settlement to validate road
  state.board.buildings[vertexId] = {
    type: "settlement",
    playerId: player.id,
    vertexId,
  };
  player.settlementsLeft--;

  if (!canBuildRoad(player.id, edgeId, state.board, true)) {
    // Revert
    delete state.board.buildings[vertexId];
    player.settlementsLeft++;
    return false;
  }

  state.board.roads[edgeId] = {
    playerId: player.id,
    edgeId,
  };
  player.roadsLeft--;

  // In Round 2, player collects starting resources for each adjacent hex
  if (state.phase === "setup_round_2") {
    const vertex = state.board.vertices[vertexId];
    if (vertex) {
      for (const hexId of vertex.adjacentHexes) {
        const tile = state.board.tiles[hexId];
        if (tile && tile.terrain !== "desert" && tile.terrain !== "ocean") {
          player.resources[tile.terrain]++;
        }
      }
    }
  }

  addLog(
    state,
    `${player.name} placed starting Hamlet and Wireway.`,
    "build",
    player.id,
  );

  // Advance turn order in snake draft:
  // Round 1: 0 -> 1 -> 2 -> 3
  // Round 2: 3 -> 2 -> 1 -> 0
  const numPlayers = state.players.length;

  if (state.phase === "setup_round_1") {
    if (state.activePlayerIndex === numPlayers - 1) {
      // Switch to round 2, stay on last player
      state.phase = "setup_round_2";
      addLog(state, "Round 2 Placement started (Reverse Order).", "system");
    } else {
      state.activePlayerIndex++;
    }
  } else if (state.phase === "setup_round_2") {
    if (state.activePlayerIndex === 0) {
      // Setup finished!
      state.phase = "roll";
      state.activePlayerIndex = 0;
      state.turnNumber = 1;
      addLog(state, "Initial setup complete! Turn 1 began.", "system");
    } else {
      state.activePlayerIndex--;
    }
  }

  recalculateVictoryPoints(state);
  return true;
}

export function rollDice(state: PufftonGameState): [number, number] {
  if (state.phase !== "roll") throw new Error("Not in roll phase");

  const d1 = Math.floor(Math.random() * 6) + 1;
  const d2 = Math.floor(Math.random() * 6) + 1;
  const roll = d1 + d2;
  state.lastDiceRoll = [d1, d2];

  const activePlayer = state.players[state.activePlayerIndex];
  addLog(
    state,
    `${activePlayer.name} rolled a ${roll} (${d1} + ${d2}).`,
    "roll",
    activePlayer.id,
  );

  if (roll === 7) {
    // 7 Rolled: check for discard penalty
    const playersToDiscard: string[] = [];
    for (const p of state.players) {
      const totalCards = Object.values(p.resources).reduce((sum, n) => sum + n, 0);
      if (totalCards > 7) {
        playersToDiscard.push(p.id);
      }
    }

    if (playersToDiscard.length > 0) {
      state.phase = "discard";
      state.pendingDiscardPlayerIds = playersToDiscard;
      addLog(
        state,
        `Toner Bandit arrives! Players with > 7 resources must discard half.`,
        "robber",
      );
    } else {
      state.phase = "robber";
    }
  } else {
    // Distribute resources from tiles matching roll (except if robber is present)
    for (const tile of Object.values(state.board.tiles)) {
      if (tile.diceNumber === roll && tile.id !== state.board.robberTileId) {
        const terrain = tile.terrain as ResourceType;
        if (ALL_RESOURCES.includes(terrain)) {
          // Find all vertices touching this tile
          const tileVerts = getHexVertices(tile.q, tile.r);
          for (const vId of tileVerts) {
            const building = state.board.buildings[vId];
            if (building) {
              const player = state.players.find((p) => p.id === building.playerId);
              if (player) {
                const yieldCount = building.type === "city" ? 2 : 1;
                player.resources[terrain] += yieldCount;
              }
            }
          }
        }
      }
    }
    state.phase = "action";
  }

  return [d1, d2];
}

export function handleDiscard(
  state: PufftonGameState,
  playerId: string,
  discardCards: Partial<Record<ResourceType, number>>,
): boolean {
  if (state.phase !== "discard") return false;
  if (!state.pendingDiscardPlayerIds.includes(playerId)) return false;

  const player = state.players.find((p) => p.id === playerId);
  if (!player) return false;

  const totalCards = Object.values(player.resources).reduce((sum, n) => sum + n, 0);
  const requiredDiscard = Math.floor(totalCards / 2);

  const givenDiscard = Object.values(discardCards).reduce((sum, n) => sum + (n || 0), 0);
  if (givenDiscard !== requiredDiscard) return false;

  if (!deductResources(player, discardCards)) return false;

  state.pendingDiscardPlayerIds = state.pendingDiscardPlayerIds.filter((id) => id !== playerId);

  addLog(state, `${player.name} discarded ${givenDiscard} resources.`, "robber", player.id);

  if (state.pendingDiscardPlayerIds.length === 0) {
    state.phase = "robber";
  }
  return true;
}

export function handleMoveRobber(
  state: PufftonGameState,
  newTileId: string,
  targetPlayerId?: string,
): boolean {
  if (state.phase !== "robber") return false;
  if (newTileId === state.board.robberTileId) return false;
  if (!state.board.tiles[newTileId]) return false;

  state.board.robberTileId = newTileId;
  const activePlayer = state.players[state.activePlayerIndex];

  let stealMsg = "";

  if (targetPlayerId && targetPlayerId !== activePlayer.id) {
    const targetPlayer = state.players.find((p) => p.id === targetPlayerId);
    if (targetPlayer) {
      // Check friendly robber rule
      if (state.settings.friendlyRobber && targetPlayer.victoryPoints <= 2) {
        return false;
      }

      // Collect available resources
      const available: ResourceType[] = [];
      for (const [res, count] of Object.entries(targetPlayer.resources)) {
        for (let i = 0; i < count; i++) {
          available.push(res as ResourceType);
        }
      }

      if (available.length > 0) {
        const stolen = available[Math.floor(Math.random() * available.length)];
        targetPlayer.resources[stolen]--;
        activePlayer.resources[stolen]++;
        stealMsg = ` and intercepted a transmission from ${targetPlayer.name}`;
      }
    }
  }

  addLog(
    state,
    `${activePlayer.name} repositioned the Toner Bandit${stealMsg}.`,
    "robber",
    activePlayer.id,
  );

  state.phase = "action";
  return true;
}

export function buildRoadAction(state: PufftonGameState, edgeId: string): boolean {
  if (state.phase !== "action" && state.phase !== "road_building_1" && state.phase !== "road_building_2") {
    return false;
  }

  const player = state.players[state.activePlayerIndex];
  if (player.roadsLeft <= 0) return false;
  if (!canBuildRoad(player.id, edgeId, state.board)) return false;

  const isFreeRoad = state.phase === "road_building_1" || state.phase === "road_building_2";

  if (!isFreeRoad) {
    if (!deductResources(player, BUILDING_COSTS.road)) return false;
  }

  state.board.roads[edgeId] = {
    playerId: player.id,
    edgeId,
  };
  player.roadsLeft--;

  addLog(state, `${player.name} deployed a new Wireway.`, "build", player.id);

  if (state.phase === "road_building_1") {
    state.phase = "road_building_2";
  } else if (state.phase === "road_building_2") {
    state.phase = "action";
  }

  recalculateVictoryPoints(state);
  return true;
}

export function buildSettlementAction(state: PufftonGameState, vertexId: string): boolean {
  if (state.phase !== "action") return false;

  const player = state.players[state.activePlayerIndex];
  if (player.settlementsLeft <= 0) return false;
  if (!satisfiesDistanceRule(vertexId, state.board)) return false;
  if (!hasRoadConnectivityToVertex(player.id, vertexId, state.board)) return false;

  if (!deductResources(player, BUILDING_COSTS.settlement)) return false;

  state.board.buildings[vertexId] = {
    type: "settlement",
    playerId: player.id,
    vertexId,
  };
  player.settlementsLeft--;

  addLog(state, `${player.name} established a Hamlet (Settlement).`, "build", player.id);

  recalculateVictoryPoints(state);
  return true;
}

export function buildCityAction(state: PufftonGameState, vertexId: string): boolean {
  if (state.phase !== "action") return false;

  const player = state.players[state.activePlayerIndex];
  if (player.citiesLeft <= 0) return false;

  const existingBuilding = state.board.buildings[vertexId];
  if (!existingBuilding || existingBuilding.playerId !== player.id || existingBuilding.type !== "settlement") {
    return false;
  }

  if (!deductResources(player, BUILDING_COSTS.city)) return false;

  state.board.buildings[vertexId] = {
    type: "city",
    playerId: player.id,
    vertexId,
  };
  player.citiesLeft--;
  player.settlementsLeft++; // Reclaim settlement to pool

  addLog(state, `${player.name} upgraded to a Ham HQ (City)!`, "build", player.id);

  recalculateVictoryPoints(state);
  return true;
}

export function buyDevCardAction(state: PufftonGameState): boolean {
  if (state.phase !== "action") return false;
  if (state.devCardDeck.length === 0) return false;

  const player = state.players[state.activePlayerIndex];
  if (!deductResources(player, BUILDING_COSTS.dev_card)) return false;

  const cardType = state.devCardDeck.pop()!;
  const newCard: DevCard = {
    id: `card-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: cardType,
    played: false,
    boughtTurn: state.turnNumber,
  };
  player.devCards.push(newCard);

  addLog(state, `${player.name} researched a Ham Card.`, "card", player.id);

  recalculateVictoryPoints(state);
  return true;
}

export function playDevCardAction(
  state: PufftonGameState,
  cardId: string,
  params?: {
    resource1?: ResourceType;
    resource2?: ResourceType;
    monopolyResource?: ResourceType;
  },
): boolean {
  if (state.phase !== "action") return false;
  if (state.activeDevCardThisTurn) return false;

  const player = state.players[state.activePlayerIndex];
  const card = player.devCards.find((c) => c.id === cardId);
  if (!card || card.played || card.boughtTurn === state.turnNumber) return false;
  if (card.type === "victory_point") return false; // VP cards are passive

  card.played = true;
  state.activeDevCardThisTurn = true;

  switch (card.type) {
    case "knight":
      player.armySize++;
      state.phase = "robber";
      addLog(state, `${player.name} deployed a Toner Guard (Knight).`, "card", player.id);
      break;

    case "road_building":
      state.phase = "road_building_1";
      addLog(state, `${player.name} activated Wire Spool (Road Building).`, "card", player.id);
      break;

    case "year_of_plenty":
      if (params?.resource1 && params?.resource2) {
        player.resources[params.resource1]++;
        player.resources[params.resource2]++;
        addLog(
          state,
          `${player.name} claimed Toner Surplus (${params.resource1}, ${params.resource2}).`,
          "card",
          player.id,
        );
      }
      break;

    case "monopoly":
      if (params?.monopolyResource) {
        const res = params.monopolyResource;
        let totalTaken = 0;
        for (const other of state.players) {
          if (other.id !== player.id) {
            const count = other.resources[res] || 0;
            totalTaken += count;
            other.resources[res] = 0;
          }
        }
        player.resources[res] += totalTaken;
        addLog(
          state,
          `${player.name} declared Market Monopoly on ${res}, seizing ${totalTaken} units!`,
          "card",
          player.id,
        );
      }
      break;
  }

  recalculateVictoryPoints(state);
  return true;
}

export function getPlayerBestTradeRatio(
  player: Player,
  resource: ResourceType,
  board: BoardState,
): number {
  let minRatio = 4; // 4:1 default

  for (const [vId, building] of Object.entries(board.buildings)) {
    if (building.playerId === player.id) {
      const port = board.vertices[vId]?.port;
      if (port) {
        if (port.type === "three_to_one") {
          minRatio = Math.min(minRatio, 3);
        } else if (port.type === resource) {
          minRatio = Math.min(minRatio, 2);
        }
      }
    }
  }

  return minRatio;
}

export function bankTradeAction(
  state: PufftonGameState,
  offerResource: ResourceType,
  wantResource: ResourceType,
): boolean {
  if (state.phase !== "action") return false;
  if (offerResource === wantResource) return false;

  const player = state.players[state.activePlayerIndex];
  const ratio = getPlayerBestTradeRatio(player, offerResource, state.board);

  if ((player.resources[offerResource] || 0) < ratio) return false;

  player.resources[offerResource] -= ratio;
  player.resources[wantResource] += 1;

  addLog(
    state,
    `${player.name} traded ${ratio} ${offerResource} for 1 ${wantResource} with the Bank.`,
    "trade",
    player.id,
  );
  return true;
}

export function endTurnAction(state: PufftonGameState): boolean {
  if (state.phase !== "action") return false;

  recalculateVictoryPoints(state);
  if (state.winnerId) return true;

  state.activePlayerIndex = (state.activePlayerIndex + 1) % state.players.length;
  if (state.activePlayerIndex === 0) {
    state.turnNumber++;
  }

  state.phase = "roll";
  state.activeDevCardThisTurn = false;
  state.currentTradeOffer = null;

  const nextPlayer = state.players[state.activePlayerIndex];
  addLog(state, `Turn passed to ${nextPlayer.name}.`, "system", nextPlayer.id);

  return true;
}
