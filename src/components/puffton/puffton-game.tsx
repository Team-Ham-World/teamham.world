"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { getHexVertices } from "@/lib/puffton/board";
import { stepBot } from "@/lib/puffton/bot";
import {
  buildCityAction,
  buildRoadAction,
  buildSettlementAction,
  buyDevCardAction,
  canBuildRoad,
  createPufftonGame,
  endTurnAction,
  handleMoveRobber,
  handleSetupPlacement,
  hasRoadConnectivityToVertex,
  playDevCardAction,
  rollDice,
  satisfiesDistanceRule,
  type CreateGameOptions,
} from "@/lib/puffton/engine";
import type { PufftonLeaderboardSnapshot, PufftonStats } from "@/lib/puffton/leaderboard";
import type { DevCard, PufftonGameState, ResourceType } from "@/lib/puffton/types";
import { pufftonAudio } from "./puffton-audio";
import { PufftonBoardView } from "./puffton-board-view";
import { PufftonHud } from "./puffton-hud";
import { PufftonLeaderboardModal } from "./puffton-leaderboard-modal";
import { PufftonLiveBanner, type BuildMode } from "./puffton-live-banner";
import { PufftonLobby } from "./puffton-lobby";
import { PufftonMascot } from "./puffton-mascot";
import { PufftonTradeModal } from "./puffton-trade-modal";

const LOCAL_STATS_KEY = "teamham_puffton_stats_v1";

interface LeaderboardState {
  status: "idle" | "loading" | "ready" | "error" | "saving";
  authenticated: boolean;
  username: string | null;
  snapshot?: PufftonLeaderboardSnapshot;
}

