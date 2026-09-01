"use client";

import React, { useState } from "react";
import type { CreateGameOptions } from "@/lib/puffton/engine";
import {
  PLAYER_COLOR_PALETTES,
  type MapOption,
  type PlayerColor,
  type PufftonSettings,
} from "@/lib/puffton/types";

interface PufftonLobbyProps {
  onStartGame: (options: CreateGameOptions) => void;
  defaultUsername?: string;
}

const MAP_OPTIONS: { id: MapOption; name: string; desc: string; hexCount: number; badge: string }[] = [
  {
    id: "classic",
    name: "Classic Island",
    desc: "Standard 19-hex balanced continent with 9 coastal trade ports. Perfect for 3-4 players.",
    hexCount: 19,
    badge: "Recommended",
  },
  {
    id: "expanded",
    name: "Expanded Realm",
    desc: "Vast 30-hex mega continent with rich resource veins for 4-6 player grand battles.",
    hexCount: 30,
    badge: "5-6 Players",
  },
  {
    id: "archipelago",
    name: "Twin Archipelagos",
    desc: "Two distinct landmasses separated by a treacherous ocean channel. Port mastery is key.",
    hexCount: 23,
    badge: "Seafarer",
  },
  {
    id: "duel",
    name: "Fast Duel Basin",
    desc: "Compact 12-hex arena designed for high-intensity 2-player quick showdowns.",
    hexCount: 12,
    badge: "Quick 1v1",
  },
  {
    id: "random",
    name: "Procedural Wilds",
    desc: "Randomized terrain distribution and dice tokens for an unpredictable new challenge.",
    hexCount: 19,
    badge: "Dynamic",
  },
];

const BOT_NAMES = [
  "BytePuff",
  "CyberHam",
  "PixelHamster",
  "TonerTitan",
  "CircuitSqueak",
  "QuantumNibbles",
];

