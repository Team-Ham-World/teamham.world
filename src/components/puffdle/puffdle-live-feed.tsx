"use client";

import React, { useEffect, useState } from "react";
import type { TileEvaluation } from "@/lib/puffdle/game";

export interface LivePlayer {
  id: string;
  username: string;
  avatarText: string;
  avatarBg: string;
  evaluations: TileEvaluation[][];
  status: "playing" | "won" | "lost";
  attempts: number;
  isSelf?: boolean;
}

interface PuffdleLiveFeedProps {
  currentEvaluations: TileEvaluation[][];
  currentStatus: "IN_PROGRESS" | "WON" | "LOST";
  username: string | null;
}

// Fallback/Simulated squad members for solo sessions
const SQUAD_POOL = [
  { username: "cyr1en", avatarText: "CY", avatarBg: "#2563eb" },
  { username: "BytePuff", avatarText: "BP", avatarBg: "#d97706" },
  { username: "HamCommander", avatarText: "HC", avatarBg: "#be185d" },
  { username: "PixelPuff", avatarText: "PP", avatarBg: "#059669" },
  { username: "TonerBandit", avatarText: "TB", avatarBg: "#7c3aed" },
];

function generateSimulatedGuesses(step: number): TileEvaluation[][] {
  const patterns: TileEvaluation[][][] = [
    [
      ["absent", "absent", "present", "absent", "absent"],
      ["present", "absent", "present", "correct", "absent"],
      ["correct", "correct", "absent", "correct", "correct"],
      ["correct", "correct", "correct", "correct", "correct"],
    ],
    [
      ["absent", "present", "absent", "absent", "present"],
      ["correct", "present", "absent", "correct", "absent"],
      ["correct", "correct", "correct", "correct", "correct"],
    ],
    [
      ["absent", "absent", "absent", "absent", "present"],
      ["present", "present", "absent", "absent", "absent"],
      ["absent", "correct", "present", "present", "absent"],
      ["correct", "correct", "correct", "correct", "correct"],
    ],
  ];

  const chosen = patterns[step % patterns.length];
  const maxRows = Math.min(step, chosen.length);
  return chosen.slice(0, maxRows);
}

