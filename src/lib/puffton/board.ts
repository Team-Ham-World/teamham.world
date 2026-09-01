import type {
  BoardState,
  Edge,
  EdgeDir,
  HexTerrain,
  HexTile,
  MapOption,
  PortType,
  Vertex,
  VertexDir,
} from "./types";

/**
 * Standard Catan-like pointy-topped hex geometry & topology generator.
 */

// Helper to format tile ID
export function getTileId(q: number, r: number): string {
  return `h:${q}:${r}`;
}

// Helper to format vertex ID
export function getVertexId(q: number, r: number, dir: VertexDir): string {
  return `v:${q}:${r}:${dir}`;
}

// Helper to format edge ID
export function getEdgeId(q: number, r: number, dir: EdgeDir): string {
  return `e:${q}:${r}:${dir}`;
}

/**
 * For a hex (q, r), returns the 6 canonical vertex IDs in clockwise order starting from Top:
 * 0: Top (T of q, r)
 * 1: Top-Right (B of q+1, r-1)
 * 2: Bottom-Right (T of q+1, r)
 * 3: Bottom (B of q, r)
 * 4: Bottom-Left (T of q, r+1)
 * 5: Top-Left (B of q-1, r)
 */
export function getHexVertices(q: number, r: number): string[] {
  return [
    getVertexId(q, r, "T"),
    getVertexId(q + 1, r - 1, "B"),
    getVertexId(q, r + 1, "T"),
    getVertexId(q, r, "B"),
    getVertexId(q - 1, r + 1, "T"),
    getVertexId(q, r - 1, "B"),
  ];
}

/**
 * For a hex (q, r), returns the 6 canonical edge IDs clockwise starting from NE edge:
 * 0: NE edge (NE of q, r)
 * 1: E edge  (E of q, r)
 * 2: SE edge (SE of q, r)
 * 3: SW edge (NE of q-1, r+1)
 * 4: W edge  (E of q-1, r)
 * 5: NW edge (SE of q, r-1)
 */
export function getHexEdges(q: number, r: number): string[] {
  return [
    getEdgeId(q, r, "NE"),
    getEdgeId(q, r, "E"),
    getEdgeId(q, r, "SE"),
    getEdgeId(q - 1, r + 1, "NE"),
    getEdgeId(q - 1, r, "E"),
    getEdgeId(q, r - 1, "SE"),
  ];
}

/**
 * Calculates (x, y) 2D coordinates for rendering pointy-topped hexes.
 */
export function hexToPixel(
  q: number,
  r: number,
  size = 56,
): { x: number; y: number } {
  const x = size * Math.sqrt(3) * (q + r / 2);
  const y = size * 1.5 * r;
  return { x, y };
}

/**
 * Calculates (x, y) 2D coordinates for a vertex.
 */
export function vertexToPixel(
  q: number,
  r: number,
  dir: VertexDir,
  size = 56,
): { x: number; y: number } {
  const hexCenter = hexToPixel(q, r, size);
  if (dir === "T") {
    return { x: hexCenter.x, y: hexCenter.y - size };
  } else {
    return { x: hexCenter.x, y: hexCenter.y + size };
  }
}

/**
 * Calculates midpoint (x, y) for an edge.
 */
export function edgeToPixel(
  edge: Edge,
  vertices: Record<string, Vertex>,
  size = 56,
): { x: number; y: number } {
  const v1 = vertices[edge.vertex1];
  const v2 = vertices[edge.vertex2];
  if (!v1 || !v2) {
    const hex = hexToPixel(edge.q, edge.r, size);
    return hex;
  }
  const p1 = vertexToPixel(v1.q, v1.r, v1.dir, size);
  const p2 = vertexToPixel(v2.q, v2.r, v2.dir, size);
  return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
}

interface TileConfig {
  q: number;
  r: number;
  terrain: HexTerrain;
  diceNumber: number | null;
}

interface PortConfig {
  vertexId1: string;
  vertexId2: string;
  type: PortType;
  ratio: number;
}

// Map Presets
export function getMapTiles(mapType: MapOption): {
  tiles: TileConfig[];
  ports: PortConfig[];
} {
  switch (mapType) {
    case "classic":
      return getClassicMap();
    case "expanded":
      return getExpandedMap();
    case "archipelago":
      return getArchipelagoMap();
    case "duel":
      return getDuelMap();
    case "random":
    default:
      return getRandomMap();
  }
}

