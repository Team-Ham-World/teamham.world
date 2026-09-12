"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import type { PuffPose } from "@/lib/puff/model";
import {
  advancePuffRenderClock,
  getPuffRenderProfile,
  type PuffRenderCadence,
  type PuffRenderPhase,
} from "@/lib/puff/performance";
import { renderPuff, type PuffView } from "@/lib/puff/render";
import {
  SUIPUFF_EVENT,
  SUIPUFF_MERGE_POP_SECONDS,
  SUIPUFF_TIER_COUNT,
  SUIPUFF_TIER_RADII,
  createSuipuffGame,
  dropSuipuff,
  resizeSuipuffGame,
  setSuipuffAim,
  startSuipuff,
  stepSuipuffGame,
  suipuffTierRadius,
  type SuipuffGameState,
} from "@/lib/puff/suipuff";

import styles from "./suipuff-game.module.css";

type GamePhase = PuffRenderPhase;

interface PuffLeaderboardEntry {
  rank: number;
  username: string;
  score: number;
  mine: boolean;
}

type LeaderboardState =
  | { status: "loading"; authenticated: false; username: null }
  | { status: "signed-out"; authenticated: false; username: null }
  | { status: "error"; authenticated: false; username: null }
  | {
      status: "ready" | "saving";
      authenticated: true;
      username: string | null;
      personalBest: number;
      scores: PuffLeaderboardEntry[];
    };

interface Palette {
  paper: string;
  surface: string;
  ink: string;
  muted: string;
  red: string;
  blue: string;
}

interface SuipuffAtlas {
  palette: Palette;
  /** One pre-rendered ASCII Puff per tier, each with its own pose. */
  tiers: HTMLCanvasElement[];
  /** "+N" score pops keyed by their point value — baked, never live text. */
  popGlyphs: Record<number, HTMLCanvasElement>;
  deadBanner: HTMLCanvasElement;
  nextPlate: HTMLCanvasElement;
}

interface FloorTexture {
  canvas: HTMLCanvasElement;
  pixelRatio: number;
  trayWidth: number;
}

const FIXED_STEP = 1 / 60;
const MAX_FRAME_DELTA = 0.1;
const MAX_CATCH_UP_STEPS = 5;
const BEST_SCORE_KEY = "ham:suipuff:best:v1";
const AIM_SPEED = 260;

const AIM_LEFT_KEYS = new Set(["ArrowLeft", "KeyA"]);
const AIM_RIGHT_KEYS = new Set(["ArrowRight", "KeyD"]);
const DROP_KEYS = new Set(["Space", "Enter"]);

const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

/*
 * Tier sprites: rows ≈ 0.8·cols at a 4×5 px cell gives a grid aspect of ~1,
 * so renderPuff frames the model in a 1.33-unit half-height box. The coat
 * (radius ≈0.9 world units) then covers ≈0.68 of the sprite's width — the
 * per-radius draw factor and vertical centre below encode that framing so the
 * drawn sprite tracks the physics circle exactly.
 */
const SPRITE_CELL_W = 4;
const SPRITE_CELL_H = 5;
const SPRITE_DRAW_PER_RADIUS = 2.95;
const SPRITE_CENTER_FRAC = 0.4246;

const TIER_SPRITE_VIEWS: { pose: PuffPose; view: PuffView }[] = [
  // Toner Speck — perky and looking up at the drop.
  { pose: { time: 1.2, bob: 0, squash: -0.08, blink: 1, gazeX: 0.08, gazeY: 0.06 }, view: { yaw: 0.5, pitch: -0.1 } },
  // Pufflet — glancing off to one side.
  { pose: { time: 1.9, bob: 0, squash: 0, blink: 1, gazeX: -0.06, gazeY: 0.02 }, view: { yaw: -0.42, pitch: 0.08 } },
  // Puffling — already a little chubby.
  { pose: { time: 2.6, bob: 0, squash: 0.1, blink: 1, gazeX: 0.04, gazeY: -0.03 }, view: { yaw: 0.26, pitch: 0.14 } },
  // Puff — the canonical mascot pose.
  { pose: { time: 1.2, bob: 0, squash: 0, blink: 1, gazeX: 0.045, gazeY: 0 }, view: { yaw: 0.42, pitch: 0 } },
  // Big Puff — settling into its size.
  { pose: { time: 3.3, bob: 0, squash: 0.16, blink: 1, gazeX: -0.04, gazeY: 0.04 }, view: { yaw: -0.3, pitch: -0.06 } },
  // Mega Puff — heavy-lidded and heavy-set.
  { pose: { time: 4.0, bob: 0, squash: 0.2, blink: 0.9, gazeX: 0.07, gazeY: -0.05 }, view: { yaw: 0.62, pitch: 0.06 } },
  // Giga Puff — a real armful.
  { pose: { time: 4.7, bob: 0, squash: 0.24, blink: 1, gazeX: -0.08, gazeY: 0.03 }, view: { yaw: -0.58, pitch: 0.12 } },
  // THE PUFF — facing the player head-on.
  { pose: { time: 5.4, bob: 0, squash: 0.3, blink: 1, gazeX: 0, gazeY: -0.06 }, view: { yaw: 0.05, pitch: -0.12 } },
];

