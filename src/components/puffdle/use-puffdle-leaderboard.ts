"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  parseLeaderboardPayload,
  type PuffdleLeaderboardSnapshot,
  type SavePuffdleScoreInput,
} from "@/lib/puffdle/contracts";
import type { PuffdleStats } from "@/lib/puffdle/game";

type LeaderboardState =
  | { status: "loading" | "signed-out" | "error"; authenticated: false; username: null }
  | ({ status: "ready"; authenticated: true; username: string | null } & PuffdleLeaderboardSnapshot);

const ENDPOINT = "/api/puffdle/leaderboard";

export function usePuffdleLeaderboard() {
  const [leaderboard, setLeaderboard] = useState<LeaderboardState>({
    status: "loading", authenticated: false, username: null,
  });
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const authenticatedRef = useRef<boolean | null>(null);
  const pendingRef = useRef<SavePuffdleScoreInput | null>(null);
  const savingRef = useRef(false);
  const requestIdRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  const flushPending = useCallback(async function flush() {
    if (!authenticatedRef.current || savingRef.current || !pendingRef.current) return;
    const pending = pendingRef.current;
    savingRef.current = true;
    const requestId = ++requestIdRef.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), 10_000);
    setSaveStatus("saving");
    let saved = false;
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pending), signal: controller.signal,
      });
      if (requestId !== requestIdRef.current) return;
      if (response.status === 401 || response.status === 404) {
        authenticatedRef.current = false;
        pendingRef.current = null;
        setLeaderboard({ status: "signed-out", authenticated: false, username: null });
        setSaveStatus("idle");
        return;
      }
      if (!response.ok) throw new Error("Save unavailable");
      const parsed = parseLeaderboardPayload(await response.json());
      if (!parsed?.authenticated) throw new Error("Invalid leaderboard response");
      if (requestId !== requestIdRef.current) return;
      setLeaderboard({ ...parsed, status: "ready" });
      if (pendingRef.current === pending) pendingRef.current = null;
      setSaveStatus("saved");
      saved = true;
    } catch {
      if (requestId === requestIdRef.current) setSaveStatus("error");
    } finally {
      clearTimeout(timeout);
      if (requestId === requestIdRef.current) {
        savingRef.current = false;
        if (saved && pendingRef.current) void flush();
      }
    }
  }, []);

  const loadLeaderboard = useCallback(async () => {
    if (savingRef.current) return;
    const requestId = ++requestIdRef.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(ENDPOINT, {
        credentials: "same-origin", cache: "no-store", signal: controller.signal,
      });
      const parsed = response.status === 404
        ? { authenticated: false as const, username: null }
        : response.ok ? parseLeaderboardPayload(await response.json()) : null;
      if (!parsed) throw new Error("Leaderboard unavailable");
      if (requestId !== requestIdRef.current) return;
      authenticatedRef.current = parsed.authenticated;
      setLeaderboard(parsed.authenticated
        ? { ...parsed, status: "ready" }
        : { ...parsed, status: "signed-out" });
      if (parsed.authenticated) {
        void flushPending();
      } else {
        pendingRef.current = null;
        setSaveStatus("idle");
      }
    } catch {
      if (requestId === requestIdRef.current) {
        authenticatedRef.current = null;
        setLeaderboard({ status: "error", authenticated: false, username: null });
      }
    } finally {
      clearTimeout(timeout);
    }
  }, [flushPending]);

  const cancelRequests = useCallback(() => {
    ++requestIdRef.current;
    controllerRef.current?.abort();
    savingRef.current = false;
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => void loadLeaderboard());
    return () => {
      cancelAnimationFrame(frame);
      cancelRequests();
    };
  }, [loadLeaderboard, cancelRequests]);

  const submitMemberScore = useCallback((score: number, stats: PuffdleStats) => {
    if (authenticatedRef.current === false) return;
    // Coalesce results while a request is in flight: keep the best score and
    // newest local statistics. Retrying this snapshot cannot double-count games.
    pendingRef.current = {
      score: Math.max(score, pendingRef.current?.score ?? 0),
      gamesPlayed: stats.gamesPlayed, gamesWon: stats.gamesWon,
      currentStreak: stats.currentStreak, maxStreak: stats.maxStreak,
    };
    void flushPending();
  }, [flushPending]);

  const retrySave = useCallback(() => {
    if (authenticatedRef.current) void flushPending();
    else void loadLeaderboard();
  }, [flushPending, loadLeaderboard]);

  return { leaderboard, saveStatus, submitMemberScore, retrySave, loadLeaderboard };
}
