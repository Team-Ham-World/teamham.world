"use client";

import React, { useEffect, useState } from "react";
import type { PufftonGameState } from "@/lib/puffton/types";

interface PufftonMascotProps {
  gameState: PufftonGameState;
}

const PUFF_ASCII_IDLE = `
  /\\___/\\
 (  o.o  )  ~ "Puffton Tactical Radar"
  > ^ <
`;

const PUFF_ASCII_EXCITED = `
  /\\___/\\
 (  ^.^  )  ★ "HAM HQ ONLINE!"
  > ^ <  ~*
`;

const PUFF_ASCII_ALERT = `
  /\\___/\\
 (  O_O  )  ⚡ "BANDIT ALERT!"
  ( - - )
`;

const PUFF_ASCII_VICTORY = `
  /\\_★_/\\
 (  ★.★  )  👑 "VICTORY DECLARED!"
  ( >o< ) ★
`;

export function PufftonMascot({ gameState }: PufftonMascotProps) {
  const [speech, setSpeech] = useState<string>(
    "Welcome to Puffton! Deploy your starting Hamlets and Wireways.",
  );
  const [mood, setMood] = useState<"idle" | "excited" | "alert" | "victory">("idle");
  const [pokeCount, setPokeCount] = useState(0);

  const { phase, lastDiceRoll, winnerId, turnNumber, players, activePlayerIndex } = gameState;
  const activePlayer = players[activePlayerIndex];

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (phase === "game_over" || winnerId) {
        const winner = players.find((p) => p.id === winnerId);
        setSpeech(`👑 VICTORY! ${winner?.name || "Commander"} has conquered Puffton!`);
        setMood("victory");
        return;
      }

      if (phase === "setup_round_1" || phase === "setup_round_2") {
        if (!activePlayer?.isBot) {
          setSpeech("Click a dashed circle to choose your Hamlet location, then a connected path for your Wireway.");
        } else {
          setSpeech(`${activePlayer?.name} is calculating prime resource coordinates...`);
        }
        setMood("idle");
        return;
      }

      if (phase === "robber" || phase === "discard") {
        setSpeech("⚠️ TONER BANDIT EVENT! Discard excess inventory or reposition the Bandit to intercept resources!");
        setMood("alert");
        return;
      }

      if (lastDiceRoll) {
        const rollSum = lastDiceRoll[0] + lastDiceRoll[1];
        if (rollSum === 7) {
          setSpeech("Rolled a 7! The Toner Bandit strikes! Reposition the bandit!");
          setMood("alert");
        } else if (rollSum === 6 || rollSum === 8) {
          setSpeech(`High yield roll! A golden ${rollSum} (${lastDiceRoll[0]} + ${lastDiceRoll[1]}) delivered resources!`);
          setMood("excited");
        } else {
          setSpeech(`Dice roll: ${rollSum} (${lastDiceRoll[0]} + ${lastDiceRoll[1]}). Collect your yields!`);
          setMood("idle");
        }
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [phase, lastDiceRoll, winnerId, turnNumber, activePlayer, players]);

  const handlePoke = () => {
    setPokeCount((c) => c + 1);
    const quotes = [
      "*Squeak!* 5 resources make a kingdom!",
      "Tip: 3 Toner + 2 Paper = Ham HQ (2 VP + Double Harvest)!",
      "Watch the longest Wireway! 5 roads minimum to claim 2 VP!",
      "Trading with ports drops bank rates from 4:1 to 3:1 or 2:1!",
      "Toner Guard cards count towards Largest Army (2 VP)!",
    ];
    setSpeech(quotes[pokeCount % quotes.length]);
  };

  const getAsciiArt = () => {
    switch (mood) {
      case "victory":
        return PUFF_ASCII_VICTORY;
      case "alert":
        return PUFF_ASCII_ALERT;
      case "excited":
        return PUFF_ASCII_EXCITED;
      case "idle":
      default:
        return PUFF_ASCII_IDLE;
    }
  };

  return (
    <div
      onClick={handlePoke}
      className="group cursor-pointer rounded-xl border-2 border-ink bg-amber-50 p-3 shadow-[3px_3px_0px_#121212] transition-transform hover:-translate-y-0.5"
    >
      <div className="flex items-start gap-3">
        <pre className="font-mono text-xs font-black leading-tight text-ink">
          {getAsciiArt()}
        </pre>
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] font-black uppercase tracking-wider text-neutral-500">
              Puff Tactical Assistant &#183; (Click to poke)
            </span>
          </div>
          <p className="mt-1 font-mono text-xs font-bold leading-snug text-ink">{speech}</p>
        </div>
      </div>
    </div>
  );
}
