/**
 * Core domain types for Puffton (Team HAM's hexagonal settlement board game).
 */

export type ResourceType = "toner" | "paper" | "feed" | "brick" | "timber";

export const ALL_RESOURCES: readonly ResourceType[] = [
  "toner",
  "paper",
  "feed",
  "brick",
  "timber",
] as const;

export type HexTerrain = ResourceType | "desert" | "ocean";

export type PortType = "three_to_one" | ResourceType;

export interface HexCoord {
  q: number; // axial column
  r: number; // axial row
}

export interface HexTile {
  id: string; // e.g. "h:0:0"
  q: number;
  r: number;
  terrain: HexTerrain;
  diceNumber: number | null; // 2..12 (null for desert/ocean)
}

export type VertexDir = "T" | "B"; // Top or Bottom vertex of hex
export type EdgeDir = "NE" | "E" | "SE"; // Canonical edge directions

export interface Vertex {
  id: string; // "v:q:r:T" or "v:q:r:B"
  q: number;
  r: number;
  dir: VertexDir;
  adjacentHexes: string[]; // tile IDs
  adjacentVertices: string[]; // vertex IDs
  adjacentEdges: string[]; // edge IDs
  port?: {
    type: PortType;
    ratio: number; // 2 or 3
  };
}

export interface Edge {
  id: string; // "e:q:r:NE" or "e:q:r:E" or "e:q:r:SE"
  q: number;
  r: number;
  dir: EdgeDir;
  vertex1: string; // vertex ID
  vertex2: string; // vertex ID
  adjacentHexes: string[]; // tile IDs
  adjacentEdges: string[]; // edge IDs
}

export type BuildingType = "settlement" | "city";

export interface Building {
  type: BuildingType;
  playerId: string;
  vertexId: string;
}

export interface Road {
  playerId: string;
  edgeId: string;
}

export type DevCardType =
  | "knight"
  | "victory_point"
  | "road_building"
  | "year_of_plenty"
  | "monopoly";

export interface DevCard {
  id: string;
  type: DevCardType;
  played: boolean;
  boughtTurn: number;
}

export type PlayerColor =
  | "ink"
  | "ham-gold"
  | "electric-blue"
  | "hot-pink"
  | "emerald"
  | "cyber-violet"
  | "sunset-orange"
  | "lunar-silver";

export interface PlayerColorDef {
  id: PlayerColor;
  name: string;
  primary: string;
  secondary: string;
  accent: string;
  border: string;
}

export const PLAYER_COLOR_PALETTES: Record<PlayerColor, PlayerColorDef> = {
  ink: {
    id: "ink",
    name: "HAM Ink",
    primary: "#18181b",
    secondary: "#27272a",
    accent: "#f4f4f5",
    border: "#000000",
  },
  "ham-gold": {
    id: "ham-gold",
    name: "Hamster Gold",
    primary: "#d97706",
    secondary: "#f59e0b",
    accent: "#fef3c7",
    border: "#78350f",
  },
  "electric-blue": {
    id: "electric-blue",
    name: "Electric Blue",
    primary: "#1d4ed8",
    secondary: "#3b82f6",
    accent: "#dbeafe",
    border: "#1e3a8a",
  },
  "hot-pink": {
    id: "hot-pink",
    name: "Neon Pink",
    primary: "#be185d",
    secondary: "#ec4899",
    accent: "#fce7f3",
    border: "#831843",
  },
  emerald: {
    id: "emerald",
    name: "Cyber Emerald",
    primary: "#047857",
    secondary: "#10b981",
    accent: "#d1fae5",
    border: "#064e3b",
  },
  "cyber-violet": {
    id: "cyber-violet",
    name: "Quantum Violet",
    primary: "#6d28d9",
    secondary: "#8b5cf6",
    accent: "#ede9fe",
    border: "#4c1d95",
  },
  "sunset-orange": {
    id: "sunset-orange",
    name: "Sunset Orange",
    primary: "#c2410c",
    secondary: "#f97316",
    accent: "#ffedd5",
    border: "#7c2d12",
  },
  "lunar-silver": {
    id: "lunar-silver",
    name: "Lunar Silver",
    primary: "#475569",
    secondary: "#64748b",
    accent: "#f1f5f9",
    border: "#1e293b",
  },
};

export interface Player {
  id: string;
  name: string;
  isBot: boolean;
  botDifficulty?: "easy" | "medium" | "hard";
  color: PlayerColor;
  resources: Record<ResourceType, number>;
  devCards: DevCard[];
  victoryPoints: number;
  publicVictoryPoints: number;
  settlementsLeft: number;
  citiesLeft: number;
  roadsLeft: number;
  longestRoadLength: number;
  armySize: number; // knights played
  hasLongestRoad: boolean;
  hasLargestArmy: boolean;
  hasHarborMaster: boolean;
  unlockedTechs: string[];
}

export type GamePhase =
  | "setup_round_1"
  | "setup_round_2"
  | "roll"
  | "discard"
  | "robber"
  | "action"
  | "road_building_1"
  | "road_building_2"
  | "game_over";

export interface TradeOffer {
  id: string;
  fromPlayerId: string;
  offer: Partial<Record<ResourceType, number>>;
  want: Partial<Record<ResourceType, number>>;
  targetPlayerId?: string; // undefined = public to all players
}

export type MapOption = "classic" | "expanded" | "archipelago" | "duel" | "random";

export interface PufftonSettings {
  targetVp: number;
  friendlyRobber: boolean;
  harborMaster: boolean;
  techPowers: boolean;
  balancedDice: boolean;
  map: MapOption;
  fogOfWar: boolean;
  speed: "normal" | "fast";
}

export interface BoardState {
  tiles: Record<string, HexTile>;
  vertices: Record<string, Vertex>;
  edges: Record<string, Edge>;
  buildings: Record<string, Building>; // vertexId -> Building
  roads: Record<string, Road>; // edgeId -> Road
  robberTileId: string;
  revealedTileIds?: Record<string, boolean>; // for Fog of War
}

export interface GameLogEntry {
  id: string;
  turn: number;
  playerId?: string;
  text: string;
  timestamp: number;
  type: "roll" | "build" | "trade" | "card" | "robber" | "victory" | "system";
}

export interface PufftonGameState {
  id: string;
  turnNumber: number;
  activePlayerIndex: number;
  phase: GamePhase;
  players: Player[];
  board: BoardState;
  settings: PufftonSettings;
  devCardDeck: DevCardType[];
  lastDiceRoll: [number, number] | null;
  diceDeck?: number[]; // for balanced dice mode
  pendingDiscardPlayerIds: string[];
  currentTradeOffer: TradeOffer | null;
  activeDevCardThisTurn: boolean;
  winnerId: string | null;
  log: GameLogEntry[];
}

export const BUILDING_COSTS: Record<
  "road" | "settlement" | "city" | "dev_card",
  Partial<Record<ResourceType, number>>
> = {
  road: { brick: 1, timber: 1 },
  settlement: { brick: 1, timber: 1, paper: 1, feed: 1 },
  city: { toner: 3, paper: 2 },
  dev_card: { toner: 1, paper: 1, feed: 1 },
};

export const MAX_BUILDINGS = {
  settlements: 5,
  cities: 4,
  roads: 15,
};
