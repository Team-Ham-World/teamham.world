"use client";

import React, { useMemo } from "react";
import {
  hexToPixel,
  vertexToPixel,
} from "@/lib/puffton/board";
import {
  canBuildRoad,
  satisfiesDistanceRule,
} from "@/lib/puffton/engine";
import {
  PLAYER_COLOR_PALETTES,
  type HexTerrain,
  type PufftonGameState,
} from "@/lib/puffton/types";

interface PufftonBoardViewProps {
  gameState: PufftonGameState;
  onVertexClick?: (vertexId: string) => void;
  onEdgeClick?: (edgeId: string) => void;
  onTileClick?: (tileId: string) => void;
  selectedVertexId?: string | null;
  selectedEdgeId?: string | null;
}

const HEX_SIZE = 54;

const TERRAIN_STYLES: Record<
  HexTerrain,
  { bg: string; border: string; label: string; icon: string; textCol: string }
> = {
  toner: {
    bg: "#27272a",
    border: "#09090b",
    label: "Toner",
    icon: "🖨️",
    textCol: "#f4f4f5",
  },
  paper: {
    bg: "#fef08a",
    border: "#ca8a04",
    label: "Paper",
    icon: "📜",
    textCol: "#713f12",
  },
  feed: {
    bg: "#fde047",
    border: "#eab308",
    label: "Feed",
    icon: "🌽",
    textCol: "#854d0e",
  },
  brick: {
    bg: "#fb923c",
    border: "#c2410c",
    label: "Brick",
    icon: "🧱",
    textCol: "#7c2d12",
  },
  timber: {
    bg: "#4ade80",
    border: "#15803d",
    label: "Timber",
    icon: "🌲",
    textCol: "#14532d",
  },
  desert: {
    bg: "#fed7aa",
    border: "#d97706",
    label: "Desert",
    icon: "🏜️",
    textCol: "#7c2d12",
  },
  ocean: {
    bg: "#7dd3fc",
    border: "#0284c7",
    label: "Ocean",
    icon: "🌊",
    textCol: "#0369a1",
  },
};

function getPipDots(num: number | null): string {
  if (!num || num === 7) return "";
  const count = 6 - Math.abs(7 - num);
  return "•".repeat(count);
}