function getClassicMap(): { tiles: TileConfig[]; ports: PortConfig[] } {
  // Standard 19-hex board axial coords:
  // r = -2: q = 0, 1, 2
  // r = -1: q = -1, 0, 1, 2
  // r = 0:  q = -2, -1, 0, 1, 2
  // r = 1:  q = -2, -1, 0, 1
  // r = 2:  q = -2, -1, 0
  const coords = [
    { q: 0, r: -2 },
    { q: 1, r: -2 },
    { q: 2, r: -2 },
    { q: -1, r: -1 },
    { q: 0, r: -1 },
    { q: 1, r: -1 },
    { q: 2, r: -1 },
    { q: -2, r: 0 },
    { q: -1, r: 0 },
    { q: 0, r: 0 },
    { q: 1, r: 0 },
    { q: 2, r: 0 },
    { q: -2, r: 1 },
    { q: -1, r: 1 },
    { q: 0, r: 1 },
    { q: 1, r: 1 },
    { q: -2, r: 2 },
    { q: -1, r: 2 },
    { q: 0, r: 2 },
  ];

  const terrains: HexTerrain[] = [
    "timber",
    "feed",
    "paper",
    "brick",
    "toner",
    "timber",
    "feed",
    "paper",
    "brick",
    "desert",
    "toner",
    "timber",
    "feed",
    "paper",
    "toner",
    "timber",
    "feed",
    "paper",
    "brick",
  ];

  const numbers: (number | null)[] = [
    5, 2, 6, 3, 8, 10, 9, 12, 11, null, 4, 8, 10, 9, 4, 5, 6, 3, 11,
  ];

  const tiles: TileConfig[] = coords.map((c, i) => ({
    q: c.q,
    r: c.r,
    terrain: terrains[i],
    diceNumber: numbers[i],
  }));

  // Standard Ports (9 ports on coast)
  const ports: PortConfig[] = [
    {
      vertexId1: getVertexId(0, -2, "T"),
      vertexId2: getVertexId(1, -3, "B"),
      type: "three_to_one",
      ratio: 3,
    },
    {
      vertexId1: getVertexId(2, -2, "T"),
      vertexId2: getVertexId(3, -3, "B"),
      type: "paper",
      ratio: 2,
    },
    {
      vertexId1: getVertexId(3, -2, "T"),
      vertexId2: getVertexId(2, -1, "B"),
      type: "toner",
      ratio: 2,
    },
    {
      vertexId1: getVertexId(3, 0, "T"),
      vertexId2: getVertexId(2, 0, "B"),
      type: "three_to_one",
      ratio: 3,
    },
    {
      vertexId1: getVertexId(1, 1, "B"),
      vertexId2: getVertexId(1, 2, "T"),
      type: "feed",
      ratio: 2,
    },
    {
      vertexId1: getVertexId(0, 2, "B"),
      vertexId2: getVertexId(0, 3, "T"),
      type: "three_to_one",
      ratio: 3,
    },
    {
      vertexId1: getVertexId(-2, 2, "B"),
      vertexId2: getVertexId(-1, 2, "T"),
      type: "brick",
      ratio: 2,
    },
    {
      vertexId1: getVertexId(-3, 1, "B"),
      vertexId2: getVertexId(-2, 0, "T"),
      type: "timber",
      ratio: 2,
    },
    {
      vertexId1: getVertexId(-2, -1, "B"),
      vertexId2: getVertexId(-1, -1, "T"),
      type: "three_to_one",
      ratio: 3,
    },
  ];

  return { tiles, ports };
}

