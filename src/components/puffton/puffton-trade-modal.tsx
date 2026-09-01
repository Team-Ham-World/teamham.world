"use client";

import React, { useState } from "react";
import {
  bankTradeAction,
  getPlayerBestTradeRatio,
} from "@/lib/puffton/engine";
import {
  ALL_RESOURCES,
  type PufftonGameState,
  type ResourceType,
} from "@/lib/puffton/types";

interface PufftonTradeModalProps {
  gameState: PufftonGameState;
  onClose: () => void;
  onTradeComplete: () => void;
}

export function PufftonTradeModal({
  gameState,
  onClose,
  onTradeComplete,
}: PufftonTradeModalProps) {
  const [tab, setTab] = useState<"bank" | "domestic">("bank");
  const [bankOffer, setBankOffer] = useState<ResourceType>("timber");
  const [bankWant, setBankWant] = useState<ResourceType>("toner");

  const [domesticOffer, setDomesticOffer] = useState<ResourceType>("timber");
  const [domesticWant, setDomesticWant] = useState<ResourceType>("brick");
  const [tradeStatus, setTradeStatus] = useState<string | null>(null);

  const humanPlayer = gameState.players.find((p) => !p.isBot) || gameState.players[0];
  const ratio = getPlayerBestTradeRatio(humanPlayer, bankOffer, gameState.board);
  const canBankTrade = (humanPlayer.resources[bankOffer] || 0) >= ratio && bankOffer !== bankWant;

  const handleBankTrade = () => {
    if (bankTradeAction(gameState, bankOffer, bankWant)) {
      onTradeComplete();
      onClose();
    }
  };

  const handleDomesticTrade = () => {
    if ((humanPlayer.resources[domesticOffer] || 0) < 1) {
      setTradeStatus("You don't have enough of the offered resource.");
      return;
    }

    // Check if any bot has the wanted resource and wants the offered resource
    const botCandidate = gameState.players.find(
      (p) => p.isBot && (p.resources[domesticWant] || 0) >= 1,
    );

    if (!botCandidate) {
      setTradeStatus("No opponent currently has that resource in stock.");
      return;
    }

    // Execute 1:1 trade with candidate bot
    humanPlayer.resources[domesticOffer]--;
    humanPlayer.resources[domesticWant]++;
    botCandidate.resources[domesticWant]--;
    botCandidate.resources[domesticOffer]++;

    setTradeStatus(`Deal accepted! Traded with ${botCandidate.name}.`);
    onTradeComplete();
    setTimeout(() => onClose(), 900);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border-4 border-ink bg-paper p-6 shadow-[8px_8px_0px_#121212]">
        <div className="flex items-center justify-between border-b-2 border-ink pb-3">
          <h2 className="font-mono text-lg font-black uppercase text-ink">
            Resource Exchange & Trade
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded border-2 border-ink bg-white px-2 py-1 font-mono text-xs font-bold hover:bg-neutral-100"
          >
            ✕ Close
          </button>
        </div>

        {/* Tab Selector */}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => setTab("bank")}
            className={`flex-1 rounded-lg border-2 border-ink py-2 font-mono text-xs font-black uppercase ${
              tab === "bank" ? "bg-ink text-paper" : "bg-white text-ink hover:bg-neutral-50"
            }`}
          >
            🏦 Bank Trade ({ratio}:1 Port Rate)
          </button>
          <button
            type="button"
            onClick={() => setTab("domestic")}
            className={`flex-1 rounded-lg border-2 border-ink py-2 font-mono text-xs font-black uppercase ${
              tab === "domestic" ? "bg-ink text-paper" : "bg-white text-ink hover:bg-neutral-50"
            }`}
          >
            🤝 Trade with Opponents (1:1)
          </button>
        </div>

        {tab === "bank" ? (
          /* Bank Trade Content */
          <div className="mt-6 flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4">
              {/* Give */}
              <div className="rounded-xl border-2 border-ink bg-white p-3">
                <label className="block text-xs font-bold uppercase text-neutral-500">
                  Give ({ratio} Units)
                </label>
                <select
                  value={bankOffer}
                  onChange={(e) => setBankOffer(e.target.value as ResourceType)}
                  className="mt-2 w-full rounded border-2 border-ink bg-paper p-2 font-mono text-xs font-bold text-ink"
                >
                  {ALL_RESOURCES.map((r) => (
                    <option key={r} value={r}>
                      {r.toUpperCase()} (Have: {humanPlayer.resources[r] || 0})
                    </option>
                  ))}
                </select>
                <div className="mt-2 text-[11px] text-neutral-600">
                  Port rate: <span className="font-bold text-ink">{ratio}:1</span>
                </div>
              </div>

              {/* Receive */}
              <div className="rounded-xl border-2 border-ink bg-white p-3">
                <label className="block text-xs font-bold uppercase text-neutral-500">
                  Receive (1 Unit)
                </label>
                <select
                  value={bankWant}
                  onChange={(e) => setBankWant(e.target.value as ResourceType)}
                  className="mt-2 w-full rounded border-2 border-ink bg-paper p-2 font-mono text-xs font-bold text-ink"
                >
                  {ALL_RESOURCES.filter((r) => r !== bankOffer).map((r) => (
                    <option key={r} value={r}>
                      {r.toUpperCase()} (Have: {humanPlayer.resources[r] || 0})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <button
              type="button"
              disabled={!canBankTrade}
              onClick={handleBankTrade}
              className={`w-full rounded-xl border-2 border-ink py-3 font-mono text-sm font-black uppercase text-ink shadow-[4px_4px_0px_#121212] ${
                canBankTrade
                  ? "bg-amber-400 hover:bg-amber-300 cursor-pointer"
                  : "bg-neutral-200 opacity-50 cursor-not-allowed"
              }`}
            >
              Exchange with Bank ({ratio} {bankOffer} ➔ 1 {bankWant})
            </button>
          </div>
        ) : (
          /* Domestic Opponent Trade Content */
          <div className="mt-6 flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-xl border-2 border-ink bg-white p-3">
                <label className="block text-xs font-bold uppercase text-neutral-500">
                  Offer (1 Unit)
                </label>
                <select
                  value={domesticOffer}
                  onChange={(e) => setDomesticOffer(e.target.value as ResourceType)}
                  className="mt-2 w-full rounded border-2 border-ink bg-paper p-2 font-mono text-xs font-bold text-ink"
                >
                  {ALL_RESOURCES.map((r) => (
                    <option key={r} value={r}>
                      {r.toUpperCase()} (Have: {humanPlayer.resources[r] || 0})
                    </option>
                  ))}
                </select>
              </div>

              <div className="rounded-xl border-2 border-ink bg-white p-3">
                <label className="block text-xs font-bold uppercase text-neutral-500">
                  Want in Exchange (1 Unit)
                </label>
                <select
                  value={domesticWant}
                  onChange={(e) => setDomesticWant(e.target.value as ResourceType)}
                  className="mt-2 w-full rounded border-2 border-ink bg-paper p-2 font-mono text-xs font-bold text-ink"
                >
                  {ALL_RESOURCES.filter((r) => r !== domesticOffer).map((r) => (
                    <option key={r} value={r}>
                      {r.toUpperCase()}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {tradeStatus && (
              <div className="rounded border-2 border-ink bg-amber-100 p-2 text-center font-mono text-xs font-bold text-ink">
                {tradeStatus}
              </div>
            )}

            <button
              type="button"
              onClick={handleDomesticTrade}
              className="w-full rounded-xl border-2 border-ink bg-blue-300 py-3 font-mono text-sm font-black uppercase text-ink shadow-[4px_4px_0px_#121212] hover:bg-blue-200"
            >
              Propose Trade to Fleet
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