export function PufftonGame() {
  const [inGame, setInGame] = useState(false);
  const [gameState, setGameState] = useState<PufftonGameState | null>(null);

  // Active Construction / Build Mode
  const [activeBuildMode, setActiveBuildMode] = useState<BuildMode>(null);

  // Selection states for multi-step placement
  const [selectedVertexId, setSelectedVertexId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  // Feedback Notification Toast
  const [feedbackMessage, setFeedbackMessage] = useState<{
    text: string;
    type: "info" | "warning" | "success";
  } | null>(null);

  const feedbackTimerRef = useRef<NodeJS.Timeout | null>(null);

  const showFeedback = useCallback(
    (text: string, type: "info" | "warning" | "success" = "warning") => {
      if (feedbackTimerRef.current) {
        clearTimeout(feedbackTimerRef.current);
      }
      setFeedbackMessage({ text, type });
      feedbackTimerRef.current = setTimeout(() => {
        setFeedbackMessage(null);
      }, 4500);
    },
    [],
  );

  // Modals
  const [showTradeModal, setShowTradeModal] = useState(false);
  const [showLeaderboardModal, setShowLeaderboardModal] = useState(false);
  const [gameLogOpen, setGameLogOpen] = useState(false);

  // Leaderboard
  const [leaderboard, setLeaderboard] = useState<LeaderboardState>({
    status: "idle",
    authenticated: false,
    username: null,
  });

  const [localStats, setLocalStats] = useState<PufftonStats>({
    gamesPlayed: 0,
    gamesWon: 0,
    totalVp: 0,
    currentStreak: 0,
    maxStreak: 0,
  });

  // Load Leaderboard
  const loadLeaderboard = useCallback(async () => {
    try {
      setLeaderboard((prev) => ({ ...prev, status: "loading" }));
      const res = await fetch("/api/puffton/leaderboard", {
        method: "GET",
        credentials: "same-origin",
      });
      if (!res.ok) {
        setLeaderboard({ status: "ready", authenticated: false, username: null });
        return;
      }
      const data = (await res.json()) as {
        authenticated: boolean;
        username: string | null;
        personalBest: number;
        stats: PufftonStats;
        scores: PufftonLeaderboardSnapshot["scores"];
      };
      setLeaderboard({
        status: "ready",
        authenticated: data.authenticated,
        username: data.username,
        snapshot: {
          personalBest: data.personalBest,
          stats: data.stats,
          scores: data.scores,
        },
      });
    } catch {
      setLeaderboard({ status: "error", authenticated: false, username: null });
    }
  }, []);

  // Hydrate local stats and leaderboard
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      void loadLeaderboard();
      try {
        const stored = localStorage.getItem(LOCAL_STATS_KEY);
        if (stored) {
          const parsed = JSON.parse(stored) as PufftonStats;
          if (Number.isInteger(parsed.gamesPlayed)) {
            setLocalStats(parsed);
          }
        }
      } catch {
        // LocalStorage fallback
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [loadLeaderboard]);

  // Submit score when game ends
  const submittedGameIdRef = useRef<string | null>(null);

  const submitScore = useCallback(
    async (finalVp: number, won: boolean) => {
      const nextStats: PufftonStats = {
        gamesPlayed: localStats.gamesPlayed + 1,
        gamesWon: localStats.gamesWon + (won ? 1 : 0),
        totalVp: localStats.totalVp + finalVp,
        currentStreak: won ? localStats.currentStreak + 1 : 0,
        maxStreak: won ? Math.max(localStats.maxStreak, localStats.currentStreak + 1) : localStats.maxStreak,
      };
      setLocalStats(nextStats);
      try {
        localStorage.setItem(LOCAL_STATS_KEY, JSON.stringify(nextStats));
      } catch {
        // Storage fallback
      }

      if (!leaderboard.authenticated) return;

      try {
        const res = await fetch("/api/puffton/leaderboard", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            score: won ? finalVp : 0,
            gamesPlayed: nextStats.gamesPlayed,
            gamesWon: nextStats.gamesWon,
            totalVp: nextStats.totalVp,
            currentStreak: nextStats.currentStreak,
            maxStreak: nextStats.maxStreak,
          }),
        });
        if (res.ok) {
          const data = (await res.json()) as PufftonLeaderboardSnapshot & {
            authenticated: boolean;
            username: string | null;
          };
          setLeaderboard({
            status: "ready",
            authenticated: data.authenticated,
            username: data.username,
            snapshot: data,
          });
        }
      } catch {
        // Ignore submission failure
      }
    },
    [leaderboard.authenticated, localStats],
  );

  // Check Game Over
  useEffect(() => {
    if (!gameState || gameState.phase !== "game_over" || !gameState.winnerId) return;
    if (submittedGameIdRef.current === gameState.id) return;
    submittedGameIdRef.current = gameState.id;

    pufftonAudio.playVictory();
    const human = gameState.players.find((p) => !p.isBot);
    const won = gameState.winnerId === human?.id;
    void submitScore(human?.victoryPoints || 0, won);
  }, [gameState, submitScore]);

  // Bot Turn Automation Loop
  useEffect(() => {
    if (!gameState || !inGame || gameState.phase === "game_over") return;

    const activePlayer = gameState.players[gameState.activePlayerIndex];
    if (!activePlayer || !activePlayer.isBot) return;

    const timer = setTimeout(() => {
      setGameState((prev) => {
        if (!prev) return prev;
        const next = { ...prev };
        stepBot(next);
        return { ...next };
      });
    }, 700);

    return () => clearTimeout(timer);
  }, [gameState, inGame]);

  // Launch Game from Lobby
  const handleStartGame = (options: CreateGameOptions) => {
    const newGame = createPufftonGame(options);
    setGameState(newGame);
    setInGame(true);
    setSelectedVertexId(null);
    setSelectedEdgeId(null);
    setActiveBuildMode(null);
    setFeedbackMessage(null);
  };

  // Human Player Actions
  const handleRollDice = () => {
    if (!gameState) return;
    pufftonAudio.playDiceRoll();
    setGameState((prev) => {
      if (!prev) return prev;
      const next = { ...prev };
      const [d1, d2] = rollDice(next);
      if (d1 + d2 === 7) {
        showFeedback("🦹 7 Rolled! Bandit Puff descends! Move Bandit Puff to block enemy tiles.", "warning");
      } else {
        showFeedback(`🎲 Rolled a ${d1 + d2} (${d1} + ${d2})! Resources harvested.`, "info");
      }
      return { ...next };
    });
  };

  const handleToggleBuildMode = (mode: BuildMode) => {
    if (!gameState) return;
    const human = gameState.players.find((p) => !p.isBot);
    if (!human) return;

    if (mode === "road") {
      if (human.roadsLeft <= 0) {
        showFeedback("⚠️ You have built all 15 Wireways!", "warning");
        return;
      }
      if (human.resources.brick < 1 || human.resources.timber < 1) {
        showFeedback("⚠️ Need 1 Brick 🧱 and 1 Timber 🌲 to build a Wireway.", "warning");
        return;
      }
      showFeedback("🛣️ Wireway Mode Active: Click glowing paths connected to your network.", "info");
    } else if (mode === "settlement") {
      if (human.settlementsLeft <= 0) {
        showFeedback("⚠️ You have built all 5 Hamlets!", "warning");
        return;
      }
      if (
        human.resources.brick < 1 ||
        human.resources.timber < 1 ||
        human.resources.paper < 1 ||
        human.resources.feed < 1
      ) {
        showFeedback(
          "⚠️ Need 1 Brick 🧱, 1 Timber 🌲, 1 Paper 📜, and 1 Feed 🌽 to establish a Hamlet.",
          "warning",
        );
        return;
      }
      showFeedback("🏠 Hamlet Mode Active: Click valid intersections at least 2 paths away.", "info");
    } else if (mode === "city") {
      if (human.citiesLeft <= 0) {
        showFeedback("⚠️ You have built all 4 Ham HQs!", "warning");
        return;
      }
      if (human.resources.toner < 3 || human.resources.paper < 2) {
        showFeedback("⚠️ Need 3 Toner 🖨️ and 2 Paper 📜 to upgrade to Ham HQ.", "warning");
        return;
      }
      showFeedback("🏛️ Ham HQ Mode Active: Click any of your existing Hamlets to upgrade.", "info");
    }

    setActiveBuildMode(mode);
  };

  const handleVertexClick = (vertexId: string) => {
    if (!gameState) return;
    const { phase, activePlayerIndex, players, board } = gameState;
    const activePlayer = players[activePlayerIndex];
    if (activePlayer?.isBot) return;

    // 1. SETUP PHASES (Step 1: Pick Hamlet)
    if (phase === "setup_round_1" || phase === "setup_round_2") {
      if (!satisfiesDistanceRule(vertexId, board)) {
        showFeedback(
          "⚠️ Distance Rule: Hamlets must be at least 2 paths away from any other settlement.",
          "warning",
        );
        return;
      }

      setSelectedVertexId(vertexId);
      setSelectedEdgeId(null);
      pufftonAudio.playBuild();
      showFeedback(
        "✅ Hamlet location selected! Now click an adjacent glowing path to lay your starting Wireway.",
        "info",
      );
      return;
    }

    // 2. ACTION PHASE
    if (phase === "action") {
      const existing = board.buildings[vertexId];

      if (existing) {
        if (existing.playerId !== activePlayer.id) {
          showFeedback("⚠️ That site is claimed by an opponent.", "warning");
          return;
        }

        if (existing.type === "city") {
          showFeedback("ℹ️ This site is already a Ham HQ.", "info");
          return;
        }

        // Existing settlement owned by active player -> City Upgrade
        if (activePlayer.citiesLeft <= 0) {
          showFeedback("⚠️ Maximum reached: You have built all 4 Ham HQs.", "warning");
          return;
        }

        if (activePlayer.resources.toner < 3 || activePlayer.resources.paper < 2) {
          showFeedback("⚠️ Insufficient resources: Upgrading to Ham HQ requires 3 Toner 🖨️ and 2 Paper 📜.", "warning");
          return;
        }

        setGameState((prev) => {
          if (!prev) return prev;
          const next = { ...prev };
          if (buildCityAction(next, vertexId)) {
            pufftonAudio.playBuild();
            showFeedback("🏛️ Upgraded to Ham HQ! (2 VP + 2x Resource Harvests)", "success");
            setActiveBuildMode(null);
          }
          return { ...next };
        });
        return;
      }

      // Empty Vertex -> Settlement Placement
      if (activePlayer.settlementsLeft <= 0) {
        showFeedback("⚠️ Maximum reached: You have built all 5 Hamlets.", "warning");
        return;
      }

      if (
        activePlayer.resources.brick < 1 ||
        activePlayer.resources.timber < 1 ||
        activePlayer.resources.paper < 1 ||
        activePlayer.resources.feed < 1
      ) {
        showFeedback(
          "⚠️ Insufficient resources: Hamlet requires 1 Brick 🧱, 1 Timber 🌲, 1 Paper 📜, and 1 Feed 🌽.",
          "warning",
        );
        return;
      }

      if (!satisfiesDistanceRule(vertexId, board)) {
        showFeedback(
          "⚠️ Distance Rule: Hamlets must be at least 2 paths away from any other settlement.",
          "warning",
        );
        return;
      }

      if (!hasRoadConnectivityToVertex(activePlayer.id, vertexId, board)) {
        showFeedback(
          "⚠️ Connectivity: Hamlets must connect directly to your existing Wireway network.",
          "warning",
        );
        return;
      }

      setGameState((prev) => {
        if (!prev) return prev;
        const next = { ...prev };
        if (buildSettlementAction(next, vertexId)) {
          pufftonAudio.playBuild();
          showFeedback("🏠 Established a new Hamlet! (+1 VP)", "success");
          setActiveBuildMode(null);
        }
        return { ...next };
      });
    }
  };

  const handleEdgeClick = (edgeId: string) => {
    if (!gameState) return;
    const { phase, activePlayerIndex, players, board } = gameState;
    const activePlayer = players[activePlayerIndex];
    if (activePlayer?.isBot) return;

    // 1. SETUP PHASES (Step 2: Pick Connected Wireway)
    if (phase === "setup_round_1" || phase === "setup_round_2") {
      if (!selectedVertexId) {
        showFeedback("⚠️ Step 1: Click a settlement site first, then select a connected Wireway.", "warning");
        return;
      }

      const vertex = board.vertices[selectedVertexId];
      if (!vertex?.adjacentEdges.includes(edgeId)) {
        showFeedback("⚠️ Starting Wireway must connect directly to your selected Hamlet.", "warning");
        return;
      }

      setGameState((prev) => {
        if (!prev) return prev;
        const next = { ...prev };
        if (handleSetupPlacement(next, selectedVertexId, edgeId)) {
          pufftonAudio.playBuild();
          setSelectedVertexId(null);
          setSelectedEdgeId(null);
          showFeedback("✅ Starting Hamlet and Wireway placed!", "success");
        }
        return { ...next };
      });
      return;
    }

    // 2. ACTION & ROAD BUILDING PHASES
    if (phase === "action" || phase === "road_building_1" || phase === "road_building_2") {
      if (board.roads[edgeId]) {
        showFeedback("⚠️ That path is already occupied by a Wireway.", "warning");
        return;
      }

      if (activePlayer.roadsLeft <= 0) {
        showFeedback("⚠️ Maximum reached: You have deployed all 15 Wireways.", "warning");
        return;
      }

      const isFreeRoad = phase === "road_building_1" || phase === "road_building_2";
      if (!isFreeRoad && (activePlayer.resources.brick < 1 || activePlayer.resources.timber < 1)) {
        showFeedback("⚠️ Insufficient resources: Wireway requires 1 Brick 🧱 and 1 Timber 🌲.", "warning");
        return;
      }

      if (!canBuildRoad(activePlayer.id, edgeId, board, false)) {
        showFeedback("⚠️ Connectivity: Wireways must connect to your existing roads or Hamlets.", "warning");
        return;
      }

      setGameState((prev) => {
        if (!prev) return prev;
        const next = { ...prev };
        if (buildRoadAction(next, edgeId)) {
          pufftonAudio.playBuild();
          showFeedback("🛣️ Deployed a new Wireway!", "success");
          if (!isFreeRoad && (activePlayer.resources.brick < 1 || activePlayer.resources.timber < 1)) {
            setActiveBuildMode(null);
          }
        }
        return { ...next };
      });
    }
  };

  const handleTileClick = (tileId: string) => {
    if (!gameState || gameState.phase !== "robber") return;
    const activePlayer = gameState.players[gameState.activePlayerIndex];
    if (activePlayer?.isBot) return;

    if (tileId === gameState.board.robberTileId) {
      showFeedback("⚠️ Bandit Puff is already occupying this tile! Select a different hex.", "warning");
      return;
    }

    // Find any opponent settlements touching this tile to steal from
    const tile = gameState.board.tiles[tileId];
    let candidateTargetId: string | undefined;

    if (tile) {
      const verts = getHexVertices(tile.q, tile.r);
      const enemyPlayersWithCards: string[] = [];

      for (const vId of verts) {
        const b = gameState.board.buildings[vId];
        if (b && b.playerId !== activePlayer.id) {
          const enemy = gameState.players.find((p) => p.id === b.playerId);
          const totalCards = enemy ? Object.values(enemy.resources).reduce((s, n) => s + n, 0) : 0;
          if (totalCards > 0 && !enemyPlayersWithCards.includes(b.playerId)) {
            enemyPlayersWithCards.push(b.playerId);
          }
        }
      }

      if (enemyPlayersWithCards.length > 0) {
        candidateTargetId = enemyPlayersWithCards[Math.floor(Math.random() * enemyPlayersWithCards.length)];
      }
    }

    setGameState((prev) => {
      if (!prev) return prev;
      const next = { ...prev };
      if (handleMoveRobber(next, tileId, candidateTargetId)) {
        pufftonAudio.playBandit();
        showFeedback("🦹 Bandit Puff relocated! Tile production blocked.", "success");
      }
      return { ...next };
    });
  };

  const handleBuyDevCard = () => {
    if (!gameState) return;
    const activePlayer = gameState.players[gameState.activePlayerIndex];
    if (activePlayer.resources.toner < 1 || activePlayer.resources.paper < 1 || activePlayer.resources.feed < 1) {
      showFeedback("⚠️ Insufficient resources: Ham Card costs 1 Toner 🖨️, 1 Paper 📜, and 1 Feed 🌽.", "warning");
      return;
    }

    setGameState((prev) => {
      if (!prev) return prev;
      const next = { ...prev };
      if (buyDevCardAction(next)) {
        pufftonAudio.playTrade();
        showFeedback("🃏 Researched a new Ham Card!", "success");
      }
      return { ...next };
    });
  };

  const handlePlayDevCard = (card: DevCard) => {
    if (!gameState) return;

    // Handle interactive cards like Year of Plenty and Monopoly
    let params: { resource1?: ResourceType; resource2?: ResourceType; monopolyResource?: ResourceType } | undefined;
    if (card.type === "year_of_plenty") {
      params = { resource1: "brick", resource2: "timber" };
    } else if (card.type === "monopoly") {
      params = { monopolyResource: "toner" };
    }

    setGameState((prev) => {
      if (!prev) return prev;
      const next = { ...prev };
      if (playDevCardAction(next, card.id, params)) {
        pufftonAudio.playTrade();
        if (card.type === "knight") {
          showFeedback("🛡️ Toner Guard deployed! Reposition Bandit Puff now.", "success");
        } else if (card.type === "road_building") {
          showFeedback("🛤️ Wire Spool activated! Click a path for your 1st free Wireway.", "success");
        } else if (card.type === "year_of_plenty") {
          showFeedback("🌾 Toner Surplus claimed! 2 resources added.", "success");
        } else if (card.type === "monopoly") {
          showFeedback("💎 Market Monopoly executed! Seized target resources.", "success");
        }
      }
      return { ...next };
    });
  };

  const handleEndTurn = () => {
    if (!gameState) return;
    setSelectedVertexId(null);
    setSelectedEdgeId(null);
    setActiveBuildMode(null);
    setGameState((prev) => {
      if (!prev) return prev;
      const next = { ...prev };
      endTurnAction(next);
      return { ...next };
    });
  };

  return (
    <div className="w-full max-w-7xl">
      {/* Top Controls & Navigation */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="rounded-lg border-2 border-ink bg-white px-3 py-1.5 font-mono text-xs font-black uppercase text-ink shadow-[2px_2px_0px_#121212] hover:bg-neutral-100"
          >
            ← Team HAM HQ
          </Link>
          <span className="font-mono text-sm font-black text-ink">PUFFTON</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowLeaderboardModal(true)}
            className="flex items-center gap-1.5 rounded-lg border-2 border-ink bg-amber-200 px-3 py-1.5 font-mono text-xs font-black uppercase text-ink shadow-[2px_2px_0px_#121212] hover:bg-amber-100 cursor-pointer"
          >
            🏆 Leaderboard
          </button>

          {inGame && (
            <button
              type="button"
              onClick={() => setInGame(false)}
              className="rounded-lg border-2 border-ink bg-white px-3 py-1.5 font-mono text-xs font-black uppercase text-ink shadow-[2px_2px_0px_#121212] hover:bg-neutral-100 cursor-pointer"
            >
              ⚙️ Leave Match
            </button>
          )}
        </div>
      </div>

      {!inGame || !gameState ? (
        /* Lobby View */
        <PufftonLobby
          onStartGame={handleStartGame}
          defaultUsername={leaderboard.username || undefined}
        />
      ) : (
        /* In-Game View */
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Main Board View (Left 8 Cols) */}
          <div className="flex flex-col gap-4 lg:col-span-8">
            {/* Live Action Banner above the board */}
            <PufftonLiveBanner
              gameState={gameState}
              activeBuildMode={activeBuildMode}
              selectedVertexId={selectedVertexId}
              onCancelBuildMode={() => setActiveBuildMode(null)}
              onCancelVertexSelection={() => {
                setSelectedVertexId(null);
                setSelectedEdgeId(null);
                showFeedback("Hamlet location unselected. Choose a new site.", "info");
              }}
              onRollDice={handleRollDice}
              feedbackMessage={feedbackMessage}
              onDismissFeedback={() => setFeedbackMessage(null)}
            />

            {/* Mascot Companion */}
            <PufftonMascot gameState={gameState} />

            {/* SVG Board */}
            <PufftonBoardView
              gameState={gameState}
              activeBuildMode={activeBuildMode}
              onVertexClick={handleVertexClick}
              onEdgeClick={handleEdgeClick}
              onTileClick={handleTileClick}
              selectedVertexId={selectedVertexId}
              selectedEdgeId={selectedEdgeId}
            />

            {/* Match Log toggle */}
            <div className="rounded-xl border-2 border-ink bg-white p-3 shadow-[3px_3px_0px_#121212]">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-black uppercase text-neutral-600">
                  Tactical Transmission Log ({gameState.log.length} Events)
                </span>
                <button
                  type="button"
                  onClick={() => setGameLogOpen(!gameLogOpen)}
                  className="font-mono text-xs font-bold text-interactive-blue underline cursor-pointer"
                >
                  {gameLogOpen ? "Hide Log" : "Show Full Log"}
                </button>
              </div>

              <div className="mt-2 space-y-1 font-mono text-xs text-neutral-700">
                {gameState.log
                  .slice(gameLogOpen ? -15 : -3)
                  .reverse()
                  .map((entry) => (
                    <div key={entry.id} className="flex gap-2">
                      <span className="text-neutral-400">T{entry.turn}:</span>
                      <span>{entry.text}</span>
                    </div>
                  ))}
              </div>
            </div>
          </div>

          {/* Right Sidebar: HUD & Player Controls (Right 4 Cols) */}
          <div className="flex flex-col gap-4 lg:col-span-4">
            <PufftonHud
              gameState={gameState}
              activeBuildMode={activeBuildMode}
              onToggleBuildMode={handleToggleBuildMode}
              onRollDice={handleRollDice}
              onOpenTrade={() => setShowTradeModal(true)}
              onBuyDevCard={handleBuyDevCard}
              onPlayDevCard={handlePlayDevCard}
              onEndTurn={handleEndTurn}
            />
          </div>
        </div>
      )}

      {/* Trade Modal */}
      {showTradeModal && gameState && (
        <PufftonTradeModal
          gameState={gameState}
          onClose={() => setShowTradeModal(false)}
          onTradeComplete={() => {
            setGameState((prev) => (prev ? { ...prev } : prev));
          }}
        />
      )}

      {/* Leaderboard Modal */}
      {showLeaderboardModal && (
        <PufftonLeaderboardModal
          leaderboard={leaderboard}
          onClose={() => setShowLeaderboardModal(false)}
        />
      )}
    </div>
  );
}
