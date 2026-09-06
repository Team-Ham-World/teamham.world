"use client";

import React from "react";
import {
  BUILDING_COSTS,
  PLAYER_COLOR_PALETTES,
  type DevCard,
  type PufftonGameState,
  type ResourceType,
} from "@/lib/puffton/types";
import type { BuildMode } from "./puffton-live-banner";

interface PufftonHudProps {
  gameState: PufftonGameState;
  activeBuildMode: BuildMode;
  onToggleBuildMode: (mode: BuildMode) => void;
  onRollDice: () => void;
  onOpenTrade: () => void;
  onBuyDevCard: () => void;
  onPlayDevCard: (card: DevCard) => void;
  onEndTurn: () => void;
}

const RESOURCE_INFO: Record<
  ResourceType,
  { name: string; icon: string; bg: string; textCol: string }
> = {
  toner: { name: "Toner", icon: "🖨️", bg: "bg-zinc-800 text-white", textCol: "text-zinc-900" },
  paper: { name: "Paper", icon: "📜", bg: "bg-yellow-100 text-yellow-950", textCol: "text-yellow-900" },
  feed: { name: "Feed", icon: "🌽", bg: "bg-amber-100 text-amber-950", textCol: "text-amber-900" },
  brick: { name: "Brick", icon: "🧱", bg: "bg-orange-100 text-orange-950", textCol: "text-orange-900" },
  timber: { name: "Timber", icon: "🌲", bg: "bg-emerald-100 text-emerald-950", textCol: "text-emerald-900" },
};

function getMissingResources(
  current: Record<ResourceType, number>,
  cost: Partial<Record<ResourceType, number>>,
): string[] {
  const missing: string[] = [];
  for (const [res, amt] of Object.entries(cost)) {
    const r = res as ResourceType;
    const diff = (amt || 0) - (current[r] || 0);
    if (diff > 0) {
      missing.push(`${diff} ${r.charAt(0).toUpperCase() + r.slice(1)}`);
    }
  }
  return missing;
}