export function PufftonBoardView({
  gameState,
  onVertexClick,
  onEdgeClick,
  onTileClick,
  selectedVertexId,
  selectedEdgeId,
}: PufftonBoardViewProps) {
  const { board, players, activePlayerIndex, phase } = gameState;
  const activePlayer = players[activePlayerIndex];

  // Calculate ViewBox bounds
  const { minX, minY, width, height } = useMemo(() => {
    let minx = Infinity;
    let maxx = -Infinity;
    let miny = Infinity;
    let maxy = -Infinity;

    for (const tile of Object.values(board.tiles)) {
      const p = hexToPixel(tile.q, tile.r, HEX_SIZE);
      minx = Math.min(minx, p.x - HEX_SIZE * 1.5);
      maxx = Math.max(maxx, p.x + HEX_SIZE * 1.5);
      miny = Math.min(miny, p.y - HEX_SIZE * 1.5);
      maxy = Math.max(maxy, p.y + HEX_SIZE * 1.5);
    }

    if (minx === Infinity) {
      return { minX: -300, minY: -300, width: 600, height: 600 };
    }

    const padding = 60;
    return {
      minX: minx - padding,
      minY: miny - padding,
      width: maxx - minx + padding * 2,
      height: maxy - miny + padding * 2,
    };
  }, [board.tiles]);

  // Determine valid vertex slots for active player
  const validVertexSlots = useMemo(() => {
    const slots = new Set<string>();
    if (!activePlayer || activePlayer.isBot) return slots;

    if (phase === "setup_round_1" || phase === "setup_round_2") {
      for (const [vId] of Object.entries(board.vertices)) {
        if (satisfiesDistanceRule(vId, board)) {
          slots.add(vId);
        }
      }
    } else if (phase === "action") {
      // Check settlement spots
      if (
        activePlayer.settlementsLeft > 0 &&
        activePlayer.resources.brick >= 1 &&
        activePlayer.resources.timber >= 1 &&
        activePlayer.resources.paper >= 1 &&
        activePlayer.resources.feed >= 1
      ) {
        for (const [vId, v] of Object.entries(board.vertices)) {
          if (satisfiesDistanceRule(vId, board)) {
            const connected = v.adjacentEdges.some(
              (eId) => board.roads[eId]?.playerId === activePlayer.id,
            );
            if (connected) slots.add(vId);
          }
        }
      }

      // Check city upgrade spots
      if (
        activePlayer.citiesLeft > 0 &&
        activePlayer.resources.toner >= 3 &&
        activePlayer.resources.paper >= 2
      ) {
        for (const [vId, b] of Object.entries(board.buildings)) {
          if (b.playerId === activePlayer.id && b.type === "settlement") {
            slots.add(vId);
          }
        }
      }
    }

    return slots;
  }, [board, activePlayer, phase]);

  // Determine valid edge slots for active player
  const validEdgeSlots = useMemo(() => {
    const slots = new Set<string>();
    if (!activePlayer || activePlayer.isBot) return slots;

    const isSetup = phase === "setup_round_1" || phase === "setup_round_2";
    const isFreeRoad = phase === "road_building_1" || phase === "road_building_2";
    const canAffordRoad =
      isFreeRoad ||
      (activePlayer.resources.brick >= 1 && activePlayer.resources.timber >= 1);

    if (isSetup && selectedVertexId) {
      const v = board.vertices[selectedVertexId];
      if (v) {
        for (const eId of v.adjacentEdges) {
          if (!board.roads[eId]) slots.add(eId);
        }
      }
    } else if ((phase === "action" && canAffordRoad) || isFreeRoad) {
      if (activePlayer.roadsLeft > 0) {
        for (const [eId] of Object.entries(board.edges)) {
          if (canBuildRoad(activePlayer.id, eId, board, false)) {
            slots.add(eId);
          }
        }
      }
    }

    return slots;
  }, [board, activePlayer, phase, selectedVertexId]);

  return (
    <div className="relative flex w-full items-center justify-center overflow-hidden rounded-2xl border-4 border-ink bg-[#bae6fd] p-2 shadow-[6px_6px_0px_#121212] sm:p-4">
      <svg
        viewBox={`${minX} ${minY} ${width} ${height}`}
        className="h-auto max-h-[640px] w-full select-none"
        style={{ filter: "drop-shadow(0 4px 6px rgba(0,0,0,0.15))" }}
      >
        <defs>
          <filter id="inkShadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="2" dy="2" stdDeviation="0" floodColor="#121212" />
          </filter>
        </defs>

        {/* 1. Hex Tiles Layer */}
        <g id="hex-tiles">
          {Object.values(board.tiles).map((tile) => {
            const center = hexToPixel(tile.q, tile.r, HEX_SIZE);
            const style = TERRAIN_STYLES[tile.terrain] || TERRAIN_STYLES.desert;
            const isRobberHere = board.robberTileId === tile.id;
            const isRobberPhase = phase === "robber";

            // Compute 6 corners
            const points = [0, 60, 120, 180, 240, 300]
              .map((angle) => {
                const rad = ((angle - 90) * Math.PI) / 180;
                return `${center.x + HEX_SIZE * Math.cos(rad)},${center.y + HEX_SIZE * Math.sin(rad)}`;
              })
              .join(" ");

            return (
              <g
                key={tile.id}
                onClick={() => {
                  if (isRobberPhase && onTileClick) {
                    onTileClick(tile.id);
                  }
                }}
                className={isRobberPhase ? "cursor-pointer transition-transform hover:opacity-90" : ""}
              >
                {/* Hex Polygon */}
                <polygon
                  points={points}
                  fill={style.bg}
                  stroke="#121212"
                  strokeWidth="3.5"
                  strokeLinejoin="round"
                />

                {/* Terrain Pattern / Icon */}
                <text
                  x={center.x}
                  y={center.y - (tile.diceNumber ? 12 : 0)}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize="22"
                  style={{ pointerEvents: "none" }}
                >
                  {style.icon}
                </text>

                {/* Number Token */}
                {tile.diceNumber && (
                  <g transform={`translate(${center.x}, ${center.y + 14})`}>
                    <circle
                      r="16"
                      fill="#fffdfa"
                      stroke="#121212"
                      strokeWidth="2.5"
                      filter="url(#inkShadow)"
                    />
                    <text
                      y="-1"
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontFamily="monospace"
                      fontWeight="900"
                      fontSize="14"
                      fill={tile.diceNumber === 6 || tile.diceNumber === 8 ? "#dc2626" : "#121212"}
                    >
                      {tile.diceNumber}
                    </text>
                    <text
                      y="10"
                      textAnchor="middle"
                      fontFamily="monospace"
                      fontWeight="900"
                      fontSize="8"
                      fill={tile.diceNumber === 6 || tile.diceNumber === 8 ? "#dc2626" : "#121212"}
                    >
                      {getPipDots(tile.diceNumber)}
                    </text>
                  </g>
                )}

                {/* Robber / Toner Bandit */}
                {isRobberHere && (
                  <g transform={`translate(${center.x}, ${center.y})`}>
                    <circle r="22" fill="#18181b" stroke="#facc15" strokeWidth="3" />
                    <text
                      y="2"
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize="16"
                    >
                      🦹
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </g>

        {/* 2. Ports Layer */}
        <g id="ports">
          {Object.values(board.vertices)
            .filter((v) => !!v.port)
            .map((v) => {
              const pos = vertexToPixel(v.q, v.r, v.dir, HEX_SIZE);
              const isSpecific = v.port?.type !== "three_to_one";
              const label = isSpecific ? `2:1 ${v.port?.type}` : "3:1 ⚓";
              return (
                <g key={`port-${v.id}`} transform={`translate(${pos.x}, ${pos.y})`}>
                  <circle r="6" fill="#facc15" stroke="#121212" strokeWidth="2" />
                  <rect
                    x="-24"
                    y="-20"
                    width="48"
                    height="14"
                    rx="3"
                    fill="#121212"
                    opacity="0.85"
                  />
                  <text
                    y="-11"
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="#fffdfa"
                    fontFamily="monospace"
                    fontSize="7"
                    fontWeight="bold"
                  >
                    {label}
                  </text>
                </g>
              );
            })}
        </g>

        {/* 3. Roads Layer */}
        <g id="roads">
          {Object.values(board.edges).map((edge) => {
            const v1 = board.vertices[edge.vertex1];
            const v2 = board.vertices[edge.vertex2];
            if (!v1 || !v2) return null;

            const p1 = vertexToPixel(v1.q, v1.r, v1.dir, HEX_SIZE);
            const p2 = vertexToPixel(v2.q, v2.r, v2.dir, HEX_SIZE);

            const road = board.roads[edge.id];
            const isValidSlot = validEdgeSlots.has(edge.id);
            const isSelected = selectedEdgeId === edge.id;

            if (road) {
              const owner = players.find((p) => p.id === road.playerId);
              const pal = owner ? PLAYER_COLOR_PALETTES[owner.color] : null;
              const color = pal?.primary || "#121212";

              return (
                <line
                  key={edge.id}
                  x1={p1.x}
                  y1={p1.y}
                  x2={p2.x}
                  y2={p2.y}
                  stroke={color}
                  strokeWidth="7"
                  strokeLinecap="round"
                  style={{ filter: "drop-shadow(1px 1px 0px #121212)" }}
                />
              );
            }

            if (isValidSlot) {
              return (
                <line
                  key={edge.id}
                  x1={p1.x}
                  y1={p1.y}
                  x2={p2.x}
                  y2={p2.y}
                  stroke={isSelected ? "#f59e0b" : "#ffffff"}
                  strokeWidth="8"
                  strokeDasharray="4 4"
                  strokeLinecap="round"
                  className="cursor-pointer transition-all hover:stroke-[#f59e0b] hover:stroke-width-[10]"
                  onClick={() => onEdgeClick && onEdgeClick(edge.id)}
                />
              );
            }

            return null;
          })}
        </g>

        {/* 4. Buildings & Vertex Click Slots Layer */}
        <g id="buildings">
          {Object.values(board.vertices).map((vertex) => {
            const pos = vertexToPixel(vertex.q, vertex.r, vertex.dir, HEX_SIZE);
            const building = board.buildings[vertex.id];
            const isValidSlot = validVertexSlots.has(vertex.id);
            const isSelected = selectedVertexId === vertex.id;

            if (building) {
              const owner = players.find((p) => p.id === building.playerId);
              const pal = owner ? PLAYER_COLOR_PALETTES[owner.color] : null;
              const color = pal?.primary || "#121212";

              if (building.type === "city") {
                // City / Ham HQ
                return (
                  <g
                    key={vertex.id}
                    transform={`translate(${pos.x}, ${pos.y})`}
                    onClick={() => isValidSlot && onVertexClick && onVertexClick(vertex.id)}
                    className={isValidSlot ? "cursor-pointer" : ""}
                  >
                    <rect
                      x="-12"
                      y="-12"
                      width="24"
                      height="24"
                      fill={color}
                      stroke="#121212"
                      strokeWidth="2.5"
                      rx="4"
                      filter="url(#inkShadow)"
                    />
                    <polygon
                      points="-12,-12 -6,-18 0,-12 6,-18 12,-12"
                      fill={color}
                      stroke="#121212"
                      strokeWidth="2"
                    />
                    <text
                      y="1"
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize="11"
                      fill="#ffffff"
                    >
                      HQ
                    </text>
                  </g>
                );
              }

              // Settlement / Hamlet
              return (
                <g
                  key={vertex.id}
                  transform={`translate(${pos.x}, ${pos.y})`}
                  onClick={() => isValidSlot && onVertexClick && onVertexClick(vertex.id)}
                  className={isValidSlot ? "cursor-pointer" : ""}
                >
                  <polygon
                    points="0,-14 11,-4 11,10 -11,10 -11,-4"
                    fill={color}
                    stroke="#121212"
                    strokeWidth="2.5"
                    filter="url(#inkShadow)"
                  />
                  <circle r="3" fill="#ffffff" cy="2" />
                </g>
              );
            }

            if (isValidSlot) {
              return (
                <g
                  key={vertex.id}
                  transform={`translate(${pos.x}, ${pos.y})`}
                  onClick={() => onVertexClick && onVertexClick(vertex.id)}
                  className="cursor-pointer transition-transform hover:scale-125"
                >
                  <circle
                    r={isSelected ? "11" : "8"}
                    fill={isSelected ? "#f59e0b" : "#ffffff"}
                    stroke="#121212"
                    strokeWidth="2.5"
                    strokeDasharray="2 2"
                    filter="url(#inkShadow)"
                  />
                </g>
              );
            }

            return null;
          })}
        </g>
      </svg>
    </div>
  );
}
