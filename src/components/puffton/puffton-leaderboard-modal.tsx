"use client";

import Link from "next/link";
import React from "react";
import type { PufftonLeaderboardSnapshot } from "@/lib/puffton/leaderboard";

interface PufftonLeaderboardModalProps {
  leaderboard: {
    status: "idle" | "loading" | "ready" | "error" | "saving";
    authenticated: boolean;
    username: string | null;
    snapshot?: PufftonLeaderboardSnapshot;
  };
  onClose: () => void;
}

export function PufftonLeaderboardModal({
  leaderboard,
  onClose,
}: PufftonLeaderboardModalProps) {
  const scores = leaderboard.snapshot?.scores || [];
  const stats = leaderboard.snapshot?.stats;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-2xl border-4 border-ink bg-paper p-6 shadow-[8px_8px_0px_#121212]">
        {/* Header */}
        <div className="flex items-center justify-between border-b-2 border-ink pb-3">
          <div>
            <h2 className="font-mono text-xl font-black uppercase text-ink">
              Puffton Member Leaderboard
            </h2>
            <p className="text-xs text-neutral-600">
              Top galactic settlers verified with Discord membership
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded border-2 border-ink bg-white px-2 py-1 font-mono text-xs font-bold hover:bg-neutral-100"
          >
            ✕ Close
          </button>
        </div>

        {/* Discord Auth Banner */}
        {!leaderboard.authenticated ? (
          <div className="mt-4 rounded-xl border-2 border-ink bg-indigo-50 p-4 text-center">
            <p className="font-mono text-xs font-bold text-ink">
              Sign in with Discord to record your Puffton victories on the official member leaderboard!
            </p>
            <Link
              href="/api/auth/discord/login"
              className="mt-3 inline-flex items-center gap-2 rounded-lg border-2 border-ink bg-[#5865F2] px-4 py-2 font-mono text-xs font-black text-white shadow-[2px_2px_0px_#121212] hover:bg-[#4752C4]"
            >
              <span>Connect Discord Account</span>
            </Link>
          </div>
        ) : (
          <div className="mt-4 flex flex-wrap items-center justify-between rounded-xl border-2 border-ink bg-emerald-50 p-3">
            <div>
              <span className="text-xs text-neutral-600">Logged in as:</span>
              <div className="font-mono text-sm font-black text-ink">{leaderboard.username}</div>
            </div>
            {stats && (
              <div className="flex gap-3 font-mono text-xs font-bold text-ink">
                <div>Won: {stats.gamesWon}</div>
                <div>Streak: {stats.currentStreak} (Max: {stats.maxStreak})</div>
              </div>
            )}
          </div>
        )}

        {/* Leaderboard Table */}
        <div className="mt-4 max-h-72 overflow-y-auto rounded-xl border-2 border-ink bg-white p-2">
          {scores.length === 0 ? (
            <div className="py-8 text-center font-mono text-xs font-bold text-neutral-500">
              No games recorded on the leaderboard yet. Be the first to win!
            </div>
          ) : (
            <table className="w-full text-left font-mono text-xs">
              <thead>
                <tr className="border-b border-ink/20 text-[10px] uppercase text-neutral-500">
                  <th className="pb-1 text-center">#</th>
                  <th className="pb-1">Commander</th>
                  <th className="pb-1 text-center">Wins</th>
                  <th className="pb-1 text-center">Played</th>
                  <th className="pb-1 text-right">Streak</th>
                </tr>
              </thead>
              <tbody>
                {scores.map((entry) => (
                  <tr
                    key={entry.rank}
                    className={`border-b border-neutral-100 last:border-0 ${
                      entry.mine ? "bg-amber-100 font-black" : ""
                    }`}
                  >
                    <td className="py-2 text-center font-bold">
                      {entry.rank === 1 && "🥇 "}
                      {entry.rank === 2 && "🥈 "}
                      {entry.rank === 3 && "🥉 "}
                      {entry.rank}
                    </td>
                    <td className="py-2 font-bold text-ink">
                      {entry.username} {entry.mine && "(You)"}
                    </td>
                    <td className="py-2 text-center">{entry.gamesWon}</td>
                    <td className="py-2 text-center">{entry.gamesPlayed}</td>
                    <td className="py-2 text-right">{entry.currentStreak}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
