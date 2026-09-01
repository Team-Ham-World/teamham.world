"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { stepBot } from "@/lib/puffton/bot";
import {
  buildCityAction,
  buildRoadAction,
  buildSettlementAction,
  buyDevCardAction,
  createPufftonGame,
  endTurnAction,
  handleMoveRobber,
  handleSetupPlacement,
  playDevCardAction,
  rollDice,
  type CreateGameOptions,
} from "@/lib/puffton/engine";
import type { PufftonLeaderboardSnapshot, PufftonStats } from "@/lib/puffton/leaderboard";
import type { DevCard, PufftonGameState } from "@/lib/puffton/types";
import { pufftonAudio } from "./puffton-audio";
import { PufftonBoardView } from "./puffton-board-view";
import { PufftonHud } from "./puffton-hud";
import { PufftonLeaderboardModal } from "./puffton-leaderboard-modal";
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

  // Selection states for multi-step placement
  const [selectedVertexId, setSelectedVertexId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

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
  };

  // Human Player Actions
  const handleRollDice = () => {
    if (!gameState) return;
    pufftonAudio.playDiceRoll();
    setGameState((prev) => {
      if (!prev) return prev;
      const next = { ...prev };
      rollDice(next);
      return { ...next };
    });
  };

  const handleVertexClick = (vertexId: string) => {
    if (!gameState) return;
    const { phase, activePlayerIndex, players, board } = gameState;
    const activePlayer = players[activePlayerIndex];
    if (activePlayer?.isBot) return;

    if (phase === "setup_round_1" || phase === "setup_round_2") {
      // In setup, selecting a vertex enables road edge selection
      setSelectedVertexId(vertexId);
      setSelectedEdgeId(null);
      pufftonAudio.playBuild();
      return;
    }

    if (phase === "action") {
      const existing = board.buildings[vertexId];
      if (existing && existing.playerId === activePlayer.id && existing.type === "settlement") {
        // Upgrade to city
        setGameState((prev) => {
          if (!prev) return prev;
          const next = { ...prev };
          if (buildCityAction(next, vertexId)) {
            pufftonAudio.playBuild();
          }
          return { ...next };
        });
      } else {
        // Build settlement
        setGameState((prev) => {
          if (!prev) return prev;
          const next = { ...prev };
          if (buildSettlementAction(next, vertexId)) {
            pufftonAudio.playBuild();
          }
          return { ...next };
        });
      }
    }
  };

  const handleEdgeClick = (edgeId: string) => {
    if (!gameState) return;
    const { phase, activePlayerIndex, players } = gameState;
    const activePlayer = players[activePlayerIndex];
    if (activePlayer?.isBot) return;

    if ((phase === "setup_round_1" || phase === "setup_round_2") && selectedVertexId) {
      // Complete setup placement (settlement + road)
      setGameState((prev) => {
        if (!prev) return prev;
        const next = { ...prev };
        if (handleSetupPlacement(next, selectedVertexId, edgeId)) {
          pufftonAudio.playBuild();
          setSelectedVertexId(null);
          setSelectedEdgeId(null);
        }
        return { ...next };
      });
      return;
    }

    if (phase === "action" || phase === "road_building_1" || phase === "road_building_2") {
      setGameState((prev) => {
        if (!prev) return prev;
        const next = { ...prev };
        if (buildRoadAction(next, edgeId)) {
          pufftonAudio.playBuild();
        }
        return { ...next };
      });
    }
  };

  const handleTileClick = (tileId: string) => {
    if (!gameState || gameState.phase !== "robber") return;
    const activePlayer = gameState.players[gameState.activePlayerIndex];
    if (activePlayer?.isBot) return;

    setGameState((prev) => {
      if (!prev) return prev;
      const next = { ...prev };
      if (handleMoveRobber(next, tileId)) {
        pufftonAudio.playBandit();
      }
      return { ...next };
    });
  };

  const handleBuyDevCard = () => {
    if (!gameState) return;
    setGameState((prev) => {
      if (!prev) return prev;
      const next = { ...prev };
      if (buyDevCardAction(next)) {
        pufftonAudio.playTrade();
      }
      return { ...next };
    });
  };

  const handlePlayDevCard = (card: DevCard) => {
    if (!gameState) return;
    setGameState((prev) => {
      if (!prev) return prev;
      const next = { ...prev };
      if (playDevCardAction(next, card.id)) {
        pufftonAudio.playTrade();
      }
      return { ...next };
    });
  };

  const handleEndTurn = () => {
    if (!gameState) return;
    setSelectedVertexId(null);
    setSelectedEdgeId(null);
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
            className="flex items-center gap-1.5 rounded-lg border-2 border-ink bg-amber-200 px-3 py-1.5 font-mono text-xs font-black uppercase text-ink shadow-[2px_2px_0px_#121212] hover:bg-amber-100"
          >
            🏆 Leaderboard
          </button>

          {inGame && (
            <button
              type="button"
              onClick={() => setInGame(false)}
              className="rounded-lg border-2 border-ink bg-white px-3 py-1.5 font-mono text-xs font-black uppercase text-ink shadow-[2px_2px_0px_#121212] hover:bg-neutral-100"
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
            <PufftonMascot gameState={gameState} />

            <PufftonBoardView
              gameState={gameState}
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
                  className="font-mono text-xs font-bold text-interactive-blue underline"
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