function getExpandedMap(): { tiles: TileConfig[]; ports: PortConfig[] } {
  // Radius 3 board (30 tiles)
  const coords: { q: number; r: number }[] = [];
  for (let q = -3; q <= 3; q++) {
    for (let r = -3; r <= 3; r++) {
      if (Math.abs(q + r) <= 3) {
        coords.push({ q, r });
      }
    }
  }

  const terrainsPool: HexTerrain[] = [
    "timber", "timber", "timber", "timber", "timber", "timber",
    "paper", "paper", "paper", "paper", "paper", "paper",
    "feed", "feed", "feed", "feed", "feed", "feed",
    "brick", "brick", "brick", "brick", "brick",
    "toner", "toner", "toner", "toner", "toner",
    "desert", "desert",
  ];

  const numbersPool = [
    2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6, 8, 8, 8, 9, 9, 9, 10, 10, 10, 11, 11, 11, 12, 12,
  ];

  const tiles: TileConfig[] = coords.slice(0, 30).map((c, i) => {
    const terrain = terrainsPool[i % terrainsPool.length];
    const diceNumber = terrain === "desert" ? null : numbersPool[i % numbersPool.length];
    return { q: c.q, r: c.r, terrain, diceNumber };
  });

  const ports: PortConfig[] = [
    { vertexId1: getVertexId(0, -3, "T"), vertexId2: getVertexId(1, -4, "B"), type: "three_to_one", ratio: 3 },
    { vertexId1: getVertexId(2, -3, "T"), vertexId2: getVertexId(3, -4, "B"), type: "paper", ratio: 2 },
    { vertexId1: getVertexId(3, -1, "T"), vertexId2: getVertexId(3, -2, "B"), type: "toner", ratio: 2 },
    { vertexId1: getVertexId(3, 1, "T"), vertexId2: getVertexId(2, 2, "B"), type: "feed", ratio: 2 },
    { vertexId1: getVertexId(0, 3, "B"), vertexId2: getVertexId(0, 4, "T"), type: "brick", ratio: 2 },
    { vertexId1: getVertexId(-2, 3, "B"), vertexId2: getVertexId(-1, 3, "T"), type: "timber", ratio: 2 },
    { vertexId1: getVertexId(-3, 1, "B"), vertexId2: getVertexId(-2, 0, "T"), type: "three_to_one", ratio: 3 },
    { vertexId1: getVertexId(-3, -1, "B"), vertexId2: getVertexId(-2, -2, "T"), type: "three_to_one", ratio: 3 },
  ];

  return { tiles, ports };
}

function getArchipelagoMap(): { tiles: TileConfig[]; ports: PortConfig[] } {
  // Island 1 (North-West) + Ocean + Island 2 (South-East)
  const island1Coords = [
    { q: -1, r: -2 }, { q: 0, r: -2 },
    { q: -2, r: -1 }, { q: -1, r: -1 }, { q: 0, r: -1 },
    { q: -2, r: 0 }, { q: -1, r: 0 },
  ];
  const island2Coords = [
    { q: 1, r: 0 }, { q: 2, r: 0 },
    { q: 0, r: 1 }, { q: 1, r: 1 }, { q: 2, r: 1 },
    { q: 0, r: 2 }, { q: 1, r: 2 },
  ];
  const oceanCoords = [
    { q: 1, r: -2 }, { q: 2, r: -2 },
    { q: 1, r: -1 }, { q: 2, r: -1 },
    { q: 0, r: 0 },
    { q: -2, r: 1 }, { q: -1, r: 1 },
    { q: -2, r: 2 }, { q: -1, r: 2 },
  ];

  const terrainIsland1: HexTerrain[] = ["timber", "brick", "paper", "feed", "toner", "timber", "feed"];
  const numIsland1 = [5, 6, 8, 9, 4, 10, 3];

  const terrainIsland2: HexTerrain[] = ["paper", "toner", "timber", "feed", "brick", "paper", "toner"];
  const numIsland2 = [9, 8, 6, 5, 11, 4, 10];

  const tiles: TileConfig[] = [
    ...island1Coords.map((c, i) => ({ q: c.q, r: c.r, terrain: terrainIsland1[i], diceNumber: numIsland1[i] })),
    ...island2Coords.map((c, i) => ({ q: c.q, r: c.r, terrain: terrainIsland2[i], diceNumber: numIsland2[i] })),
    ...oceanCoords.map((c) => ({ q: c.q, r: c.r, terrain: "ocean" as HexTerrain, diceNumber: null })),
  ];

  const ports: PortConfig[] = [
    { vertexId1: getVertexId(-1, -2, "T"), vertexId2: getVertexId(0, -3, "B"), type: "three_to_one", ratio: 3 },
    { vertexId1: getVertexId(-2, -1, "T"), vertexId2: getVertexId(-1, -2, "B"), type: "timber", ratio: 2 },
    { vertexId1: getVertexId(1, 2, "B"), vertexId2: getVertexId(1, 3, "T"), type: "three_to_one", ratio: 3 },
    { vertexId1: getVertexId(2, 0, "B"), vertexId2: getVertexId(3, 0, "T"), type: "toner", ratio: 2 },
  ];

  return { tiles, ports };
}

