"use client";

import React from "react";
import {
  PLAYER_COLOR_PALETTES,
  type DevCard,
  type PufftonGameState,
  type ResourceType,
} from "@/lib/puffton/types";

interface PufftonHudProps {
  gameState: PufftonGameState;
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

export function PufftonHud({
  gameState,
  onRollDice,
  onOpenTrade,
  onBuyDevCard,
  onPlayDevCard,
  onEndTurn,
}: PufftonHudProps) {
  const { players, activePlayerIndex, phase, lastDiceRoll, turnNumber, settings } = gameState;
  const activePlayer = players[activePlayerIndex];
  const humanPlayer = players.find((p) => !p.isBot) || players[0];

  const isHumanTurn = activePlayer?.id === humanPlayer.id;
  const canRoll = isHumanTurn && phase === "roll";
  const canAct = isHumanTurn && phase === "action";

  const canAffordDevCard =
    canAct &&
    humanPlayer.resources.toner >= 1 &&
    humanPlayer.resources.paper >= 1 &&
    humanPlayer.resources.feed >= 1 &&
    gameState.devCardDeck.length > 0;

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
            <span className="rounded bg-amber-200 px-2 py-0.5 font-mono text-[11px] font-bold uppercase text-ink">
              {phase.replace(/_/g, " ")}
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
                  isTurn ? "bg-amber-50 shadow-[2px_2px_0px_#121212]" : "bg-paper"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="h-3 w-3 rounded-full border border-ink"
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
                <span className="font-mono text-xs font-bold uppercase">{info.name}</span>
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

      {/* 3. Action Toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border-2 border-ink bg-paper p-3 shadow-[4px_4px_0px_#121212]">
        {/* Roll Dice Button */}
        {canRoll && (
          <button
            type="button"
            onClick={onRollDice}
            className="flex-1 rounded-lg border-2 border-ink bg-amber-400 px-4 py-2.5 font-mono text-sm font-black uppercase text-ink shadow-[3px_3px_0px_#121212] hover:bg-amber-300 active:shadow-[1px_1px_0px_#121212]"
          >
            🎲 Roll Dice
          </button>
        )}

        {/* Trade Button */}
        {canAct && (
          <button
            type="button"
            onClick={onOpenTrade}
            className="rounded-lg border-2 border-ink bg-blue-200 px-4 py-2.5 font-mono text-xs font-black uppercase text-ink shadow-[3px_3px_0px_#121212] hover:bg-blue-100"
          >
            ⚖️ Trade (Bank/AI)
          </button>
        )}

        {/* Buy Dev Card Button */}
        {canAct && (
          <button
            type="button"
            disabled={!canAffordDevCard}
            onClick={onBuyDevCard}
            className={`rounded-lg border-2 border-ink px-4 py-2.5 font-mono text-xs font-black uppercase text-ink shadow-[3px_3px_0px_#121212] ${
              canAffordDevCard
                ? "bg-purple-200 hover:bg-purple-100 cursor-pointer"
                : "bg-neutral-200 opacity-50 cursor-not-allowed"
            }`}
          >
            🃏 Buy Ham Card (1T+1P+1F)
          </button>
        )}

        {/* Building Guidance */}
        {canAct && (
          <div className="hidden items-center gap-2 text-[11px] text-neutral-600 md:flex">
            <span>Click dashed paths on board to build Wireways (1B+1T) or Hamlets (1B+1T+1P+1F)</span>
          </div>
        )}

        {/* End Turn Button */}
        {canAct && (
          <button
            type="button"
            onClick={onEndTurn}
            className="ml-auto rounded-lg border-2 border-ink bg-emerald-400 px-5 py-2.5 font-mono text-xs font-black uppercase text-ink shadow-[3px_3px_0px_#121212] hover:bg-emerald-300 active:shadow-[1px_1px_0px_#121212]"
          >
            ✅ End Turn
          </button>
        )}

        {!isHumanTurn && (
          <div className="flex w-full items-center justify-center py-1 font-mono text-xs font-bold text-neutral-600">
            <span>⏳ {activePlayer?.name} is strategizing and making moves...</span>
          </div>
        )}
      </div>
    </div>
  );
}