export function PuffdleLiveFeed({
  currentEvaluations,
  currentStatus,
  username,
}: PuffdleLiveFeedProps) {
  const [squad, setSquad] = useState<LivePlayer[]>([
    {
      id: "bot-1",
      username: SQUAD_POOL[0].username,
      avatarText: SQUAD_POOL[0].avatarText,
      avatarBg: SQUAD_POOL[0].avatarBg,
      evaluations: generateSimulatedGuesses(2),
      status: "playing",
      attempts: 2,
    },
    {
      id: "bot-2",
      username: SQUAD_POOL[1].username,
      avatarText: SQUAD_POOL[1].avatarText,
      avatarBg: SQUAD_POOL[1].avatarBg,
      evaluations: generateSimulatedGuesses(3),
      status: "playing",
      attempts: 3,
    },
    {
      id: "bot-3",
      username: SQUAD_POOL[2].username,
      avatarText: SQUAD_POOL[2].avatarText,
      avatarBg: SQUAD_POOL[2].avatarBg,
      evaluations: generateSimulatedGuesses(1),
      status: "playing",
      attempts: 1,
    },
  ]);

  // Periodic simulated squad progress
  useEffect(() => {
    const interval = setInterval(() => {
      setSquad((prev) =>
        prev.map((player, idx) => {
          if (player.status === "won" || player.status === "lost") return player;

          const nextAttempts = player.attempts + 1;
          const nextEvals = generateSimulatedGuesses(nextAttempts + idx);
          const isWon = nextEvals.some(
            (row) => row.length === 5 && row.every((t) => t === "correct"),
          );
          const isLost = nextAttempts >= 6 && !isWon;

          return {
            ...player,
            attempts: nextAttempts,
            evaluations: nextEvals,
            status: isWon ? "won" : isLost ? "lost" : "playing",
          };
        }),
      );
    }, 12000);

    return () => clearInterval(interval);
  }, []);

  // Sync current player's live presence
  useEffect(() => {
    const statusMap =
      currentStatus === "WON" ? "won" : currentStatus === "LOST" ? "lost" : "playing";

    void fetch("/api/puffdle/presence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: username || "You",
        evaluations: currentEvaluations,
        status: statusMap,
      }),
    }).catch(() => {
      // Ignore network presence errors
    });
  }, [currentEvaluations, currentStatus, username]);

  const allPlayers: LivePlayer[] = [
    {
      id: "self",
      username: username ? `${username} (You)` : "You",
      avatarText: username ? username.slice(0, 2).toUpperCase() : "ME",
      avatarBg: "#18181b",
      evaluations: currentEvaluations,
      status: currentStatus === "WON" ? "won" : currentStatus === "LOST" ? "lost" : "playing",
      attempts: currentEvaluations.length,
      isSelf: true,
    },
    ...squad,
  ];

  return (
    <div className="flex w-full flex-col gap-3 rounded-2xl border-3 border-ink bg-surface p-3.5 shadow-[4px_4px_0px_#121212]">
      {/* Header */}
      <div className="flex items-center justify-between border-b-2 border-ink pb-2.5">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
          </span>
          <h2 className="font-mono text-xs font-black uppercase tracking-wider text-ink">
            Live Decoders ({allPlayers.length})
          </h2>
        </div>
        <span className="font-mono text-[10px] font-bold uppercase text-neutral-500">
          Sync Online
        </span>
      </div>

      {/* Players Feed Grid */}
      <div className="flex flex-col gap-2.5">
        {allPlayers.map((player) => (
          <div
            key={player.id}
            className={`flex items-center gap-3 rounded-xl border-2 border-ink p-2.5 transition-all ${
              player.isSelf
                ? "bg-amber-50/80 shadow-[2px_2px_0px_#121212]"
                : "bg-paper/80"
            }`}
          >
            {/* Player Avatar */}
            <div className="flex flex-col items-center gap-1">
              <div
                style={{ backgroundColor: player.avatarBg }}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-ink font-mono text-xs font-black text-white shadow-[1px_1px_0px_#121212]"
              >
                {player.avatarText}
              </div>
              <span className="max-w-[70px] truncate text-center font-mono text-[10px] font-bold text-ink">
                {player.username}
              </span>
            </div>

            {/* Live Guess Matrix Block (Matching attached reference style) */}
            <div className="flex flex-1 flex-col items-end">
              {/* Status Header */}
              <div className="mb-1 flex items-center gap-1.5 font-mono text-[10px] font-bold">
                {player.status === "won" && (
                  <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-800">
                    ★ Decoded in {player.attempts}!
                  </span>
                )}
                {player.status === "lost" && (
                  <span className="rounded bg-red-100 px-1.5 py-0.5 text-red-800">
                    ✕ Overload (6/6)
                  </span>
                )}
                {player.status === "playing" && (
                  <span className="text-neutral-500">
                    {player.attempts === 0 ? "Ready..." : `Attempt ${player.attempts}/6`}
                  </span>
                )}
              </div>

              {/* 6x5 Mini Grid */}
              <div className="grid grid-rows-6 gap-[2.5px] rounded-lg border-2 border-ink bg-[#18181b] p-1.5 shadow-[2px_2px_0px_#121212]">
                {Array.from({ length: 6 }).map((_, rIdx) => {
                  const rowEval = player.evaluations[rIdx] || [];
                  const isAttempted = rIdx < player.evaluations.length;

                  return (
                    <div key={rIdx} className="grid grid-cols-5 gap-[2.5px]">
                      {Array.from({ length: 5 }).map((__, cIdx) => {
                        const tileState = rowEval[cIdx];
                        let bg = "#27272a"; // dark empty slot

                        if (isAttempted) {
                          if (tileState === "correct") bg = "#15803d"; // green
                          else if (tileState === "present") bg = "#d97706"; // yellow/gold
                          else bg = "#475569"; // absent gray
                        }

                        return (
                          <div
                            key={cIdx}
                            style={{ backgroundColor: bg }}
                            className={`h-3 w-3 rounded-[2px] transition-colors duration-200 ${
                              isAttempted && tileState === "correct"
                                ? "border border-emerald-300"
                                : ""
                            }`}
                          />
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
