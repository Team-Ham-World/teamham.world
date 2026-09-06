"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DailyGuess, DailySnapshot } from "@/lib/puffdle/daily";
import { createDefaultStats, createInitialPuffdleState } from "@/lib/puffdle/game";
import { parseStoredStats } from "@/lib/puffdle/storage";

function parseSnapshot(value: unknown): DailySnapshot {
  if (!value || typeof value !== "object") throw new Error("Invalid response");
  const v = value as DailySnapshot;
  const g = v.game;
  if (v.authenticated !== true || typeof v.accountId !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v.puzzleDate)
    || !Number.isFinite(Date.parse(v.nextPuzzleAt)) || !g || g.mode !== "daily"
    || !Number.isInteger(g.dayNumber) || !Array.isArray(g.guesses) || g.guesses.length > 6
    || !g.guesses.every(guess => typeof guess === "string" && /^[A-Z]{5}$/.test(guess))
    || !Array.isArray(g.evaluations) || g.evaluations.length !== g.guesses.length
    || !g.evaluations.every(row => Array.isArray(row) && row.length === 5 && row.every(tile => ["correct", "present", "absent"].includes(tile)))
    || !["IN_PROGRESS", "WON", "LOST"].includes(g.status) || typeof g.targetWord !== "string"
    || !g.keyboardStatus || typeof g.keyboardStatus !== "object" || !parseStoredStats(v.stats)) throw new Error("Invalid response");
  return v;
}

export function usePuffdleDaily() {
  const [snapshot, setSnapshot] = useState<DailySnapshot | null>(null);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "signed-out" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const current = useRef<DailySnapshot | null>(null);
  const pending = useRef<DailyGuess | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);

  const request = useCallback(async (input?: DailyGuess) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch("/api/puffdle/daily", {
        method: input ? "POST" : "GET", cache: "no-store", credentials: "same-origin",
        headers: input ? { "Content-Type": "application/json" } : undefined,
        body: input ? JSON.stringify(input) : undefined, signal: controller.signal,
      });
      const body: unknown = await response.json();
      if (!mounted.current) return;
      if (response.status === 401 || (response.ok && (body as { authenticated?: boolean })?.authenticated === false)) {
        pending.current = null; current.current = null; setSnapshot(null); setDraft(""); setMessage(null); setStatus("signed-out"); return;
      }
      if (!response.ok && response.status !== 409) throw new Error("Daily game unavailable");
      const next = parseSnapshot(body);
      const prev = current.current;
      if (prev?.accountId === next.accountId && (next.puzzleDate < prev.puzzleDate || (next.puzzleDate === prev.puzzleDate && next.game.guesses.length < prev.game.guesses.length))) return;
      if (input || prev?.accountId !== next.accountId || prev?.puzzleDate !== next.puzzleDate || prev?.game.guesses.length !== next.game.guesses.length) setDraft("");
      pending.current = null;
      current.current = next;
      setSnapshot(next);
      setStatus("ready");
      setMessage(response.status === 409 ? "Your daily game changed on another device or a new UTC day began. Your saved progress is shown." : null);
    } catch {
      if (mounted.current) {
        setStatus("error");
        setMessage(input ? "We couldn't confirm your guess. Retry to recover your saved progress safely." : "Your daily game couldn't be loaded. Retry to continue.");
      }
    } finally {
      clearTimeout(timeout); inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }, []);
  const refresh = useCallback(() => request(pending.current ?? undefined), [request]);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const update = () => { if (document.visibilityState === "visible") void refresh(); };
    const timer = setInterval(update, 30_000);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => { mounted.current = false; clearInterval(timer); window.removeEventListener("focus", update); document.removeEventListener("visibilitychange", update); };
  }, [refresh]);
  const submit = useCallback(() => {
    const saved = current.current;
    if (!saved || inFlight.current || pending.current || status !== "ready" || saved.game.status !== "IN_PROGRESS") return;
    const input = { accountId: saved.accountId, puzzleDate: saved.puzzleDate, revision: saved.game.guesses.length, guess: draft };
    pending.current = input;
    void request(input);
  }, [draft, request, status]);
  return {
    game: { ...(snapshot?.game ?? createInitialPuffdleState("", "daily")), currentGuess: draft },
    stats: snapshot?.stats ?? createDefaultStats(), status, busy, message,
    nextPuzzleAt: snapshot?.nextPuzzleAt, setDraft, submit, refresh,
    canPlay: status === "ready" && !busy && snapshot?.game.status === "IN_PROGRESS",
  };
}