/** Every "+N" a merge can award: the triangular scores plus the jackpot. */
const POP_SCORES = [1, 3, 6, 10, 15, 21, 28, 100] as const;

function cssColor(style: CSSStyleDeclaration, name: string, fallback: string) {
  return style.getPropertyValue(name).trim() || fallback;
}

function readPalette(): Palette {
  const style = getComputedStyle(document.documentElement);
  return {
    paper: cssColor(style, "--color-paper", "#f6f1e5"),
    surface: cssColor(style, "--color-surface", "#fffdf6"),
    ink: cssColor(style, "--color-ink", "#1c1a17"),
    muted: cssColor(style, "--color-muted", "#5c5648"),
    red: cssColor(style, "--color-decorative-red", "#d93625"),
    blue: cssColor(style, "--color-interactive-blue", "#1d4ed8"),
  };
}

/** Bigger tiers get finer ASCII grids — more Puff, more characters. */
function makeTierSprite(palette: Palette, tier: number): HTMLCanvasElement {
  const baseRadius = SUIPUFF_TIER_RADII[tier];
  const cols = Math.max(16, Math.min(140, Math.round(baseRadius * 1.14)));
  const rows = Math.max(14, Math.round(cols * 0.8));
  const { pose, view } = TIER_SPRITE_VIEWS[tier];
  const frame = renderPuff(cols, rows, SPRITE_CELL_W / SPRITE_CELL_H, pose, view);

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(cols * SPRITE_CELL_W);
  canvas.height = Math.ceil(rows * SPRITE_CELL_H);
  const context = canvas.getContext("2d");
  if (!context) return canvas;

  context.font = `700 5.4px ${MONO}`;
  context.textBaseline = "top";
  context.fillStyle = palette.ink;
  for (const [row, line] of frame.ink.split("\n").entries()) {
    context.fillText(line, 0, row * SPRITE_CELL_H);
  }
  context.fillStyle = palette.red;
  for (const [row, line] of frame.accent.split("\n").entries()) {
    context.fillText(line, 0, row * SPRITE_CELL_H);
  }
  return canvas;
}

function makePopGlyph(palette: Palette, score: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  const font = `800 13px ${MONO}`;
  const text = `+${score}`;
  if (context) {
    context.font = font;
    const width = Math.ceil(context.measureText(text).width) + 6;
    canvas.width = Math.max(1, width);
    canvas.height = 20;
    context.font = font;
    context.textBaseline = "middle";
    context.fillStyle = palette.ink;
    context.fillText(text, 4, 11);
    context.fillStyle = palette.red;
    context.fillText(text, 3, 10);
  }
  return canvas;
}

function makeDeadBanner(palette: Palette): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  const font = `900 16px ${MONO}`;
  const text = "* OVER THE LINE *";
  if (context) {
    context.font = font;
    const width = Math.ceil(context.measureText(text).width) + 8;
    canvas.width = Math.max(1, width);
    canvas.height = 24;
    context.font = font;
    context.textBaseline = "middle";
    context.fillStyle = palette.ink;
    context.fillText(text, 5, 13);
    context.fillStyle = palette.red;
    context.fillText(text, 4, 12);
  }
  return canvas;
}

function makeNextPlate(palette: Palette): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  const width = 64;
  const height = 74;
  canvas.width = width;
  canvas.height = height;
  if (context) {
    context.fillStyle = palette.paper;
    context.fillRect(0, 0, width, height);
    context.strokeStyle = palette.ink;
    context.lineWidth = 2;
    context.strokeRect(1, 1, width - 2, height - 2);
    context.font = `800 9px ${MONO}`;
    context.textBaseline = "middle";
    context.textAlign = "center";
    context.fillStyle = palette.muted;
    context.fillText("NEXT", width / 2, 10);
    context.strokeStyle = palette.red;
    context.lineWidth = 1;
    context.setLineDash([3, 3]);
    context.strokeRect(6.5, 19.5, width - 13, height - 27);
  }
  return canvas;
}

function buildSuipuffAtlas(): SuipuffAtlas {
  const palette = readPalette();
  const popGlyphs: Record<number, HTMLCanvasElement> = {};
  for (const score of POP_SCORES) popGlyphs[score] = makePopGlyph(palette, score);
  return {
    palette,
    tiers: Array.from({ length: SUIPUFF_TIER_COUNT }, (_, tier) =>
      makeTierSprite(palette, tier),
    ),
    popGlyphs,
    deadBanner: makeDeadBanner(palette),
    nextPlate: makeNextPlate(palette),
  };
}

