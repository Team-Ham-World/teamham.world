"use client";

import React, { useMemo, useState } from "react";
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
import { BanditPuff } from "./bandit-puff";
import type { BuildMode } from "./puffton-live-banner";

interface PufftonBoardViewProps {
  gameState: PufftonGameState;
  activeBuildMode?: BuildMode;
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
  activeBuildMode = null,
  onVertexClick,
  onEdgeClick,
  onTileClick,
  selectedVertexId,
  selectedEdgeId,
}: PufftonBoardViewProps) {
  const { board, players, activePlayerIndex, phase } = gameState;
  const activePlayer = players[activePlayerIndex];
  const humanPlayer = players.find((p) => !p.isBot) || players[0];
  const isHumanTurn = activePlayer?.id === humanPlayer.id;

  const [hoveredTileId, setHoveredTileId] = useState<string | null>(null);

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

    const padding = 65;
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
      // In step 1 (no selected vertex yet), any vertex obeying distance rule is valid
      if (!selectedVertexId) {
        for (const [vId] of Object.entries(board.vertices)) {
          if (satisfiesDistanceRule(vId, board)) {
            slots.add(vId);
          }
        }
      }
    } else if (phase === "action") {
      // Check settlement spots (if in settlement mode or general mode with resources)
      const canBuildSettlement =
        (activeBuildMode === "settlement" || activeBuildMode === null) &&
        activePlayer.settlementsLeft > 0 &&
        activePlayer.resources.brick >= 1 &&
        activePlayer.resources.timber >= 1 &&
        activePlayer.resources.paper >= 1 &&
        activePlayer.resources.feed >= 1;

      if (canBuildSettlement) {
        for (const [vId, v] of Object.entries(board.vertices)) {
          if (satisfiesDistanceRule(vId, board)) {
            const connected = v.adjacentEdges.some(
              (eId) => board.roads[eId]?.playerId === activePlayer.id,
            );
            if (connected) slots.add(vId);
          }
        }
      }

      // Check city upgrade spots (if in city mode or general mode with resources)
      const canBuildCity =
        (activeBuildMode === "city" || activeBuildMode === null) &&
        activePlayer.citiesLeft > 0 &&
        activePlayer.resources.toner >= 3 &&
        activePlayer.resources.paper >= 2;

      if (canBuildCity) {
        for (const [vId, b] of Object.entries(board.buildings)) {
          if (b.playerId === activePlayer.id && b.type === "settlement") {
            slots.add(vId);
          }
        }
      }
    }

    return slots;
  }, [board, activePlayer, phase, selectedVertexId, activeBuildMode]);

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
    } else if (
      ((phase === "action" && (activeBuildMode === "road" || activeBuildMode === null) && canAffordRoad) ||
        isFreeRoad) &&
      activePlayer.roadsLeft > 0
    ) {
      for (const [eId] of Object.entries(board.edges)) {
        if (canBuildRoad(activePlayer.id, eId, board, false)) {
          slots.add(eId);
        }
      }
    }

    return slots;
  }, [board, activePlayer, phase, selectedVertexId, activeBuildMode]);

  return (
    <div className="relative flex w-full items-center justify-center overflow-hidden rounded-2xl border-4 border-ink bg-[#a5f3fc] p-2 shadow-[6px_6px_0px_#121212] sm:p-4">
      {/* Water background subtle grid pattern */}
      <svg
        viewBox={`${minX} ${minY} ${width} ${height}`}
        className="h-auto max-h-[660px] w-full select-none"
        style={{ filter: "drop-shadow(0 4px 8px rgba(0,0,0,0.18))" }}
      >
        <defs>
          <filter id="inkShadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="2" dy="2" stdDeviation="0" floodColor="#121212" />
          </filter>
          <filter id="goldGlow" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="#f59e0b" />
          </filter>
          <filter id="emeraldGlow" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="#10b981" />
          </filter>
          <pattern id="waterWave" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M 0 10 Q 5 5, 10 10 T 20 10" fill="none" stroke="#38bdf8" strokeWidth="1.5" opacity="0.35" />
          </pattern>
        </defs>

        {/* Ocean Background Fill */}
        <rect
          x={minX}
          y={minY}
          width={width}
          height={height}
          fill="url(#waterWave)"
          className="pointer-events-none"
        />

        {/* 1. Hex Tiles Layer */}
        <g id="hex-tiles">
          {Object.values(board.tiles).map((tile) => {
            const center = hexToPixel(tile.q, tile.r, HEX_SIZE);
            const style = TERRAIN_STYLES[tile.terrain] || TERRAIN_STYLES.desert;
            const isRobberHere = board.robberTileId === tile.id;
            const isRobberPhase = phase === "robber" && isHumanTurn;
            const isHovered = hoveredTileId === tile.id;

            // Compute 6 corners of pointy-topped hex
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
                onMouseEnter={() => isRobberPhase && setHoveredTileId(tile.id)}
                onMouseLeave={() => isRobberPhase && setHoveredTileId(null)}
                className={isRobberPhase ? "cursor-pointer transition-transform hover:scale-[1.01]" : ""}
              >
                {/* Hex Polygon */}
                <polygon
                  points={points}
                  fill={style.bg}
                  stroke={isRobberPhase && isHovered ? "#ef4444" : "#121212"}
                  strokeWidth={isRobberPhase && isHovered ? "4.5" : "3.5"}
                  strokeLinejoin="round"
                  filter={isRobberPhase && isHovered ? "url(#goldGlow)" : undefined}
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
                  <g transform={`translate(${center.x}, ${center.y + 14})`} style={{ pointerEvents: "none" }}>
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
                      dominantBaseline="central"
                      fontFamily="monospace"
                      fontWeight="900"
                      fontSize="8"
                      fill={tile.diceNumber === 6 || tile.diceNumber === 8 ? "#dc2626" : "#121212"}
                    >
                      {getPipDots(tile.diceNumber)}
                    </text>
                  </g>
                )}

                {/* Robber / Bandit Puff */}
                {isRobberHere && (
                  <BanditPuff x={center.x} y={center.y} size={48} />
                )}

                {/* Ghost Bandit Puff preview when hovering tile during robber phase */}
                {isRobberPhase && isHovered && !isRobberHere && (
                  <BanditPuff x={center.x} y={center.y} size={48} isGhost={true} />
                )}
              </g>
            );
          })}
        </g>

        {/* 2. Ports Layer */}
        <g id="ports" className="pointer-events-none">
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
                    opacity="0.9"
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
                <g key={edge.id}>
                  {/* Road Border Shadow */}
                  <line
                    x1={p1.x}
                    y1={p1.y}
                    x2={p2.x}
                    y2={p2.y}
                    stroke="#121212"
                    strokeWidth="11"
                    strokeLinecap="round"
                  />
                  {/* Road Body */}
                  <line
                    x1={p1.x}
                    y1={p1.y}
                    x2={p2.x}
                    y2={p2.y}
                    stroke={color}
                    strokeWidth="7"
                    strokeLinecap="round"
                  />
                </g>
              );
            }

            return (
              <g key={edge.id}>
                {/* Visual Indicator for Valid Slots */}
                {isValidSlot && (
                  <>
                    {/* Glowing underlay */}
                    <line
                      x1={p1.x}
                      y1={p1.y}
                      x2={p2.x}
                      y2={p2.y}
                      stroke="#f59e0b"
                      strokeWidth="12"
                      strokeLinecap="round"
                      opacity="0.6"
                      filter="url(#goldGlow)"
                    />
                    {/* Dashed action line */}
                    <line
                      x1={p1.x}
                      y1={p1.y}
                      x2={p2.x}
                      y2={p2.y}
                      stroke={isSelected ? "#f59e0b" : "#ffffff"}
                      strokeWidth="8"
                      strokeDasharray="5 4"
                      strokeLinecap="round"
                      className="pointer-events-none"
                    />
                  </>
                )}

                {/* Generous Invisible Click Hitbox (26px width) */}
                {isHumanTurn && (
                  <line
                    x1={p1.x}
                    y1={p1.y}
                    x2={p2.x}
                    y2={p2.y}
                    stroke="transparent"
                    strokeWidth="26"
                    strokeLinecap="round"
                    className="cursor-pointer"
                    onClick={() => onEdgeClick && onEdgeClick(edge.id)}
                  />
                )}
              </g>
            );
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
                    onClick={() => isHumanTurn && onVertexClick && onVertexClick(vertex.id)}
                    className={isHumanTurn ? "cursor-pointer" : ""}
                  >
                    <rect
                      x="-14"
                      y="-14"
                      width="28"
                      height="28"
                      fill={color}
                      stroke="#121212"
                      strokeWidth="3"
                      rx="4"
                      filter="url(#inkShadow)"
                    />
                    <polygon
                      points="-14,-14 -7,-20 0,-14 7,-20 14,-14"
                      fill={color}
                      stroke="#121212"
                      strokeWidth="2.5"
                    />
                    <text
                      y="1"
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontFamily="monospace"
                      fontWeight="900"
                      fontSize="12"
                      fill="#ffffff"
                    >
                      HQ
                    </text>
                    {/* Generous Hitbox */}
                    <circle r="20" fill="transparent" />
                  </g>
                );
              }

              // Settlement / Hamlet
              return (
                <g
                  key={vertex.id}
                  transform={`translate(${pos.x}, ${pos.y})`}
                  onClick={() => isHumanTurn && onVertexClick && onVertexClick(vertex.id)}
                  className={isHumanTurn ? "cursor-pointer" : ""}
                >
                  {/* Upgradable highlight if in city mode or can upgrade */}
                  {isValidSlot && activeBuildMode === "city" && (
                    <circle
                      r="18"
                      fill="none"
                      stroke="#f59e0b"
                      strokeWidth="3"
                      strokeDasharray="3 3"
                      filter="url(#goldGlow)"
                    />
                  )}

                  <polygon
                    points="0,-16 13,-4 13,12 -13,12 -13,-4"
                    fill={color}
                    stroke="#121212"
                    strokeWidth="3"
                    filter="url(#inkShadow)"
                  />
                  <circle r="3.5" fill="#ffffff" cy="3" />
                  {/* Generous Hitbox */}
                  <circle r="20" fill="transparent" />
                </g>
              );
            }

            // Unoccupied Vertex Slot
            return (
              <g
                key={vertex.id}
                transform={`translate(${pos.x}, ${pos.y})`}
                onClick={() => isHumanTurn && onVertexClick && onVertexClick(vertex.id)}
                className={isHumanTurn ? "cursor-pointer" : ""}
              >
                {/* Visual Indicator for Selected / Valid Slots */}
                {isSelected ? (
                  <g>
                    {/* Flashing Beacon for Selected Hamlet in Setup */}
                    <circle
                      r="16"
                      fill="#f59e0b"
                      opacity="0.4"
                      filter="url(#goldGlow)"
                    />
                    <circle
                      r="12"
                      fill="#fbbf24"
                      stroke="#121212"
                      strokeWidth="3"
                      filter="url(#inkShadow)"
                    />
                    <text
                      y="0"
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize="10"
                    >
                      🏠
                    </text>
                  </g>
                ) : isValidSlot ? (
                  <g className="transition-transform hover:scale-125">
                    {/* Glowing outer aura */}
                    <circle
                      r="12"
                      fill="#ffffff"
                      opacity="0.5"
                      filter="url(#emeraldGlow)"
                    />
                    {/* Inner dashed ring */}
                    <circle
                      r="9"
                      fill="#ffffff"
                      stroke="#121212"
                      strokeWidth="2.5"
                      strokeDasharray="3 2"
                      filter="url(#inkShadow)"
                    />
                  </g>
                ) : null}

                {/* Generous Invisible Click Hitbox (r=20) */}
                {isHumanTurn && <circle r="20" fill="transparent" />}
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