function getDuelMap(): { tiles: TileConfig[]; ports: PortConfig[] } {
  // Compact 12-hex map
  const coords = [
    { q: 0, r: -1 }, { q: 1, r: -1 },
    { q: -1, r: 0 }, { q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 },
    { q: -1, r: 1 }, { q: 0, r: 1 }, { q: 1, r: 1 },
    { q: -1, r: 2 }, { q: 0, r: 2 }, { q: 1, r: 2 },
  ];

  const terrains: HexTerrain[] = [
    "timber", "brick",
    "paper", "toner", "feed", "timber",
    "brick", "desert", "paper",
    "feed", "toner", "timber",
  ];

  const numbers = [6, 8, 5, 9, 10, 4, 3, null, 11, 8, 6, 5];

  const tiles: TileConfig[] = coords.map((c, i) => ({
    q: c.q,
    r: c.r,
    terrain: terrains[i],
    diceNumber: numbers[i],
  }));

  const ports: PortConfig[] = [
    { vertexId1: getVertexId(0, -1, "T"), vertexId2: getVertexId(1, -2, "B"), type: "three_to_one", ratio: 3 },
    { vertexId1: getVertexId(2, 0, "T"), vertexId2: getVertexId(3, 0, "B"), type: "paper", ratio: 2 },
    { vertexId1: getVertexId(0, 2, "B"), vertexId2: getVertexId(0, 3, "T"), type: "three_to_one", ratio: 3 },
    { vertexId1: getVertexId(-1, 0, "B"), vertexId2: getVertexId(-1, 1, "T"), type: "brick", ratio: 2 },
  ];

  return { tiles, ports };
}

function getRandomMap(): { tiles: TileConfig[]; ports: PortConfig[] } {
  const classic = getClassicMap();
  // Shuffle terrains and numbers deterministically or randomly
  const nonDesertTerrains: HexTerrain[] = ([
    "timber", "timber", "timber", "timber",
    "feed", "feed", "feed", "feed",
    "paper", "paper", "paper", "paper",
    "brick", "brick", "brick",
    "toner", "toner", "toner",
  ] as HexTerrain[]).sort(() => Math.random() - 0.5);

  const numbers = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12].sort(
    () => Math.random() - 0.5,
  );

  const desertIndex = Math.floor(Math.random() * classic.tiles.length);
  let terrainIdx = 0;
  let numberIdx = 0;

  const tiles: TileConfig[] = classic.tiles.map((tile, i) => {
    if (i === desertIndex) {
      return { q: tile.q, r: tile.r, terrain: "desert", diceNumber: null };
    }
    const terrain = nonDesertTerrains[terrainIdx++];
    const diceNumber = numbers[numberIdx++];
    return { q: tile.q, r: tile.r, terrain, diceNumber };
  });

  return { tiles, ports: classic.ports };
}

/**
 * Builds full board graph: tiles, vertices, edges, ports, and cross-adjacency lists.
 */