/** The tray's floor strip: paper, a red top rule, and the fanfold motif. */
function buildFloorTexture(
  trayWidth: number,
  pixelRatio: number,
  palette: Palette,
): FloorTexture | null {
  const context = document.createElement("canvas").getContext("2d", {
    alpha: false,
  });
  if (!context) return null;
  const height = 18;
  const width = Math.ceil(trayWidth + 8);
  context.canvas.width = Math.max(1, Math.ceil(width * pixelRatio));
  context.canvas.height = Math.ceil(height * pixelRatio);
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.fillStyle = palette.paper;
  context.fillRect(0, 0, width, height);
  context.fillStyle = palette.red;
  context.fillRect(0, 0, width, 3);
  context.fillStyle = palette.ink;
  context.font = `700 10px ${MONO}`;
  context.textBaseline = "top";
  const motif = "__/\\__HAM__";
  const motifWidth = context.measureText(motif).width;
  for (let x = 3; x < width; x += motifWidth) {
    context.fillText(motif, x, 6);
  }
  return { canvas: context.canvas, pixelRatio, trayWidth };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Suipuff scores are unquantised: any safe integer in the posted range. */
function isValidLeaderboardScore(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 1_000_000
  );
}

function isLeaderboardEntry(value: unknown): value is PuffLeaderboardEntry {
  if (!isRecord(value)) return false;
  const { rank, username, score, mine } = value;
  if (
    typeof rank !== "number" ||
    !Number.isSafeInteger(rank) ||
    rank < 1 ||
    rank > 10
  ) {
    return false;
  }
  return (
    typeof username === "string" &&
    username.length > 0 &&
    isValidLeaderboardScore(score) &&
    typeof mine === "boolean"
  );
}

function readLeaderboardPayload(value: unknown): LeaderboardState | null {
  if (!isRecord(value)) return null;
  if (value.authenticated === false) {
    return { status: "signed-out", authenticated: false, username: null };
  }
  if (
    value.authenticated !== true ||
    !(typeof value.username === "string" || value.username === null) ||
    !isValidLeaderboardScore(value.personalBest) ||
    !Array.isArray(value.scores) ||
    !value.scores.every(isLeaderboardEntry)
  ) {
    return null;
  }
  return {
    status: "ready",
    authenticated: true,
    username: value.username,
    personalBest: value.personalBest,
    scores: value.scores,
  };
}

function Leaderboard({ state }: Readonly<{ state: LeaderboardState }>) {
  if (state.status === "loading") {
    return <p className={styles.boardMessage}>Checking the member board…</p>;
  }
  if (state.status === "signed-out") {
    return (
      <p className={styles.boardMessage}>
        Sign in as a Team HAM member before playing to save a shared high score.
      </p>
    );
  }
  if (state.status === "error") {
    return (
      <p className={styles.boardMessage}>
        The score printer is offline right now.
      </p>
    );
  }
  if (state.scores.length === 0) {
    return (
      <p className={styles.boardMessage}>
        No scores yet. The first pile could be yours.
      </p>
    );
  }

  return (
    <ol className={styles.leaderboard} aria-label="Suipuff member leaderboard">
      {state.scores.slice(0, 7).map((entry) => (
        <li
          key={`${entry.rank}-${entry.username}`}
          data-mine={entry.mine || undefined}
        >
          <span>{String(entry.rank).padStart(2, "0")}</span>
          <strong>{entry.username}</strong>
          <b>{entry.score}</b>
        </li>
      ))}
    </ol>
  );
}