export function PufftonHud({
  gameState,
  activeBuildMode,
  onToggleBuildMode,
  onRollDice,
  onOpenTrade,
  onBuyDevCard,
  onPlayDevCard,
  onEndTurn,
}: PufftonHudProps) {
  const { players, activePlayerIndex, phase, lastDiceRoll, turnNumber, settings, devCardDeck } =
    gameState;
  const activePlayer = players[activePlayerIndex];
  const humanPlayer = players.find((p) => !p.isBot) || players[0];

  const isHumanTurn = activePlayer?.id === humanPlayer.id;
  const canRoll = isHumanTurn && phase === "roll";
  const canAct = isHumanTurn && phase === "action";

  // Resource deficiencies for build items
  const missingRoad = getMissingResources(humanPlayer.resources, BUILDING_COSTS.road);
  const canAffordRoad = canAct && missingRoad.length === 0 && humanPlayer.roadsLeft > 0;

  const missingSettlement = getMissingResources(humanPlayer.resources, BUILDING_COSTS.settlement);
  const canAffordSettlement =
    canAct && missingSettlement.length === 0 && humanPlayer.settlementsLeft > 0;

  const missingCity = getMissingResources(humanPlayer.resources, BUILDING_COSTS.city);
  const canAffordCity = canAct && missingCity.length === 0 && humanPlayer.citiesLeft > 0;

  const missingDevCard = getMissingResources(humanPlayer.resources, BUILDING_COSTS.dev_card);
  const canAffordDevCard =
    canAct && missingDevCard.length === 0 && devCardDeck.length > 0;

  const totalHumanCards = Object.values(humanPlayer.resources).reduce((sum, n) => sum + n, 0);

  return (
    <div className="flex flex-col gap-4">
      {/* 1. Scoreboard & Leaderboard Bar */}
      <div className="rounded-xl border-2 border-ink bg-white p-3 shadow-[4px_4px_0px_#121212]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink/20 pb-2">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-black uppercase text-neutral-500">
              Turn {turnNumber}
            </span>
            <span className="rounded bg-ink px-2 py-0.5 font-mono text-xs font-bold text-paper">
              Target: {settings.targetVp} VP
            </span>
          </div>

          {/* Turn phase indicator */}
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-bold uppercase text-ink">Active:</span>
            <span
              className="rounded border border-ink px-2 py-0.5 font-mono text-xs font-black"
              style={{
                backgroundColor: PLAYER_COLOR_PALETTES[activePlayer.color].primary,
                color: "#ffffff",
              }}
            >
              {activePlayer.name} {activePlayer.isBot ? "(Bot)" : "(You)"}
            </span>
          </div>
        </div>

        {/* Player stats cards */}
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {players.map((p) => {
            const isTurn = p.id === activePlayer.id;
            const pal = PLAYER_COLOR_PALETTES[p.color];
            const resCount = Object.values(p.resources).reduce((s, n) => s + n, 0);
            return (
              <div
                key={p.id}
                className={`flex flex-col rounded-lg border-2 border-ink p-2 transition-all ${
                  isTurn ? "bg-amber-100 shadow-[2px_2px_0px_#121212] ring-2 ring-amber-500" : "bg-paper"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 truncate">
                    <span
                      className="h-3 w-3 shrink-0 rounded-full border border-ink"
                      style={{ backgroundColor: pal.primary }}
                    />
                    <span className="truncate font-mono text-xs font-black text-ink">{p.name}</span>
                  </div>
                  <span className="font-mono text-xs font-black text-ink">
                    {p.id === humanPlayer.id ? p.victoryPoints : p.publicVictoryPoints} VP
                  </span>
                </div>

                <div className="mt-1 flex items-center justify-between text-[11px] text-neutral-600">
                  <span>📦 {resCount} cards</span>
                  <span>🃏 {p.devCards.filter((c) => !c.played).length} dev</span>
                </div>

                {/* Badges */}
                <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
                  {p.hasLongestRoad && (
                    <span className="rounded bg-blue-100 px-1 py-0.5 font-bold text-blue-800">
                      🛣️ Road ({p.longestRoadLength})
                    </span>
                  )}
                  {p.hasLargestArmy && (
                    <span className="rounded bg-red-100 px-1 py-0.5 font-bold text-red-800">
                      🛡️ Army ({p.armySize})
                    </span>
                  )}
                  {p.hasHarborMaster && (
                    <span className="rounded bg-purple-100 px-1 py-0.5 font-bold text-purple-800">
                      ⚓ Harbor
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 2. Your Hand & Inventory */}
      <div className="rounded-xl border-2 border-ink bg-white p-3 shadow-[4px_4px_0px_#121212]">
        <div className="flex items-center justify-between">
          <h3 className="font-mono text-xs font-black uppercase text-neutral-600">
            Your Resources ({totalHumanCards} Total)
          </h3>
          {lastDiceRoll && (
            <div className="flex items-center gap-1 font-mono text-xs font-bold text-ink">
              <span>Last Roll:</span>
              <span className="rounded bg-ink px-1.5 py-0.5 font-black text-paper">
                {lastDiceRoll[0] + lastDiceRoll[1]} ({lastDiceRoll[0]} + {lastDiceRoll[1]})
              </span>
            </div>
          )}
        </div>

        <div className="mt-2 grid grid-cols-5 gap-2">
          {(["toner", "paper", "feed", "brick", "timber"] as ResourceType[]).map((res) => {
            const info = RESOURCE_INFO[res];
            const count = humanPlayer.resources[res] || 0;
            return (
              <div
                key={res}
                className={`flex flex-col items-center justify-center rounded-lg border-2 border-ink p-2 shadow-[2px_2px_0px_#121212] ${info.bg}`}
              >
                <span className="text-xl">{info.icon}</span>
                <span className="font-mono text-[11px] font-bold uppercase">{info.name}</span>
                <span className="font-mono text-base font-black">{count}</span>
              </div>
            );
          })}
        </div>

        {/* Dev Cards in Hand */}
        {humanPlayer.devCards.some((c) => !c.played) && (
          <div className="mt-3 border-t border-ink/20 pt-2">
            <span className="font-mono text-[11px] font-bold text-neutral-600">
              Ham Cards in Hand:
            </span>
            <div className="mt-1 flex flex-wrap gap-2">
              {humanPlayer.devCards
                .filter((c) => !c.played)
                .map((card) => {
                  const isPlayable = canAct && card.boughtTurn < turnNumber && card.type !== "victory_point";
                  return (
                    <button
                      key={card.id}
                      type="button"
                      disabled={!isPlayable}
                      onClick={() => onPlayDevCard(card)}
                      className={`flex items-center gap-1.5 rounded border-2 border-ink px-2.5 py-1 font-mono text-xs font-bold ${
                        isPlayable
                          ? "bg-amber-300 text-ink shadow-[2px_2px_0px_#121212] hover:bg-amber-200 cursor-pointer"
                          : "bg-neutral-100 text-neutral-500 opacity-60"
                      }`}
                    >
                      <span>
                        {card.type === "knight" && "🛡️ Toner Guard"}
                        {card.type === "victory_point" && "🏆 Secret Blueprint (+1 VP)"}
                        {card.type === "road_building" && "🛤️ Wire Spool (2 Roads)"}
                        {card.type === "year_of_plenty" && "🌾 Surplus (2 Res)"}
                        {card.type === "monopoly" && "💎 Monopoly"}
                      </span>
                      {isPlayable && <span className="text-[10px] uppercase underline">Play</span>}
                    </button>
                  );
                })}
            </div>
          </div>
        )}
      </div>

      {/* 3. Explicit Build Modes & Actions */}
      <div className="flex flex-col gap-3 rounded-xl border-2 border-ink bg-white p-3 shadow-[4px_4px_0px_#121212]">
        <div className="flex items-center justify-between">
          <h3 className="font-mono text-xs font-black uppercase text-neutral-700">
            Build & Construction Modes
          </h3>
          {activeBuildMode && (
            <button
              type="button"
              onClick={() => onToggleBuildMode(null)}
              className="font-mono text-[11px] font-bold text-rose-700 underline hover:text-rose-900 cursor-pointer"
            >
              Cancel Mode
            </button>
          )}
        </div>

        {/* 3 Dedicated Build Mode Buttons */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {/* Wireway */}
          <button
            type="button"
            disabled={!canAct}
            onClick={() => onToggleBuildMode(activeBuildMode === "road" ? null : "road")}
            className={`flex flex-col items-start justify-between rounded-lg border-2 border-ink p-2.5 font-mono transition-all ${
              activeBuildMode === "road"
                ? "bg-amber-400 text-ink shadow-[3px_3px_0px_#121212] ring-2 ring-amber-600 scale-[1.02]"
                : canAffordRoad
                  ? "bg-amber-50 text-ink shadow-[2px_2px_0px_#121212] hover:bg-amber-100 cursor-pointer"
                  : "bg-neutral-100 text-neutral-500 opacity-70"
            }`}
          >
            <div className="flex w-full items-center justify-between">
              <span className="text-xs font-black uppercase">🛣️ Wireway</span>
              <span className="text-[10px] font-bold">Left: {humanPlayer.roadsLeft}/15</span>
            </div>
            <div className="mt-1 flex w-full flex-wrap items-center justify-between gap-1 text-[10px]">
              <span className="text-neutral-700">1 Brick + 1 Timber</span>
              {canAct && !canAffordRoad && (
                <span className="font-bold text-rose-600">
                  {humanPlayer.roadsLeft === 0 ? "Maxed" : `Need ${missingRoad.join(", ")}`}
                </span>
              )}
            </div>
          </button>

          {/* Hamlet */}
          <button
            type="button"
            disabled={!canAct}
            onClick={() => onToggleBuildMode(activeBuildMode === "settlement" ? null : "settlement")}
            className={`flex flex-col items-start justify-between rounded-lg border-2 border-ink p-2.5 font-mono transition-all ${
              activeBuildMode === "settlement"
                ? "bg-emerald-400 text-ink shadow-[3px_3px_0px_#121212] ring-2 ring-emerald-600 scale-[1.02]"
                : canAffordSettlement
                  ? "bg-emerald-50 text-ink shadow-[2px_2px_0px_#121212] hover:bg-emerald-100 cursor-pointer"
                  : "bg-neutral-100 text-neutral-500 opacity-70"
            }`}
          >
            <div className="flex w-full items-center justify-between">
              <span className="text-xs font-black uppercase">🏠 Hamlet</span>
              <span className="text-[10px] font-bold">Left: {humanPlayer.settlementsLeft}/5</span>
            </div>
            <div className="mt-1 flex w-full flex-wrap items-center justify-between gap-1 text-[10px]">
              <span className="text-neutral-700">1B+1T+1P+1F</span>
              {canAct && !canAffordSettlement && (
                <span className="font-bold text-rose-600">
                  {humanPlayer.settlementsLeft === 0 ? "Maxed" : `Need ${missingSettlement.slice(0, 2).join(", ")}`}
                </span>
              )}
            </div>
          </button>

          {/* Ham HQ */}
          <button
            type="button"
            disabled={!canAct}
            onClick={() => onToggleBuildMode(activeBuildMode === "city" ? null : "city")}
            className={`flex flex-col items-start justify-between rounded-lg border-2 border-ink p-2.5 font-mono transition-all ${
              activeBuildMode === "city"
                ? "bg-purple-400 text-ink shadow-[3px_3px_0px_#121212] ring-2 ring-purple-600 scale-[1.02]"
                : canAffordCity
                  ? "bg-purple-50 text-ink shadow-[2px_2px_0px_#121212] hover:bg-purple-100 cursor-pointer"
                  : "bg-neutral-100 text-neutral-500 opacity-70"
            }`}
          >
            <div className="flex w-full items-center justify-between">
              <span className="text-xs font-black uppercase">🏛️ Ham HQ</span>
              <span className="text-[10px] font-bold">Left: {humanPlayer.citiesLeft}/4</span>
            </div>
            <div className="mt-1 flex w-full flex-wrap items-center justify-between gap-1 text-[10px]">
              <span className="text-neutral-700">3 Toner + 2 Paper</span>
              {canAct && !canAffordCity && (
                <span className="font-bold text-rose-600">
                  {humanPlayer.citiesLeft === 0 ? "Maxed" : `Need ${missingCity.join(", ")}`}
                </span>
              )}
            </div>
          </button>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-ink/10">
          {/* Roll Dice Button */}
          {canRoll && (
            <button
              type="button"
              onClick={onRollDice}
              className="flex-1 rounded-lg border-2 border-ink bg-amber-400 px-4 py-2.5 font-mono text-sm font-black uppercase text-ink shadow-[3px_3px_0px_#121212] hover:bg-amber-300 active:shadow-[1px_1px_0px_#121212] cursor-pointer animate-pulse"
            >
              🎲 Roll Dice
            </button>
          )}

          {/* Trade Button */}
          {canAct && (
            <button
              type="button"
              onClick={onOpenTrade}
              className="rounded-lg border-2 border-ink bg-blue-200 px-3.5 py-2 font-mono text-xs font-black uppercase text-ink shadow-[2px_2px_0px_#121212] hover:bg-blue-100 cursor-pointer"
            >
              ⚖️ Trade
            </button>
          )}

          {/* Buy Dev Card Button */}
          {canAct && (
            <button
              type="button"
              disabled={!canAffordDevCard}
              onClick={onBuyDevCard}
              className={`rounded-lg border-2 border-ink px-3.5 py-2 font-mono text-xs font-black uppercase text-ink shadow-[2px_2px_0px_#121212] ${
                canAffordDevCard
                  ? "bg-purple-200 hover:bg-purple-100 cursor-pointer"
                  : "bg-neutral-200 opacity-50 cursor-not-allowed"
              }`}
            >
              🃏 Buy Card ({devCardDeck.length})
            </button>
          )}

          {/* End Turn Button */}
          {canAct && (
            <button
              type="button"
              onClick={onEndTurn}
              className="ml-auto rounded-lg border-2 border-ink bg-emerald-400 px-4 py-2 font-mono text-xs font-black uppercase text-ink shadow-[3px_3px_0px_#121212] hover:bg-emerald-300 active:shadow-[1px_1px_0px_#121212] cursor-pointer"
            >
              ✅ End Turn
            </button>
          )}

          {!isHumanTurn && (
            <div className="flex w-full items-center justify-center py-1 font-mono text-xs font-bold text-neutral-600">
              <span className="animate-pulse">⏳ {activePlayer?.name} is thinking and taking actions...</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