export function PufftonLobby({ onStartGame, defaultUsername }: PufftonLobbyProps) {
  const [playerName, setPlayerName] = useState(defaultUsername || "Hamster Commander");
  const [selectedColor, setSelectedColor] = useState<PlayerColor>("ham-gold");
  const [selectedMap, setSelectedMap] = useState<MapOption>("classic");
  const [botCount, setBotCount] = useState<number>(3);
  const [botDifficulty, setBotDifficulty] = useState<"easy" | "medium" | "hard">("medium");

  const [settings, setSettings] = useState<PufftonSettings>({
    targetVp: 10,
    friendlyRobber: false,
    harborMaster: false,
    techPowers: false,
    balancedDice: false,
    map: "classic",
    fogOfWar: false,
    speed: "normal",
  });

  const availableColors = Object.keys(PLAYER_COLOR_PALETTES) as PlayerColor[];

  const handleLaunch = () => {
    const chosenBotColors = availableColors.filter((c) => c !== selectedColor);

    const players: CreateGameOptions["players"] = [
      {
        name: playerName.trim() || "Commander",
        isBot: false,
        color: selectedColor,
      },
    ];

    for (let i = 0; i < botCount; i++) {
      players.push({
        name: BOT_NAMES[i % BOT_NAMES.length],
        isBot: true,
        botDifficulty,
        color: chosenBotColors[i % chosenBotColors.length],
      });
    }

    onStartGame({
      players,
      settings: {
        ...settings,
        map: selectedMap,
      },
    });
  };

  return (
    <div className="mx-auto max-w-4xl rounded-2xl border-4 border-ink bg-paper p-6 shadow-[8px_8px_0px_#121212] sm:p-8">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-3 border-b-2 border-ink pb-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded bg-ink px-2 py-0.5 font-mono text-xs font-bold uppercase tracking-wider text-paper">
              Settlers of Team HAM
            </span>
            <span className="rounded-full border border-emerald-600 bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-700">
              100% Free & Open
            </span>
          </div>
          <h1 className="mt-1 font-mono text-3xl font-black tracking-tight text-ink sm:text-4xl">
            PUFFTON
          </h1>
          <p className="mt-1 text-sm text-neutral-600">
            Hexagonal territory expansion, resource trading, and Ham HQ civilization.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
        {/* Left Column: Player & Match Setup */}
        <div className="flex flex-col gap-6">
          {/* Player Profile */}
          <div className="rounded-xl border-2 border-ink bg-white p-4 shadow-[4px_4px_0px_#121212]">
            <h2 className="font-mono text-sm font-black uppercase text-ink">
              1. Your Commander Identity
            </h2>
            <div className="mt-3">
              <label className="block text-xs font-bold uppercase text-neutral-500">
                Callsign / Display Name
              </label>
              <input
                type="text"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                maxLength={20}
                className="mt-1 w-full rounded-lg border-2 border-ink bg-paper px-3 py-2 font-mono text-sm font-bold text-ink shadow-[2px_2px_0px_#121212] outline-none focus:ring-2 focus:ring-interactive-blue"
              />
            </div>

            <div className="mt-4">
              <label className="block text-xs font-bold uppercase text-neutral-500">
                Player Color Theme
              </label>
              <div className="mt-2 grid grid-cols-4 gap-2">
                {availableColors.map((colKey) => {
                  const pal = PLAYER_COLOR_PALETTES[colKey];
                  const isSelected = selectedColor === colKey;
                  return (
                    <button
                      key={colKey}
                      type="button"
                      onClick={() => setSelectedColor(colKey)}
                      style={{ backgroundColor: pal.primary }}
                      className={`flex flex-col items-center justify-center rounded-lg border-2 border-ink p-2 text-center text-xs font-bold text-white transition-transform ${
                        isSelected
                          ? "scale-105 ring-2 ring-ink ring-offset-2 shadow-[2px_2px_0px_#121212]"
                          : "opacity-80 hover:opacity-100"
                      }`}
                    >
                      <span className="text-[11px] leading-tight drop-shadow-sm">{pal.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* AI Opponents */}
          <div className="rounded-xl border-2 border-ink bg-white p-4 shadow-[4px_4px_0px_#121212]">
            <h2 className="font-mono text-sm font-black uppercase text-ink">
              2. Opponents & AI Fleet
            </h2>
            <div className="mt-3 grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold uppercase text-neutral-500">
                  Bot Count
                </label>
                <div className="mt-1 flex gap-1">
                  {[1, 2, 3, 5].map((cnt) => (
                    <button
                      key={cnt}
                      type="button"
                      onClick={() => setBotCount(cnt)}
                      className={`flex-1 rounded border-2 border-ink py-1.5 font-mono text-xs font-bold ${
                        botCount === cnt
                          ? "bg-ink text-paper"
                          : "bg-paper text-ink hover:bg-neutral-100"
                      }`}
                    >
                      {cnt} {cnt === 1 ? "Bot" : "Bots"}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-neutral-500">
                  AI Difficulty
                </label>
                <select
                  value={botDifficulty}
                  onChange={(e) => setBotDifficulty(e.target.value as "easy" | "medium" | "hard")}
                  className="mt-1 w-full rounded border-2 border-ink bg-paper px-2 py-1.5 font-mono text-xs font-bold text-ink outline-none"
                >
                  <option value="easy">Easy (Casual)</option>
                  <option value="medium">Medium (Standard)</option>
                  <option value="hard">Hard (Master Strategist)</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Map & Expansions */}
        <div className="flex flex-col gap-6">
          {/* Map Selection */}
          <div className="rounded-xl border-2 border-ink bg-white p-4 shadow-[4px_4px_0px_#121212]">
            <h2 className="font-mono text-sm font-black uppercase text-ink">
              3. Map Selection
            </h2>
            <div className="mt-3 flex flex-col gap-2">
              {MAP_OPTIONS.map((m) => {
                const isSelected = selectedMap === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setSelectedMap(m.id)}
                    className={`flex flex-col rounded-lg border-2 border-ink p-3 text-left transition-all ${
                      isSelected
                        ? "bg-amber-50 shadow-[3px_3px_0px_#121212]"
                        : "bg-paper hover:bg-neutral-50"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-sm font-black text-ink">{m.name}</span>
                      <span className="rounded bg-ink/10 px-2 py-0.5 font-mono text-[10px] font-bold text-ink">
                        {m.badge} &#183; {m.hexCount} Hexes
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-neutral-600">{m.desc}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Expansions & House Rules */}
          <div className="rounded-xl border-2 border-ink bg-white p-4 shadow-[4px_4px_0px_#121212]">
            <div className="flex items-center justify-between">
              <h2 className="font-mono text-sm font-black uppercase text-ink">
                4. Expansions & House Rules
              </h2>
              <span className="text-xs font-bold text-emerald-700">All Unlocked</span>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <div className="flex items-center justify-between rounded border border-ink/30 bg-paper p-2">
                <div>
                  <div className="text-xs font-bold text-ink">Target Points</div>
                  <div className="text-[10px] text-neutral-500">Victory goal</div>
                </div>
                <select
                  value={settings.targetVp}
                  onChange={(e) =>
                    setSettings({ ...settings, targetVp: Number(e.target.value) })
                  }
                  className="rounded border border-ink bg-white px-2 py-0.5 font-mono text-xs font-bold"
                >
                  <option value={8}>8 VP (Fast)</option>
                  <option value={10}>10 VP (Standard)</option>
                  <option value={12}>12 VP (Long)</option>
                  <option value={14}>14 VP (Epic)</option>
                </select>
              </div>

              <label className="flex cursor-pointer items-center justify-between rounded border border-ink/30 bg-paper p-2">
                <div>
                  <div className="text-xs font-bold text-ink">Friendly Robber</div>
                  <div className="text-[10px] text-neutral-500">Shields players &le; 2 VP</div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.friendlyRobber}
                  onChange={(e) =>
                    setSettings({ ...settings, friendlyRobber: e.target.checked })
                  }
                  className="h-4 w-4 rounded border-2 border-ink text-ink accent-ink"
                />
              </label>

              <label className="flex cursor-pointer items-center justify-between rounded border border-ink/30 bg-paper p-2">
                <div>
                  <div className="text-xs font-bold text-ink">Harbor Master</div>
                  <div className="text-[10px] text-neutral-500">+2 VP for 3+ port points</div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.harborMaster}
                  onChange={(e) =>
                    setSettings({ ...settings, harborMaster: e.target.checked })
                  }
                  className="h-4 w-4 rounded border-2 border-ink text-ink accent-ink"
                />
              </label>

              <label className="flex cursor-pointer items-center justify-between rounded border border-ink/30 bg-paper p-2">
                <div>
                  <div className="text-xs font-bold text-ink">Balanced Dice</div>
                  <div className="text-[10px] text-neutral-500">Fixed 36-card deck</div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.balancedDice}
                  onChange={(e) =>
                    setSettings({ ...settings, balancedDice: e.target.checked })
                  }
                  className="h-4 w-4 rounded border-2 border-ink text-ink accent-ink"
                />
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* Start Button */}
      <div className="mt-8 border-t-2 border-ink pt-6 text-center">
        <button
          type="button"
          onClick={handleLaunch}
          className="inline-flex w-full items-center justify-center gap-3 rounded-xl border-2 border-ink bg-amber-400 px-8 py-4 font-mono text-lg font-black uppercase text-ink shadow-[4px_4px_0px_#121212] transition-all hover:-translate-y-0.5 hover:bg-amber-300 hover:shadow-[6px_6px_0px_#121212] active:translate-y-0 active:shadow-[2px_2px_0px_#121212] sm:w-auto"
        >
          <span>🚀 Launch Puffton Match</span>
        </button>
      </div>
    </div>
  );
}