export function SuipuffGame({ exitHref }: Readonly<{ exitHref: string }>) {
  const router = useRouter();
  const arenaRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<SuipuffGameState | null>(null);
  const phaseRef = useRef<GamePhase>("ready");
  const finishRunRef = useRef<(score: number) => void>(() => {});
  const heldKeysRef = useRef<Set<string>>(new Set());
  const [phase, setPhaseState] = useState<GamePhase>("ready");
  const [score, setScore] = useState(0);
  const [localBest, setLocalBest] = useState(0);
  const [newBest, setNewBest] = useState(false);
  const [announcement, setAnnouncement] = useState("Suipuff unlocked.");
  const [leaderboard, setLeaderboard] = useState<LeaderboardState>({
    status: "loading",
    authenticated: false,
    username: null,
  });
  const leaderboardRef = useRef(leaderboard);

  const applyLeaderboard = useCallback((next: LeaderboardState) => {
    leaderboardRef.current = next;
    setLeaderboard(next);
  }, []);

  const setPhase = useCallback((next: GamePhase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  // Post-queue: only one POST is ever in flight, and queued runs coalesce to
  // their max (the backend stores one monotonic high score). Kept in a ref so
  // the pump reads live state, never a stale closure.
  const submitQueueRef = useRef({ active: false, pending: 0 });
  const mountedRef = useRef(true);
  useEffect(() => {
    const queue = submitQueueRef.current;
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      queue.pending = 0;
    };
  }, []);

  // Serialized submission pump: at most one POST is in flight, and scores
  // that finish while POSTs are busy coalesce to their max. A queued score
  // waits out an in-flight GET so a 401 cannot strand it, and the initial
  // leaderboard load flushes the queue once auth resolves.
  const pumpScoreSubmissionsRef = useRef<() => void>(() => {});
  useEffect(() => {
    pumpScoreSubmissionsRef.current = () => {
      const queue = submitQueueRef.current;
      const board = leaderboardRef.current;
      if (
        !mountedRef.current ||
        !board.authenticated ||
        queue.active ||
        queue.pending <= 0
      ) {
        return;
      }
      queue.active = true;
      const runScore = queue.pending;
      queue.pending = 0;

      applyLeaderboard({ ...board, status: "saving" });

      void (async () => {
        try {
          const response = await fetch("/api/puff/suipuff/leaderboard", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ score: runScore }),
          });
          if (!mountedRef.current) return;

          if (response.status === 401) {
            let code: unknown;
            try {
              const payload: unknown = await response.json();
              if (!mountedRef.current) return;
              code = isRecord(payload) ? payload.error : undefined;
            } catch {
              code = undefined;
            }
            if (code === "authentication_required") {
              // The member session ended mid-run: lock the board, drop any
              // queued submission (it would 401 too), keep the local best.
              queue.pending = 0;
              applyLeaderboard({
                status: "signed-out",
                authenticated: false,
                username: null,
              });
              return;
            }
            throw new Error("score save rejected");
          }
          if (!response.ok) throw new Error("score save failed");

          const payload: unknown = await response.json();
          if (!mountedRef.current) return;
          const parsed = readLeaderboardPayload(payload);
          if (!parsed || !parsed.authenticated) {
            throw new Error("invalid score response");
          }
          applyLeaderboard(parsed);
        } catch {
          if (!mountedRef.current) return;
          // A saving board can only drop back to ready; any other status
          // (including the signed-out board a 401 just applied) stays as-is.
          const current = leaderboardRef.current;
          if (current.authenticated && current.status === "saving") {
            applyLeaderboard({ ...current, status: "ready" });
          }
          setAnnouncement(
            "Score saved locally. The member board could not be reached.",
          );
        } finally {
          queue.active = false;
          if (mountedRef.current && queue.pending > 0) {
            pumpScoreSubmissionsRef.current();
          }
        }
      })();
    };
  }, [applyLeaderboard]);

  const queueMemberScore = useCallback((runScore: number) => {
    if (runScore <= 0) return;
    submitQueueRef.current.pending = Math.max(
      submitQueueRef.current.pending,
      runScore,
    );
    pumpScoreSubmissionsRef.current();
  }, []);
  const queueMemberScoreRef = useRef(queueMemberScore);
  useEffect(() => {
    queueMemberScoreRef.current = queueMemberScore;
  }, [queueMemberScore]);

  const loadLeaderboard = useCallback(async () => {
    try {
      const response = await fetch("/api/puff/suipuff/leaderboard", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!mountedRef.current) return;
      if (response.status === 404) {
        submitQueueRef.current.pending = 0;
        applyLeaderboard({
          status: "signed-out",
          authenticated: false,
          username: null,
        });
        return;
      }
      if (!response.ok) throw new Error("leaderboard unavailable");
      const payload: unknown = await response.json();
      if (!mountedRef.current) return;
      const parsed = readLeaderboardPayload(payload);
      if (!parsed) throw new Error("invalid leaderboard response");
      if (!parsed.authenticated) submitQueueRef.current.pending = 0;
      applyLeaderboard(parsed);
      // The board just became authenticated: POST any score a run finished
      // while this GET was still loading.
      pumpScoreSubmissionsRef.current();
    } catch {
      if (!mountedRef.current) return;
      applyLeaderboard({
        status: "error",
        authenticated: false,
        username: null,
      });
    }
  }, [applyLeaderboard]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      void loadLeaderboard();
      try {
        const stored = Number.parseInt(
          localStorage.getItem(BEST_SCORE_KEY) || "0",
          10,
        );
        if (Number.isSafeInteger(stored) && stored >= 0) setLocalBest(stored);
      } catch {
        // Private browsing may make localStorage unavailable; the run still works.
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [loadLeaderboard]);

  const finishRun = useCallback(
    (runScore: number) => {
      const board = leaderboardRef.current;
      const memberBest = board.authenticated ? board.personalBest : 0;
      setNewBest(runScore > Math.max(localBest, memberBest));
      setPhase("dead");
      setScore(runScore);
      setLocalBest((previous) => {
        const next = Math.max(previous, runScore);
        try {
          localStorage.setItem(BEST_SCORE_KEY, String(next));
        } catch {
          // A blocked localStorage write should never stop replay.
        }
        return next;
      });
      setAnnouncement(
        `Over the line. Run over. Score ${runScore}. Press Space to drop again.`,
      );
      queueMemberScoreRef.current(runScore);
    },
    [localBest, setPhase],
  );
  useEffect(() => {
    finishRunRef.current = finishRun;
  }, [finishRun]);

  const createFreshRun = useCallback(
    (startImmediately = false) => {
      const rect = arenaRef.current?.getBoundingClientRect();
      const width = Math.max(320, rect?.width || 800);
      const height = Math.max(260, rect?.height || 500);
      const game = createSuipuffGame(width, height, Date.now() & 0xffff_ffff);
      gameRef.current = game;
      heldKeysRef.current.clear();
      setScore(0);
      setNewBest(false);
      if (startImmediately) {
        startSuipuff(game);
        setPhase("playing");
        setAnnouncement("New run started. Aim and release to drop.");
      } else {
        setPhase("ready");
        setAnnouncement("Press Space, Enter, or the start button to begin.");
      }
    },
    [setPhase],
  );

  const pressStart = useCallback(() => {
    if (phaseRef.current === "paused") return;
    if (phaseRef.current === "dead") {
      createFreshRun(true);
      return;
    }
    const game = gameRef.current;
    if (game && startSuipuff(game)) {
      setPhase("playing");
      setAnnouncement("Run started. Aim, then release or press Space to drop.");
    }
  }, [createFreshRun, setPhase]);

  const drop = useCallback(() => {
    const game = gameRef.current;
    if (!game || phaseRef.current !== "playing") return;
    dropSuipuff(game);
  }, []);

  const aimAtClientX = useCallback((clientX: number) => {
    const game = gameRef.current;
    const canvas = canvasRef.current;
    if (!game || !canvas) return;
    if (phaseRef.current === "paused" || phaseRef.current === "dead") return;
    const rect = canvas.getBoundingClientRect();
    setSuipuffAim(game, clientX - rect.left);
  }, []);

  const exitGame = useCallback(() => {
    // replace() so Back cannot reopen a run the player explicitly exited.
    router.replace(exitHref);
  }, [router, exitHref]);

  useEffect(() => {
    const held = heldKeysRef.current;
    const onKeyDown = (event: KeyboardEvent) => {
      if (AIM_LEFT_KEYS.has(event.code) || AIM_RIGHT_KEYS.has(event.code)) {
        held.add(event.code);
        event.preventDefault();
        return;
      }
      if (event.repeat) return;
      if (DROP_KEYS.has(event.code)) {
        event.preventDefault();
        if (phaseRef.current === "dead") {
          createFreshRun(true);
        } else if (phaseRef.current === "ready") {
          pressStart();
        } else if (phaseRef.current === "playing") {
          drop();
        }
        return;
      }
      if (event.code === "Escape") {
        event.preventDefault();
        if (phaseRef.current === "playing") {
          setPhase("paused");
          setAnnouncement("Game paused.");
        } else if (phaseRef.current === "paused") {
          setPhase("playing");
          setAnnouncement("Game resumed.");
        } else {
          // From ready or dead, Escape always leaves the game.
          exitGame();
        }
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      held.delete(event.code);
    };
    const onBlur = () => held.clear();
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [createFreshRun, drop, exitGame, pressStart, setPhase]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (
        document.visibilityState === "hidden" &&
        phaseRef.current === "playing"
      ) {
        setPhase("paused");
        setAnnouncement("Game paused while this tab was away.");
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [setPhase]);

  // Canvas lifecycle: atlas built once, tray floor re-baked on resize, fixed
  // 1/60 physics steps inside an accumulator, capped render cadence.
  useEffect(() => {
    const arena = arenaRef.current;
    const canvas = canvasRef.current;
    if (!arena || !canvas) return;
    const context = canvas.getContext("2d", {
      alpha: false,
      desynchronized: true,
    });
    if (!context) return;

    const atlas = buildSuipuffAtlas();
    const palette = atlas.palette;
    const reducedMotion = window
      .matchMedia("(prefers-reduced-motion: reduce)")
      .matches;
    const coarsePointer =
      window.matchMedia("(any-pointer: coarse)").matches ||
      navigator.maxTouchPoints > 0;
    let floor: FloorTexture | null = null;
    // Canvas backing, transform, CSS box, and draw dimensions all derive from
    // these two values; they are never clamped beyond the real arena box, so
    // no frame can leave unpainted backing pixels beside the drawn scene.
    let viewWidth = 800;
    let viewHeight = 500;
    let needsRedraw = true;
    let lastDrawnPhase: GamePhase | null = null;
    let renderCadence: PuffRenderCadence;

    const drawBackground = (width: number, height: number) => {
      context.fillStyle = palette.surface;
      context.fillRect(0, 0, width, height);

      context.save();
      context.lineWidth = 1;
      context.strokeStyle = palette.blue;
      context.globalAlpha = 0.055;
      context.beginPath();
      for (let y = 48.5; y < height; y += 48) {
        context.moveTo(0, y);
        context.lineTo(width, y);
      }
      context.stroke();

      context.strokeStyle = palette.red;
      context.globalAlpha = 0.075;
      context.beginPath();
      const marginX = Math.round(Math.min(86, width * 0.12)) + 0.5;
      context.moveTo(marginX, 0);
      context.lineTo(marginX, height);
      context.stroke();
      context.restore();
    };

    const drawTray = (game: SuipuffGameState) => {
      const wallTop = game.deadLineY - 34;
      const wallBottom = game.floorY + 3;

      // Walls sit just outside the physics boundary so bodies touch its face.
      context.fillStyle = palette.ink;
      context.fillRect(game.trayLeft - 4, wallTop, 4, wallBottom - wallTop);
      context.fillRect(game.trayRight, wallTop, 4, wallBottom - wallTop);
      context.fillStyle = palette.red;
      context.fillRect(game.trayLeft - 4, wallTop, 4, 3);
      context.fillRect(game.trayRight, wallTop, 4, 3);

      if (floor) {
        const ratio = floor.pixelRatio;
        context.drawImage(
          floor.canvas,
          0,
          0,
          floor.canvas.width,
          floor.canvas.height,
          game.trayLeft - 4,
          game.floorY,
          floor.canvas.width / ratio,
          floor.canvas.height / ratio,
        );
      }

      // The dead line: dashed red across the tray mouth.
      context.save();
      context.strokeStyle = palette.red;
      context.globalAlpha = 0.85;
      context.lineWidth = 2;
      context.setLineDash([7, 6]);
      context.beginPath();
      context.moveTo(game.trayLeft, game.deadLineY);
      context.lineTo(game.trayRight, game.deadLineY);
      context.stroke();
      context.setLineDash([]);
      context.globalAlpha = 0.9;
      context.beginPath();
      context.moveTo(game.trayLeft - 6, game.deadLineY);
      context.lineTo(game.trayLeft, game.deadLineY);
      context.moveTo(game.trayRight, game.deadLineY);
      context.lineTo(game.trayRight + 6, game.deadLineY);
      context.stroke();
      context.restore();
    };

    const drawBodySprite = (
      sprite: HTMLCanvasElement,
      x: number,
      y: number,
      radius: number,
      squash: number,
      tilt: number,
      alpha = 1,
    ) => {
      const drawWidth = radius * SPRITE_DRAW_PER_RADIUS;
      const drawHeight = drawWidth * (sprite.height / sprite.width);
      context.save();
      context.globalAlpha = alpha;
      context.translate(x, y + radius * 0.12 * squash);
      context.rotate(tilt);
      context.scale(1 + 0.13 * squash, 1 - 0.16 * squash);
      context.drawImage(
        sprite,
        -drawWidth / 2,
        -drawHeight * SPRITE_CENTER_FRAC,
        drawWidth,
        drawHeight,
      );
      context.restore();
    };

    const drawBodies = (game: SuipuffGameState) => {
      // Biggest first so smaller Puffs keep their faces over the pile.
      const sorted = [...game.bodies].sort((a, b) => b.radius - a.radius);
      for (const body of sorted) {
        const sprite = atlas.tiers[body.tier];
        if (!sprite) continue;
        const tilt = Math.max(-0.1, Math.min(0.1, body.vx * 0.0006));
        drawBodySprite(sprite, body.x, body.y, body.radius, body.squash, tilt);
      }
    };

    const drawHeldAndGuide = (game: SuipuffGameState, now: number) => {
      if (
        game.heldTier < 0 ||
        (game.status !== "ready" && game.status !== "playing")
      ) {
        return;
      }
      const sprite = atlas.tiers[game.heldTier];
      if (!sprite) return;
      const radius = suipuffTierRadius(game, game.heldTier);
      const bob = reducedMotion ? 0 : Math.sin(now / 280) * 1.5;
      const heldY = game.dropY + bob;

      // Where would the held piece land? A straight circle-cast down the aim.
      let contactY = game.floorY;
      for (const body of game.bodies) {
        const dx = Math.abs(body.x - game.aimX);
        const reach = body.radius + radius;
        if (dx < reach) {
          const hitY = body.y - Math.sqrt(reach * reach - dx * dx);
          if (hitY < contactY) contactY = hitY;
        }
      }

      if (contactY - (heldY + radius) > 6) {
        context.save();
        context.strokeStyle = palette.ink;
        context.globalAlpha = 0.35;
        context.lineWidth = 2;
        context.lineCap = "round";
        context.setLineDash([0.1, 7]);
        context.beginPath();
        context.moveTo(game.aimX, heldY + radius + 3);
        context.lineTo(game.aimX, contactY - 2);
        context.stroke();
        context.restore();
      }

      drawBodySprite(sprite, game.aimX, heldY, radius, 0, 0, 0.96);
    };

    const drawMergePops = (game: SuipuffGameState) => {
      for (const pop of game.mergePops) {
        const glyph = atlas.popGlyphs[pop.score];
        if (!glyph) continue;
        const progress = 1 - pop.ttl / SUIPUFF_MERGE_POP_SECONDS;
        context.save();
        context.globalAlpha = Math.max(0, Math.min(1, pop.ttl / 0.35));
        context.drawImage(
          glyph,
          pop.x - glyph.width / 2,
          pop.y - 16 - progress * 26,
        );
        context.restore();
      }
    };

    const drawNextPreview = (game: SuipuffGameState) => {
      if (game.nextTier < 0) return;
      const plate = atlas.nextPlate;
      const x = game.width - plate.width - 10;
      const y = 8;
      context.drawImage(plate, x, y);
      const sprite = atlas.tiers[game.nextTier];
      if (!sprite) return;
      const radius = suipuffTierRadius(game, game.nextTier);
      const drawWidth = Math.min(radius * SPRITE_DRAW_PER_RADIUS, 46);
      const drawHeight = drawWidth * (sprite.height / sprite.width);
      context.drawImage(
        sprite,
        x + plate.width / 2 - drawWidth / 2,
        y + 20 + (plate.height - 27) / 2 - drawHeight * SPRITE_CENTER_FRAC,
        drawWidth,
        drawHeight,
      );
    };

    const drawDeadBanner = (game: SuipuffGameState) => {
      if (game.status !== "dead") return;
      const banner = atlas.deadBanner;
      context.drawImage(
        banner,
        game.width / 2 - banner.width / 2,
        game.deadLineY - 54,
      );
    };

    const drawGame = (width: number, height: number, now: number) => {
      drawBackground(width, height);
      const game = gameRef.current;
      if (!game) return;
      drawTray(game);
      drawBodies(game);
      drawMergePops(game);
      drawHeldAndGuide(game, now);
      drawNextPreview(game);
      drawDeadBanner(game);
    };

    const resize = () => {
      const rect = arena.getBoundingClientRect();
      const width = Math.max(320, rect.width);
      const height = Math.max(260, rect.height);
      viewWidth = width;
      viewHeight = height;
      const profile = getPuffRenderProfile({
        devicePixelRatio: window.devicePixelRatio || 1,
        coarsePointer,
      });
      const ratio = profile.pixelRatio;
      renderCadence = profile.cadence;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.imageSmoothingEnabled = false;
      context.fillStyle = palette.surface;
      context.fillRect(0, 0, width, height);
      let liveGame = gameRef.current;
      if (liveGame) {
        resizeSuipuffGame(liveGame, width, height);
      } else {
        liveGame = createSuipuffGame(width, height);
        gameRef.current = liveGame;
      }
      if (!floor || floor.trayWidth !== liveGame.trayWidth || floor.pixelRatio !== ratio) {
        floor = buildFloorTexture(liveGame.trayWidth, ratio, palette) ?? floor;
      }
      needsRedraw = true;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(arena);

    let frameId = 0;
    let previous = performance.now();
    let accumulator = 0;
    let renderAccumulatorMs = 0;
    const frame = (now: number) => {
      const game = gameRef.current;
      const currentPhase = phaseRef.current;
      const elapsedMs = Math.max(0, now - previous);
      const delta = Math.min(MAX_FRAME_DELTA, elapsedMs / 1_000);
      previous = now;

      if (game && currentPhase === "playing") {
        let direction = 0;
        for (const key of heldKeysRef.current) {
          if (AIM_RIGHT_KEYS.has(key)) direction += 1;
          else if (AIM_LEFT_KEYS.has(key)) direction -= 1;
        }
        if (direction !== 0) {
          setSuipuffAim(game, game.aimX + direction * AIM_SPEED * delta);
        }

        accumulator += delta;
        let steps = 0;
        while (accumulator >= FIXED_STEP && steps < MAX_CATCH_UP_STEPS) {
          const events = stepSuipuffGame(game, FIXED_STEP);
          accumulator -= FIXED_STEP;
          steps += 1;
          if (events & SUIPUFF_EVENT.MERGED) {
            setScore(game.score);
            setAnnouncement(`Puffs merged. Score ${game.score}.`);
          }
          if (events & SUIPUFF_EVENT.OVERFLOW) {
            accumulator = 0;
            finishRunRef.current(game.score);
            break;
          }
        }
        if (steps === MAX_CATCH_UP_STEPS) accumulator = 0;
      } else {
        accumulator = 0;
      }

      const phaseChanged = currentPhase !== lastDrawnPhase;
      const renderStep = advancePuffRenderClock({
        accumulatorMs: renderAccumulatorMs,
        elapsedMs,
        cadence: renderCadence,
        phase: currentPhase,
        forceDraw: needsRedraw || phaseChanged,
        canDraw: Boolean(game),
      });
      renderAccumulatorMs = renderStep.accumulatorMs;
      if (game && renderStep.shouldDraw) {
        drawGame(viewWidth, viewHeight, now);
        needsRedraw = false;
        lastDrawnPhase = currentPhase;
      }
      frameId = requestAnimationFrame(frame);
    };
    frameId = requestAnimationFrame(frame);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frameId);
    };
  }, []);

  const memberBest = leaderboard.authenticated ? leaderboard.personalBest : 0;
  const bestScore = Math.max(localBest, memberBest);

  return (
    <main
      className={styles.game}
      data-arcade-shell="fullscreen"
      aria-labelledby="suipuff-game-title"
      aria-describedby="suipuff-game-description"
    >
      <div className={styles.sheet}>
        <header className={styles.header}>
          <div className={styles.titleBlock}>
            <p>Secret transmission // No. 12</p>
            <h1 id="suipuff-game-title">SUIPUFF.EXE</h1>
          </div>
          <div className={styles.stats} aria-label="Current game statistics">
            <p>
              Score{" "}
              <strong
                key={score}
                className={score > 0 ? styles.scorePulse : undefined}
              >
                {String(score).padStart(2, "0")}
              </strong>
            </p>
            <p>
              Best <strong>{String(bestScore).padStart(2, "0")}</strong>
            </p>
            <p className={styles.memberState}>
              {leaderboard.authenticated
                ? leaderboard.status === "saving"
                  ? "Printing score…"
                  : `Member: ${leaderboard.username || "HAM"}`
                : "Local run"}
            </p>
          </div>
        </header>

        <div ref={arenaRef} className={styles.arena}>
          <canvas
            ref={canvasRef}
            className={styles.canvas}
            data-suipuff-canvas="true"
            onPointerDown={(event) => {
              event.preventDefault();
              aimAtClientX(event.clientX);
              try {
                event.currentTarget.setPointerCapture(event.pointerId);
              } catch {
                // Synthetic pointers may not be capturable; aiming still works.
              }
            }}
            onPointerMove={(event) => aimAtClientX(event.clientX)}
            onPointerUp={(event) => {
              aimAtClientX(event.clientX);
              drop();
            }}
            onPointerCancel={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            }}
            aria-label="A merge game. Aim the falling Puff, then release to drop it into the tray; matching Puffs merge into bigger ones."
          />

          {phase === "ready" && (
            <div className={styles.overlay}>
              <div className={styles.startCard}>
                <p className={styles.eyebrow}>GRAVITY FEED TEST</p>
                <h3>Stack the Puffs.</h3>
                <ul className={styles.ruleList}>
                  <li>Drop Puffs into the tray. Matching pairs merge into the next size.</li>
                  <li>Two THE PUFFs pop each other for a +100 jackpot.</li>
                  <li>If the pile rests above the red line, the run is over.</li>
                </ul>
                <button
                  type="button"
                  onClick={pressStart}
                  className={styles.primaryButton}
                >
                  Start dropping <kbd>SPACE</kbd>
                </button>
              </div>
            </div>
          )}

          {phase === "paused" && (
            <div className={styles.overlay}>
              <div className={styles.pauseCard}>
                <p className={styles.eyebrow}>TRAY HELD</p>
                <h3>Paused.</h3>
                <p>The pile is holding its breath.</p>
                <div className={styles.buttonRow}>
                  <button
                    type="button"
                    onClick={() => {
                      setPhase("playing");
                      setAnnouncement("Game resumed.");
                    }}
                    className={styles.primaryButton}
                  >
                    Resume
                  </button>
                  <button
                    type="button"
                    onClick={exitGame}
                    className={styles.secondaryButton}
                  >
                    Exit game
                  </button>
                </div>
              </div>
            </div>
          )}

          {phase === "dead" && (
            <div className={styles.overlay}>
              <div className={styles.resultsCard}>
                <section className={styles.scoreCard}>
                  <p className={styles.eyebrow}>OVER THE LINE</p>
                  <p className={styles.bigScore}>{score}</p>
                  {newBest && (
                    <p className={styles.newBestStamp}>New best</p>
                  )}
                  <p className={styles.scoreLabel}>points piled</p>
                  <p className={styles.bestLine}>
                    Best stack: <strong>{bestScore}</strong>
                  </p>
                  <div className={styles.buttonRow}>
                    <button
                      type="button"
                      onClick={() => createFreshRun(true)}
                      className={styles.primaryButton}
                    >
                      Drop again <kbd>SPACE</kbd>
                    </button>
                    <button
                      type="button"
                      onClick={exitGame}
                      className={styles.secondaryButton}
                    >
                      Back to HAM
                    </button>
                  </div>
                </section>
                <section className={styles.boardCard}>
                  <div className={styles.boardHeading}>
                    <p>MEMBER HIGH SCORES</p>
                    <span>{leaderboard.authenticated ? "LIVE" : "LOCKED"}</span>
                  </div>
                  <Leaderboard state={leaderboard} />
                </section>
              </div>
            </div>
          )}
        </div>

        <footer className={styles.footer}>
          <p>
            Aim: <kbd>←</kbd> <kbd>→</kbd> <kbd>A</kbd> <kbd>D</kbd> or move the
            pointer
            <span aria-hidden="true">{" // "}</span>
            Drop: <kbd>SPACE</kbd> <kbd>ENTER</kbd> or release
            <span aria-hidden="true">{" // "}</span>
            Pause: <kbd>ESC</kbd>
          </p>
          <button
            type="button"
            onClick={exitGame}
            className={styles.exitButton}
          >
            [✕] EXIT TRANSMISSION
          </button>
        </footer>

        <p id="suipuff-game-description" className="sr-only">
          Drop Puffs into the walled tray. Two Puffs of the same size merge
          into the next size and score; two of the largest pop for a jackpot.
          If the pile settles above the red line the run ends. Aim with the
          pointer or arrow keys, drop with Space, Enter, or pointer release.
          Press Escape to pause.
        </p>
        <p className="sr-only" aria-live="polite">
          {announcement}
        </p>
      </div>
    </main>
  );
}
