"use client";

import React from "react";
import {
  PLAYER_COLOR_PALETTES,
  type PufftonGameState,
} from "@/lib/puffton/types";

export type BuildMode = "road" | "settlement" | "city" | null;

interface PufftonLiveBannerProps {
  gameState: PufftonGameState;
  activeBuildMode: BuildMode;
  selectedVertexId: string | null;
  onCancelBuildMode: () => void;
  onCancelVertexSelection: () => void;
  onRollDice: () => void;
  feedbackMessage: { text: string; type: "info" | "warning" | "success" } | null;
  onDismissFeedback: () => void;
}

export function PufftonLiveBanner({
  gameState,
  activeBuildMode,
  selectedVertexId,
  onCancelBuildMode,
  onCancelVertexSelection,
  onRollDice,
  feedbackMessage,
  onDismissFeedback,
}: PufftonLiveBannerProps) {
  const { phase, players, activePlayerIndex, winnerId, turnNumber } = gameState;
  const activePlayer = players[activePlayerIndex];
  const humanPlayer = players.find((p) => !p.isBot) || players[0];
  const isHumanTurn = activePlayer?.id === humanPlayer.id;
  const pal = activePlayer ? PLAYER_COLOR_PALETTES[activePlayer.color] : null;

  // Derive Banner Details based on game phase and selection state
  let badgeLabel = "TURN";
  let badgeBg = "bg-neutral-800 text-white";
  let bannerTitle = "";
  let bannerInstruction = "";
  let actionSlot: React.ReactNode = null;

  if (phase === "game_over" || winnerId) {
    const winner = players.find((p) => p.id === winnerId);
    badgeLabel = "👑 VICTORY";
    badgeBg = "bg-amber-400 text-ink";
    bannerTitle = `${winner?.name || "Commander"} Has Conquered Puffton!`;
    bannerInstruction = "Match concluded! Review final settlements and victory points on the scoreboard.";
  } else if (!isHumanTurn) {
    badgeLabel = "⏳ AI TURN";
    badgeBg = "bg-zinc-800 text-paper";
    bannerTitle = `${activePlayer?.name || "Bot"} is planning tactical maneuvers...`;
    bannerInstruction = "Evaluating resource production, building options, and trade offers.";
  } else {
    // HUMAN PLAYER TURN
    if (phase === "setup_round_1" || phase === "setup_round_2") {
      const roundNum = phase === "setup_round_1" ? "1" : "2";

      if (!selectedVertexId) {
        badgeLabel = `🟢 ROUND ${roundNum} · STEP 1/2`;
        badgeBg = "bg-emerald-500 text-white animate-pulse";
        bannerTitle = "YOUR TURN — PLACE STARTING HAMLET";
        bannerInstruction =
          "Click any glowing dashed circle on the island to establish your starting settlement." +
          (phase === "setup_round_2"
            ? " (★ Round 2 grants starting resources from touching hex tiles!)"
            : "");
      } else {
        badgeLabel = `🟢 ROUND ${roundNum} · STEP 2/2`;
        badgeBg = "bg-amber-400 text-ink";
        bannerTitle = "HAMLET SELECTED — PLACE STARTING WIREWAY";
        bannerInstruction =
          "Now click an adjacent glowing path connecting to your new Hamlet to lay your starting Wireway.";
        actionSlot = (
          <button
            type="button"
            onClick={onCancelVertexSelection}
            className="flex items-center gap-1.5 rounded-lg border-2 border-ink bg-rose-100 px-3 py-1.5 font-mono text-xs font-black uppercase text-rose-900 shadow-[2px_2px_0px_#121212] hover:bg-rose-200 active:translate-y-0.5 cursor-pointer"
          >
            <span>↺ Change Hamlet Location</span>
          </button>
        );
      }
    } else if (phase === "roll") {
      badgeLabel = "🎲 ROLL PHASE";
      badgeBg = "bg-amber-400 text-ink animate-bounce";
      bannerTitle = "YOUR TURN — HARVEST ROLL REQUIRED";
      bannerInstruction =
        "Roll the 2d6 dice to generate resources across the island for all players. Watch out for 7s!";
      actionSlot = (
        <button
          type="button"
          onClick={onRollDice}
          className="flex items-center gap-2 rounded-xl border-3 border-ink bg-amber-400 px-5 py-2 font-mono text-sm font-black uppercase text-ink shadow-[4px_4px_0px_#121212] hover:bg-amber-300 active:shadow-[1px_1px_0px_#121212] active:translate-x-0.5 active:translate-y-0.5 cursor-pointer"
        >
          <span>🎲 ROLL DICE NOW</span>
        </button>
      );
    } else if (phase === "robber") {
      badgeLabel = "🦹 BANDIT PUFF";
      badgeBg = "bg-red-600 text-white animate-pulse";
      bannerTitle = "RELOCATE BANDIT PUFF";
      bannerInstruction =
        "Click any hex tile on the island to deploy Bandit Puff. Tiles occupied by Bandit Puff produce no yields, and you intercept resources from nearby enemies!";
    } else if (phase === "discard") {
      badgeLabel = "📦 DISCARD PHASE";
      badgeBg = "bg-orange-500 text-white";
      bannerTitle = "7 ROLLED — EXCESS TONER CLEANUP";
      bannerInstruction =
        "Bandit Puff raid! Players with more than 7 resource cards must discard half their inventory.";
    } else if (phase === "road_building_1") {
      badgeLabel = "🛤️ DEV CARD (1/2)";
      badgeBg = "bg-blue-600 text-white";
      bannerTitle = "FREE WIREWAY (STEP 1 OF 2)";
      bannerInstruction =
        "Wire Spool activated! Click any valid connected path to place your 1st FREE Wireway.";
    } else if (phase === "road_building_2") {
      badgeLabel = "🛤️ DEV CARD (2/2)";
      badgeBg = "bg-blue-600 text-white";
      bannerTitle = "FREE WIREWAY (STEP 2 OF 2)";
      bannerInstruction =
        "Wire Spool activated! Click another valid connected path to place your 2nd FREE Wireway.";
    } else if (phase === "action") {
      if (activeBuildMode === "road") {
        badgeLabel = "🛣️ WIREWAY MODE";
        badgeBg = "bg-amber-500 text-white";
        bannerTitle = "BUILDING WIREWAY (1 Brick 🧱 + 1 Timber 🌲)";
        bannerInstruction =
          "Click any highlighted glowing path connected to your existing roads or Hamlets.";
        actionSlot = (
          <button
            type="button"
            onClick={onCancelBuildMode}
            className="flex items-center gap-1.5 rounded-lg border-2 border-ink bg-neutral-200 px-3 py-1.5 font-mono text-xs font-black uppercase text-ink shadow-[2px_2px_0px_#121212] hover:bg-neutral-300 cursor-pointer"
          >
            <span>✕ Cancel Build Mode</span>
          </button>
        );
      } else if (activeBuildMode === "settlement") {
        badgeLabel = "🏠 HAMLET MODE";
        badgeBg = "bg-emerald-600 text-white";
        bannerTitle = "ESTABLISHING HAMLET (1 Brick 🧱 + 1 Timber 🌲 + 1 Paper 📜 + 1 Feed 🌽)";
        bannerInstruction =
          "Click any glowing circular intersection connected to your road network (must be 2+ paths away from other settlements).";
        actionSlot = (
          <button
            type="button"
            onClick={onCancelBuildMode}
            className="flex items-center gap-1.5 rounded-lg border-2 border-ink bg-neutral-200 px-3 py-1.5 font-mono text-xs font-black uppercase text-ink shadow-[2px_2px_0px_#121212] hover:bg-neutral-300 cursor-pointer"
          >
            <span>✕ Cancel Build Mode</span>
          </button>
        );
      } else if (activeBuildMode === "city") {
        badgeLabel = "🏛️ HAM HQ MODE";
        badgeBg = "bg-purple-600 text-white";
        bannerTitle = "UPGRADING TO HAM HQ (3 Toner 🖨️ + 2 Paper 📜)";
        bannerInstruction =
          "Click any of your existing Hamlets to upgrade it to a Ham HQ (+1 VP and 2x resource harvests).";
        actionSlot = (
          <button
            type="button"
            onClick={onCancelBuildMode}
            className="flex items-center gap-1.5 rounded-lg border-2 border-ink bg-neutral-200 px-3 py-1.5 font-mono text-xs font-black uppercase text-ink shadow-[2px_2px_0px_#121212] hover:bg-neutral-300 cursor-pointer"
          >
            <span>✕ Cancel Build Mode</span>
          </button>
        );
      } else {
        badgeLabel = "⚡ COMMAND PHASE";
        badgeBg = "bg-emerald-600 text-white";
        bannerTitle = "YOUR TURN — COMMAND & EXPEDITION";
        bannerInstruction =
          "Select a Build Mode below, trade with the Bank or AI opponents, buy Ham Cards, or End Turn when done.";
      }
    }
  }

  return (
    <div className="flex flex-col gap-2.5">
      {/* Live Action Banner */}
      <div
        className={`relative flex flex-col items-stretch justify-between gap-3 overflow-hidden rounded-2xl border-3 border-ink bg-white p-3.5 shadow-[4px_4px_0px_#121212] sm:p-4 md:flex-row md:items-center ${
          isHumanTurn ? "ring-2 ring-amber-400" : ""
        }`}
      >
        {/* Left: Player Color Ribbon & Details */}
        <div className="flex items-start gap-3">
          {/* Active Player Tag */}
          <div className="flex flex-col items-start gap-1">
            <div className="flex items-center gap-2">
              <span
                className={`rounded-md border border-ink px-2.5 py-0.5 font-mono text-[11px] font-black uppercase tracking-wider ${badgeBg}`}
              >
                {badgeLabel}
              </span>
              <span className="font-mono text-xs font-bold text-neutral-500">
                Turn {turnNumber}
              </span>
            </div>

            <div className="mt-1 flex items-center gap-2">
              <span
                className="h-3.5 w-3.5 shrink-0 rounded-full border border-ink shadow-[1px_1px_0px_#121212]"
                style={{ backgroundColor: pal?.primary || "#121212" }}
              />
              <h2 className="font-mono text-sm font-black uppercase tracking-tight text-ink sm:text-base">
                {bannerTitle}
              </h2>
            </div>

            <p className="mt-0.5 max-w-2xl font-mono text-xs font-semibold leading-relaxed text-neutral-700">
              {bannerInstruction}
            </p>
          </div>
        </div>

        {/* Right: Quick Action Trigger */}
        {actionSlot && <div className="mt-2 shrink-0 md:mt-0">{actionSlot}</div>}
      </div>

      {/* Immediate In-Game Feedback Toast */}
      {feedbackMessage && (
        <div
          className={`flex items-center justify-between gap-3 rounded-xl border-2 border-ink p-3 font-mono text-xs font-bold shadow-[3px_3px_0px_#121212] transition-all ${
            feedbackMessage.type === "warning"
              ? "bg-amber-100 text-amber-950 border-amber-950"
              : feedbackMessage.type === "success"
                ? "bg-emerald-100 text-emerald-950 border-emerald-950"
                : "bg-blue-100 text-blue-950 border-blue-950"
          }`}
        >
          <div className="flex items-center gap-2">
            <span>{feedbackMessage.text}</span>
          </div>
          <button
            type="button"
            onClick={onDismissFeedback}
            className="rounded border border-current px-2 py-0.5 text-[10px] uppercase font-black hover:opacity-75 cursor-pointer"
          >
            ✕ Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