export function buildBoard(mapType: MapOption): BoardState {
  const { tiles: tileConfigs, ports: portConfigs } = getMapTiles(mapType);

  const tiles: Record<string, HexTile> = {};
  const vertices: Record<string, Vertex> = {};
  const edges: Record<string, Edge> = {};

  let initialRobberTileId = "";

  // 1. Instantiate Tiles
  for (const tc of tileConfigs) {
    const tileId = getTileId(tc.q, tc.r);
    tiles[tileId] = {
      id: tileId,
      q: tc.q,
      r: tc.r,
      terrain: tc.terrain,
      diceNumber: tc.diceNumber,
    };
    if (tc.terrain === "desert" && !initialRobberTileId) {
      initialRobberTileId = tileId;
    }
  }

  if (!initialRobberTileId && tileConfigs.length > 0) {
    initialRobberTileId = getTileId(tileConfigs[0].q, tileConfigs[0].r);
  }

  // 2. Discover Vertices and Edges for all tiles
  for (const tile of Object.values(tiles)) {
    const tileVertIds = getHexVertices(tile.q, tile.r);
    const tileEdgeIds = getHexEdges(tile.q, tile.r);

    // Register 6 vertices
    tileVertIds.forEach((vId) => {
      if (!vertices[vId]) {
        const parts = vId.split(":");
        const q = Number(parts[1]);
        const r = Number(parts[2]);
        const dir = parts[3] as VertexDir;
        vertices[vId] = {
          id: vId,
          q,
          r,
          dir,
          adjacentHexes: [],
          adjacentVertices: [],
          adjacentEdges: [],
        };
      }
      if (!vertices[vId].adjacentHexes.includes(tile.id)) {
        vertices[vId].adjacentHexes.push(tile.id);
      }
    });

    // Register 6 edges and connect to vertices
    // Edge 0 (NE): v0 - v1
    // Edge 1 (E):  v1 - v2
    // Edge 2 (SE): v2 - v3
    // Edge 3 (SW): v3 - v4
    // Edge 4 (W):  v4 - v5
    // Edge 5 (NW): v5 - v0
    const edgePairs: [number, number, EdgeDir, number, number][] = [
      [0, 1, "NE", tile.q, tile.r],
      [1, 2, "E", tile.q, tile.r],
      [2, 3, "SE", tile.q, tile.r],
      [3, 4, "NE", tile.q - 1, tile.r + 1],
      [4, 5, "E", tile.q - 1, tile.r],
      [5, 0, "SE", tile.q, tile.r - 1],
    ];

    tileEdgeIds.forEach((eId, idx) => {
      const [vIdx1, vIdx2, dir, eq, er] = edgePairs[idx];
      const v1Id = tileVertIds[vIdx1];
      const v2Id = tileVertIds[vIdx2];

      if (!edges[eId]) {
        edges[eId] = {
          id: eId,
          q: eq,
          r: er,
          dir,
          vertex1: v1Id,
          vertex2: v2Id,
          adjacentHexes: [],
          adjacentEdges: [],
        };
      }

      if (!edges[eId].adjacentHexes.includes(tile.id)) {
        edges[eId].adjacentHexes.push(tile.id);
      }

      // Link vertex to edge
      if (!vertices[v1Id].adjacentEdges.includes(eId)) {
        vertices[v1Id].adjacentEdges.push(eId);
      }
      if (!vertices[v2Id].adjacentEdges.includes(eId)) {
        vertices[v2Id].adjacentEdges.push(eId);
      }

      // Link vertices to each other
      if (!vertices[v1Id].adjacentVertices.includes(v2Id)) {
        vertices[v1Id].adjacentVertices.push(v2Id);
      }
      if (!vertices[v2Id].adjacentVertices.includes(v1Id)) {
        vertices[v2Id].adjacentVertices.push(v1Id);
      }
    });
  }

  // 3. Connect edge-to-edge adjacency
  for (const edge of Object.values(edges)) {
    const v1 = vertices[edge.vertex1];
    const v2 = vertices[edge.vertex2];
    const adjEdges = new Set<string>();

    if (v1) {
      for (const eId of v1.adjacentEdges) {
        if (eId !== edge.id) adjEdges.add(eId);
      }
    }
    if (v2) {
      for (const eId of v2.adjacentEdges) {
        if (eId !== edge.id) adjEdges.add(eId);
      }
    }

    edge.adjacentEdges = Array.from(adjEdges);
  }

  // 4. Attach Ports
  for (const port of portConfigs) {
    if (vertices[port.vertexId1]) {
      vertices[port.vertexId1].port = { type: port.type, ratio: port.ratio };
    }
    if (vertices[port.vertexId2]) {
      vertices[port.vertexId2].port = { type: port.type, ratio: port.ratio };
    }
  }

  return {
    tiles,
    vertices,
    edges,
    buildings: {},
    roads: {},
    robberTileId: initialRobberTileId,
  };
}
