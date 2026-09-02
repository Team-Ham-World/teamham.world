"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  PUFF_SNAKE_EVENT,
  SNAKE_GRID_COLS,
  SNAKE_GRID_ROWS,
  createPuffSnake,
  getPuffSnakeTicksPerSecond,
  startPuffSnake,
  stepPuffSnake,
  turnPuffSnake,
  type PuffSnakeDirection,
  type PuffSnakeObjective,
  type PuffSnakeState,
} from "@/lib/puff/snake";
import {
  advancePuffRenderClock,
  getPuffRenderProfile,
  type PuffRenderCadence,
  type PuffRenderPhase,
} from "@/lib/puff/performance";
import { renderPuff } from "@/lib/puff/render";

import styles from "./puff-print-run-game.module.css";

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

interface BoardLayout {
  x: number;
  y: number;
  cell: number;
  width: number;
  height: number;
}

const BEST_SCORE_KEY = "ham:puff-print-run:best:v1";
const FRAME_MARGIN = 18;
const DISPLAY_SYNCED_RENDER_CADENCE: PuffRenderCadence = { kind: "display" };
const SNAKE_MONO =
  "700 13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const SNAKE_DISPLAY =
  '"Ham Display", "Arial Black", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

const STEER_KEYS: Record<string, PuffSnakeDirection> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  KeyW: "up",
  KeyS: "down",
  KeyA: "left",
  KeyD: "right",
};

const DIRECTION_VECTORS: Record<PuffSnakeDirection, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

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

function cellNoise(col: number, row: number): number {
  let h = (col * 374761393 + row * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Scores arrive in 5-point steps: 10 per letter plus 5 per letter on proof. */
function isValidLeaderboardScore(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 1_000_000 &&
    value % 5 === 0
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
        No scores yet. The first print could be yours.
      </p>
    );
  }

  return (
    <ol
      className={styles.leaderboard}
      aria-label="Puff Print Run member leaderboard"
    >
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

function boardLayout(width: number, height: number): BoardLayout {
  const cell = Math.max(
    8,
    Math.floor(
      Math.min(
        (width - FRAME_MARGIN * 2) / SNAKE_GRID_COLS,
        (height - FRAME_MARGIN * 2) / SNAKE_GRID_ROWS,
      ),
    ),
  );
  const boardWidth = cell * SNAKE_GRID_COLS;
  const boardHeight = cell * SNAKE_GRID_ROWS;
  return {
    x: Math.round((width - boardWidth) / 2),
    y: Math.round((height - boardHeight) / 2),
    cell,
    width: boardWidth,
    height: boardHeight,
  };
}

function makePuffHeadSprite(palette: Palette): HTMLCanvasElement {
  const cols = 21;
  const rows = 21;
  const cellWidth = 2.6;
  const cellHeight = 3.2;
  const frame = renderPuff(
    cols,
    rows,
    cellWidth / cellHeight,
    { time: 1.2, bob: 0, squash: 0, blink: 1, gazeX: 0.05, gazeY: 0 },
    { yaw: 0.42, pitch: 0 },
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(cols * cellWidth);
  canvas.height = Math.ceil(rows * cellHeight);
  const context = canvas.getContext("2d");
  if (!context) return canvas;

  context.font =
    "4.4px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  context.textBaseline = "top";
  context.fillStyle = palette.ink;
  for (const [row, line] of frame.ink.split("\n").entries()) {
    context.fillText(line, 0, row * cellHeight);
  }
  context.fillStyle = palette.red;
  for (const [row, line] of frame.accent.split("\n").entries()) {
    context.fillText(line, 0, row * cellHeight);
  }
  return canvas;
}

export function PuffPrintRunGame({ exitHref }: Readonly<{ exitHref: string }>) {
  const router = useRouter();
  const arenaRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<PuffSnakeState | null>(null);
  const phaseRef = useRef<GamePhase>("ready");
  const finishRunRef = useRef<(score: number) => void>(() => {});
  const proofFlashRef = useRef(0);
  const [phase, setPhaseState] = useState<GamePhase>("ready");
  const [score, setScore] = useState(0);
  const [objective, setObjective] = useState<PuffSnakeObjective>({
    kind: "word",
    word: "INK",
    progress: 0,
    completedWords: 0,
  });
  const [proofSignal, setProofSignal] = useState("");
  const [localBest, setLocalBest] = useState(0);
  const [newBest, setNewBest] = useState(false);
  const [announcement, setAnnouncement] = useState("Puff Print Run ready.");
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
  // that finish while POSTs are busy coalesce to their max (the backend stores
  // one monotonic high score). A queued score waits out an in-flight GET so a
  // 401 cannot strand it, and the initial leaderboard load flushes the queue
  // once auth resolves. Defined as a stable effect closure (assigned to a ref)
  // so it can re-run itself after a POST settles without losing the React
  // Compiler's memoization guarantees.
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
          const response = await fetch("/api/puff/print-run/leaderboard", {
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
      const response = await fetch("/api/puff/print-run/leaderboard", {
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
        `Paper jam. Run over. Score ${runScore}. Press Space to go again.`,
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
      const game = createPuffSnake(Date.now() & 0xffff_ffff);
      gameRef.current = game;
      proofFlashRef.current = 0;
      setScore(0);
      setNewBest(false);
      setObjective(game.objective);
      if (startImmediately) {
        startPuffSnake(game);
        setPhase("playing");
        if (game.objective.kind === "word") {
          setAnnouncement(`Print run started. Spell ${game.objective.word}.`);
        }
      } else {
        setPhase("ready");
        setAnnouncement("Press Space, Enter, tap, or a direction to start.");
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
    if (game && startPuffSnake(game)) {
      setPhase("playing");
      if (game.objective.kind === "word") {
        setAnnouncement(`Print run started. Spell ${game.objective.word}.`);
      }
    }
  }, [createFreshRun, setPhase]);

  // One path for every directional control: a direction pressed from the
  // ready card starts the run and sets that heading on the same turn, so an
  // upward swipe starts the run already moving up. The engine itself rejects
  // an opening reversal (the fresh snake faces right with its body to the
  // left), which keeps this safe without a special case here.
  const steer = useCallback(
    (direction: PuffSnakeDirection) => {
      const game = gameRef.current;
      if (!game || phaseRef.current === "paused" || phaseRef.current === "dead") {
        return;
      }
      if (phaseRef.current === "ready") pressStart();
      turnPuffSnake(game, direction);
    },
    [pressStart],
  );

  const exitGame = useCallback(() => {
    // replace() so Back cannot reopen a run the player explicitly exited.
    router.replace(exitHref);
  }, [router, exitHref]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      const direction = STEER_KEYS[event.code];
      if (direction) {
        event.preventDefault();
        steer(direction);
        return;
      }
      if (
        (event.code === "Space" || event.code === "Enter") &&
        (phaseRef.current === "ready" || phaseRef.current === "dead")
      ) {
        event.preventDefault();
        pressStart();
        return;
      }
      if (event.code === "Escape") {
        event.preventDefault();
        if (phaseRef.current === "playing") {
          setPhase("paused");
          setAnnouncement("Game paused.");
        } else {
          // From ready, paused, or dead, Escape always leaves the game.
          exitGame();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [exitGame, pressStart, setPhase, steer]);

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

  // Swipe steering on the arena canvas.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let startX = 0;
    let startY = 0;
    let tracking = false;
    let swiped = false;

    const onPointerDown = (event: PointerEvent) => {
      startX = event.clientX;
      startY = event.clientY;
      tracking = true;
      swiped = false;
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!tracking || swiped) return;
      const deltaX = event.clientX - startX;
      const deltaY = event.clientY - startY;
      if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < 24) return;
      swiped = true;
      const direction: PuffSnakeDirection =
        Math.abs(deltaX) >= Math.abs(deltaY)
          ? deltaX > 0
            ? "right"
            : "left"
          : deltaY > 0
            ? "down"
            : "up";
      steer(direction);
    };
    const onPointerUp = (event: PointerEvent) => {
      if (!tracking) return;
      tracking = false;
      const moved =
        Math.max(
          Math.abs(event.clientX - startX),
          Math.abs(event.clientY - startY),
        ) >= 24;
      if (!moved && !swiped && phaseRef.current !== "playing") {
        if (phaseRef.current !== "paused") pressStart();
      }
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
    };
  }, [pressStart, steer]);

  // Canvas lifecycle: fixed logical board, letterboxed pixel projection.
  useEffect(() => {
    const arena = arenaRef.current;
    const canvas = canvasRef.current;
    if (!arena || !canvas) return;
    const context = canvas.getContext("2d", {
      alpha: false,
      desynchronized: true,
    });
    if (!context) return;

    const palette = readPalette();
    const headSprite = makePuffHeadSprite(palette);
    const reducedMotion = window
      .matchMedia("(prefers-reduced-motion: reduce)")
      .matches;
    const coarsePointer =
      window.matchMedia("(any-pointer: coarse)").matches ||
      navigator.maxTouchPoints > 0;
    let layout: BoardLayout = boardLayout(800, 500);
    // Canvas backing, transform, CSS box, and draw dimensions all derive from
    // these two values; they are never clamped beyond the real arena box, so
    // no frame can leave unpainted backing pixels beside the drawn scene.
    let viewWidth = 800;
    let viewHeight = 500;
    let needsRedraw = true;
    let lastDrawnPhase: GamePhase | null = null;

    const drawBackground = (width: number, height: number) => {
      // Calm press-room wall: a flat paper-tinted slab inside a thin ink
      // frame, with tiny corner registration ticks as frame hardware.
      context.fillStyle = palette.muted;
      context.globalAlpha = 0.3;
      context.fillRect(0, 0, width, height);
      context.globalAlpha = 1;
      context.fillStyle = palette.paper;
      context.fillRect(6, 6, width - 12, height - 12);

      const bandY = Math.round(height / 2 - 9);
      context.fillStyle = palette.red;
      context.globalAlpha = 0.07;
      context.fillRect(6, bandY, width - 12, 18);
      context.fillStyle = palette.paper;
      context.globalAlpha = 0.35;
      context.fillRect(6, bandY, width - 12, 1);
      context.fillRect(6, bandY + 17, width - 12, 1);
      context.globalAlpha = 1;

      context.strokeStyle = palette.ink;
      context.globalAlpha = 0.35;
      context.lineWidth = 1.5;
      context.beginPath();
      for (const [markX, markY] of [
        [13, 13],
        [width - 13, 13],
        [13, height - 13],
        [width - 13, height - 13],
      ] as const) {
        context.moveTo(markX - 4.5, markY);
        context.lineTo(markX + 4.5, markY);
        context.moveTo(markX, markY - 4.5);
        context.lineTo(markX, markY + 4.5);
      }
      context.stroke();

      context.strokeStyle = palette.ink;
      context.globalAlpha = 0.5;
      context.lineWidth = 2;
      context.strokeRect(7.5, 7.5, width - 15, height - 15);
      context.globalAlpha = 1;
    };

    const drawSheet = () => {
      const { x, y, width, height, cell } = layout;
      // The offset ink "sill" doubles as the sheet's drop shadow.
      context.fillStyle = palette.ink;
      context.fillRect(x + 4, y + 4, width, height);
      context.fillStyle = palette.surface;
      context.fillRect(x, y, width, height);

      // Graphing-notebook stock: one hairline per snake-board cell boundary,
      // both axes, so the paper grid *is* the play grid.
      context.strokeStyle = palette.blue;
      context.globalAlpha = 0.07;
      context.lineWidth = 1;
      context.beginPath();
      for (let lineY = y + cell + 0.5; lineY < y + height; lineY += cell) {
        context.moveTo(x, lineY);
        context.lineTo(x + width, lineY);
      }
      for (let lineX = x + cell + 0.5; lineX < x + width; lineX += cell) {
        context.moveTo(lineX, y);
        context.lineTo(lineX, y + height);
      }
      context.stroke();
      context.globalAlpha = 1;

      // Sheet outline.
      context.strokeStyle = palette.ink;
      context.lineWidth = 2;
      context.strokeRect(x, y, width, height);
    };

    const drawBodySegment = (
      x: number,
      y: number,
      index: number,
      isTail: boolean,
    ) => {
      const { cell, x: bx, y: by } = layout;
      const left = bx + x * cell + 1;
      const top = by + y * cell + 1;
      const size = cell - 2;
      const noise = cellNoise(x, y);
      const tilt = (noise - 0.5) * 0.09;

      context.save();
      context.translate(left + size / 2, top + size / 2);
      context.rotate(tilt);
      // Each segment is an inked stamp; the offset ink offset sells letterpress.
      const strength = Math.max(0.5, 1 - index * 0.03);
      context.globalAlpha = strength * 0.9;
      context.fillStyle = palette.ink;
      context.fillRect(-size / 2 + 1, -size / 2 + 1, size, size);
      context.globalAlpha = strength;
      context.fillStyle = palette.paper;
      context.fillRect(-size / 2, -size / 2, size, size);
      context.strokeStyle = palette.ink;
      context.lineWidth = 1.6;
      context.strokeRect(-size / 2, -size / 2, size, size);
      // Perforation dashes across the segment, like the fold line of fanfold.
      context.globalAlpha = strength * 0.5;
      context.lineWidth = 1;
      context.setLineDash([3, 3]);
      context.beginPath();
      context.moveTo(-size / 2 + 2.5, 0);
      context.lineTo(size / 2 - 2.5, 0);
      context.stroke();
      context.setLineDash([]);
      if (isTail) {
        // The loose end of the trail is torn red rather than inked.
        context.globalAlpha = 0.9;
        context.strokeStyle = palette.red;
        context.lineWidth = 1.6;
        context.beginPath();
        context.moveTo(-size / 2 + 3.5, -size / 2 + 3.5);
        context.lineTo(size / 2 - 3.5, size / 2 - 3.5);
        context.moveTo(size / 2 - 3.5, -size / 2 + 3.5);
        context.lineTo(-size / 2 + 3.5, size / 2 - 3.5);
        context.stroke();
      }
      context.restore();
      context.globalAlpha = 1;
    };

    const drawPickup = (nowSeconds: number) => {
      const game = gameRef.current;
      if (!game || game.status === "dead" || !game.pickup.letter) return;
      const { cell, x: bx, y: by } = layout;
      const { x, y, letter } = game.pickup;
      const jitter = reducedMotion ? 0 : Math.sin(nowSeconds * 4) * 1.2;
      const left = bx + x * cell - 1;
      const top = by + y * cell - 1 + jitter;
      const size = cell + 2;

      // Target corner brackets in red, then the proof chip itself.
      context.strokeStyle = palette.red;
      context.globalAlpha = 0.55;
      context.lineWidth = 1.25;
      context.beginPath();
      const tick = Math.max(3, cell * 0.24);
      for (const [cornerX, cornerY, dirX, dirY] of [
        [left - 3, top - 3, 1, 1],
        [left + size + 3, top - 3, -1, 1],
        [left - 3, top + size + 3, 1, -1],
        [left + size + 3, top + size + 3, -1, -1],
      ] as const) {
        context.moveTo(cornerX + tick * dirX, cornerY);
        context.lineTo(cornerX, cornerY);
        context.lineTo(cornerX, cornerY + tick * dirY);
      }
      context.stroke();
      context.globalAlpha = 1;

      // Misregistration ghost first, then the chip itself.
      context.fillStyle = palette.red;
      context.globalAlpha = 0.3;
      context.fillRect(left + 2, top + 2, size, size);
      context.globalAlpha = 1;
      context.fillStyle = palette.surface;
      context.fillRect(left, top, size, size);
      context.strokeStyle = palette.ink;
      context.lineWidth = 2;
      context.strokeRect(left, top, size, size);
      context.fillStyle = palette.red;
      context.font = `800 ${Math.max(12, Math.floor(cell * 0.6))}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(letter, left + size / 2, top + size / 2 + 1);
      context.textAlign = "start";
      context.textBaseline = "alphabetic";
    };

    const drawHead = () => {
      const game = gameRef.current;
      if (!game || game.snake.length === 0) return;
      const { cell, x: bx, y: by } = layout;
      const head = game.snake[0];
      const neck = game.snake[1];
      // Face away from the neck when we can — after a jam the engine's
      // direction field may lag the sprite's actual heading.
      const facing: PuffSnakeDirection = neck
        ? head.x > neck.x
          ? "right"
          : head.x < neck.x
            ? "left"
            : head.y > neck.y
              ? "down"
              : "up"
        : game.direction;
      const { dx, dy } = DIRECTION_VECTORS[facing];
      const angle =
        dx === 1 ? 0 : dx === -1 ? Math.PI : dy === 1 ? Math.PI / 2 : -Math.PI / 2;
      const size = cell + 5;
      const idleBob =
        game.status === "ready" && !reducedMotion
          ? Math.sin(performance.now() / 300) * 1.5
          : 0;

      context.save();
      context.translate(bx + (head.x + 0.5) * cell, by + (head.y + 0.5) * cell + idleBob);
      context.rotate(angle);
      context.drawImage(headSprite, -size / 2, -size / 2, size, size);
      context.restore();

      if (game.status === "ready") {
        const headX = bx + (head.x + 0.5) * cell;
        const headY = by + (head.y + 0.5) * cell + idleBob;
        const arrowX = headX + dx * (cell * 0.95 + 5);
        const arrowY = headY + dy * (cell * 0.95 + 5);
        context.save();
        context.translate(arrowX, arrowY);
        context.rotate(angle);
        context.fillStyle = palette.red;
        context.globalAlpha = 0.9;
        context.beginPath();
        context.moveTo(4.5, 0);
        context.lineTo(-2.75, -3.75);
        context.lineTo(-2.75, 3.75);
        context.closePath();
        context.fill();
        context.restore();
        context.globalAlpha = 1;
      }

      if (game.status === "dead") {
        context.fillStyle = palette.red;
        context.font = `900 14px ${SNAKE_DISPLAY}`;
        context.textAlign = "center";
        context.textBaseline = "alphabetic";
        context.fillText(
          "* PAPER JAM *",
          bx + (head.x + 0.5) * cell,
          by + head.y * cell - 8,
        );
        context.textAlign = "start";
      }
    };

    const drawReadyCue = () => {
      const game = gameRef.current;
      if (!game || game.status !== "ready" || phaseRef.current === "paused")
        return;
      const { x, y, cell } = layout;
      const head = game.snake[0];
      if (!head) return;
      const lineY = y + (head.y + 0.5) * cell;
      const fromX = x + cell * 1.5;
      const toX = x + (head.x - 1) * cell;
      const pulse = reducedMotion ? 1 : 0.72 + 0.28 * Math.sin(performance.now() / 260);

      // A dashed feed path leading into the print head.
      if (toX > fromX + 4) {
        context.save();
        context.strokeStyle = palette.ink;
        context.globalAlpha = 0.22;
        context.lineWidth = 1;
        context.setLineDash([3, 4]);
        context.beginPath();
        context.moveTo(fromX, lineY);
        context.lineTo(toX, lineY);
        context.stroke();
        context.restore();
        context.globalAlpha = 1;
      }

      // Static cue so a frozen first frame still reads "the run starts here".
      context.font = SNAKE_MONO;
      context.textAlign = "right";
      context.textBaseline = "middle";
      context.fillStyle = palette.muted;
      context.globalAlpha = 0.85;
      context.fillText("FEED STARTS HERE", toX - 5, lineY);
      context.fillStyle = palette.red;
      context.globalAlpha = pulse;
      context.fillText(">", toX + 7, lineY);
      context.textAlign = "start";
      context.textBaseline = "alphabetic";
      context.globalAlpha = 1;
    };

    const drawProofFlash = (now: number) => {
      const flashStarted = proofFlashRef.current;
      if (!flashStarted) return;
      const progress = (now - flashStarted) / 280;
      if (progress >= 1) {
        proofFlashRef.current = 0;
        return;
      }
      const { x, y, width } = layout;
      if (reducedMotion) {
        proofFlashRef.current = 0;
        return;
      }
      // A red squeegee bar sweeps the sheet as the proof is pulled.
      const sweepX = x + width * (1 - progress) - 8;
      context.fillStyle = palette.red;
      context.globalAlpha = 0.55;
      context.fillRect(sweepX, y + 2, 8, layout.height - 4);
      context.globalAlpha = 1;
    };

    const drawGame = (width: number, height: number, now: number) => {
      drawBackground(width, height);
      drawSheet();
      const game = gameRef.current;
      if (game) {
        for (let index = game.snake.length - 1; index >= 1; index -= 1) {
          const segment = game.snake[index];
          drawBodySegment(segment.x, segment.y, index, index === game.snake.length - 1);
        }
        drawPickup(now / 1000);
        drawHead();
        drawReadyCue();
      }
      drawProofFlash(now);
    };

    const resize = () => {
      const rect = arena.getBoundingClientRect();
      viewWidth = Math.max(1, rect.width);
      viewHeight = Math.max(1, rect.height);
      const profile = getPuffRenderProfile({
        devicePixelRatio: window.devicePixelRatio || 1,
        coarsePointer,
      });
      const ratio = profile.pixelRatio;
      canvas.width = Math.max(1, Math.round(viewWidth * ratio));
      canvas.height = Math.max(1, Math.round(viewHeight * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.imageSmoothingEnabled = false;
      layout = boardLayout(viewWidth, viewHeight);
      if (!gameRef.current) {
        const fresh = createPuffSnake();
        gameRef.current = fresh;
        setObjective(fresh.objective);
      }
      needsRedraw = true;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(arena);

    let frameId = 0;
    let previous = performance.now();
    let renderAccumulatorMs = 0;
    const frame = (now: number) => {
      const game = gameRef.current;
      const currentPhase = phaseRef.current;
      const elapsedMs = Math.max(0, now - previous);
      const delta = elapsedMs / 1_000;
      previous = now;

      if (game && currentPhase === "playing") {
        const collectedLetter = game.pickup.letter;
        const events = stepPuffSnake(game, delta);
        if (events & PUFF_SNAKE_EVENT.ATE) {
          setScore(game.score);
          setObjective(game.objective);
          if (!(events & PUFF_SNAKE_EVENT.PROOF)) {
            setAnnouncement(
              game.objective.kind === "endless"
                ? `${collectedLetter} collected. Puff grew longer.`
                : `${collectedLetter} collected.`,
            );
          }
        }
        if (events & PUFF_SNAKE_EVENT.PROOF) {
          const signal =
            game.objective.kind === "endless"
              ? "ENDLESS"
              : game.objective.word;
          setProofSignal(signal);
          proofFlashRef.current = now;
          setAnnouncement(
            game.objective.kind === "endless"
              ? "Maximum press speed reached. Endless feed started."
              : `Proof pulled. Next word is ${game.objective.word}.`,
          );
        }
        if (events & PUFF_SNAKE_EVENT.CRASHED) {
          finishRunRef.current(game.score);
        }
      }

      const phaseChanged = currentPhase !== lastDrawnPhase;
      const renderStep = advancePuffRenderClock({
        accumulatorMs: renderAccumulatorMs,
        elapsedMs,
        cadence: DISPLAY_SYNCED_RENDER_CADENCE,
        phase: currentPhase,
        forceDraw: needsRedraw || phaseChanged || proofFlashRef.current > 0,
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
  const objectiveText =
    objective.kind === "endless" ? "ENDLESS" : objective.word;
  const objectiveProgress =
    objective.kind === "endless" ? objectiveText.length : objective.progress;
  const objectiveLabel =
    objective.kind === "endless"
      ? "Endless feed mode"
      : `Word to spell: ${objective.word}`;
  const ticksPerSecond = getPuffSnakeTicksPerSecond(objective).toFixed(1);
  const wordKey = `${objectiveText}-${proofSignal}`;
  const scoreMilestone = Math.floor(score / 5);

  return (
    <main
      className={styles.game}
      data-arcade-shell="fullscreen"
      aria-labelledby="puff-print-run-title"
      aria-describedby="puff-print-run-description"
    >
      <div className={styles.sheet}>
        <header className={styles.header}>
          <div className={styles.titleBlock}>
            <p>Secret transmission // No. 11</p>
            <h1 id="puff-print-run-title">PUFF PRINT RUN.EXE</h1>
          </div>
          <div className={styles.stats} aria-label="Current game statistics">
            <p className={styles.statBlock}>
              Score{" "}
              <strong key={scoreMilestone}>
                {String(score).padStart(2, "0")}
              </strong>
            </p>
            <p className={styles.statBlock}>
              Best <strong>{String(bestScore).padStart(2, "0")}</strong>
            </p>
            <p className={styles.statBlock}>
              Speed <strong>{ticksPerSecond}</strong> TPS
            </p>
            <div className={styles.wordStrip} aria-label={objectiveLabel}>
              <span className="sr-only">
                {objective.kind === "endless" ? "Mode: " : "Word: "}
              </span>
              {objectiveText.split("").map((letter, index) => (
                <span
                  key={`${wordKey}-${index}`}
                  data-collected={index < objectiveProgress || undefined}
                  className={styles.wordLetter}
                >
                  {letter}
                </span>
              ))}
            </div>
            <p className={styles.memberState} data-saving={leaderboard.status === "saving" || undefined}>
              {leaderboard.authenticated
                ? leaderboard.status === "saving"
                  ? "Printing score…"
                  : `Member: ${leaderboard.username || "HAM"}`
                : "Local run"}
            </p>
          </div>
        </header>

        <div className={styles.stage}>
          <div ref={arenaRef} className={styles.arena}>
            <canvas
              ref={canvasRef}
              className={styles.canvas}
              data-puff-print-run-canvas="true"
              aria-label="A paper grid game. Steer Puff to collect letters; your trail is a wall."
            />

            {phase === "ready" && (
              <div className={styles.overlay}>
                <div className={styles.startCard}>
                  <p className={styles.eyebrow}>CONTINUOUS-FORM CHECK</p>
                  <h3>Keep the feed moving.</h3>
                  <ul className={styles.ruleList}>
                    <li>Collect each letter in order to print the word.</li>
                    <li>Finished words speed up the press and trim your trail.</li>
                    <li>
                      At top speed, Endless Feed begins: random letters make
                      Puff longer.
                    </li>
                  </ul>
                  <p className={styles.ruleCaution}>
                    Hit the edge or your own paper and it is a paper jam.
                  </p>
                  <button
                    type="button"
                    onClick={pressStart}
                    className={styles.primaryButton}
                  >
                    Start the run <kbd>SPACE</kbd>
                  </button>
                </div>
              </div>
            )}

            {phase === "paused" && (
              <div className={styles.overlay}>
                <div className={styles.pauseCard}>
                  <p className={styles.eyebrow}>PRESS HELD</p>
                  <h3>Paused.</h3>
                  <p>Puff is holding the sheet steady.</p>
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
                    <p className={styles.eyebrow}>PAPER JAM</p>
                    <p className={styles.bigScore}>{score}</p>
                    {newBest && (
                      <p className={styles.newBestStamp}>New best</p>
                    )}
                    <p className={styles.scoreLabel}>points pressed</p>
                    <p className={styles.tearLine} aria-hidden="true" />
                    <p className={styles.bestLine}>
                      Best print: <strong>{bestScore}</strong>
                    </p>
                    <div className={styles.buttonRow}>
                      <button
                        type="button"
                        onClick={() => createFreshRun(true)}
                        className={styles.primaryButton}
                      >
                        Run it again <kbd>SPACE</kbd>
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
                      <span>
                        {leaderboard.authenticated ? "LIVE" : "LOCKED"}
                      </span>
                    </div>
                    <Leaderboard state={leaderboard} />
                  </section>
                </div>
              </div>
            )}
          </div>

          <div
            className={styles.controls}
            data-puff-print-run-controls="true"
            role="group"
            aria-label="Direction controls"
            data-active={phase === "playing" || phase === "ready" || undefined}
          >
            <div className={styles.controlGrid}>
              <button
                type="button"
                onClick={() => steer("left")}
                className={styles.directionButton}
                style={{ gridArea: "left" }}
                aria-label="Steer left"
              >
                <span aria-hidden="true">&#8592;</span>
              </button>
              <button
                type="button"
                onClick={() => steer("up")}
                className={styles.directionButton}
                style={{ gridArea: "up" }}
                aria-label="Steer up"
              >
                <span aria-hidden="true">&#8593;</span>
              </button>
              <button
                type="button"
                onClick={() => steer("right")}
                className={styles.directionButton}
                style={{ gridArea: "right" }}
                aria-label="Steer right"
              >
                <span aria-hidden="true">&#8594;</span>
              </button>
              <button
                type="button"
                onClick={() => steer("down")}
                className={styles.directionButton}
                style={{ gridArea: "down" }}
                aria-label="Steer down"
              >
                <span aria-hidden="true">&#8595;</span>
              </button>
            </div>
          </div>
        </div>

        <footer className={styles.footer}>
          <p>
            Steer: <kbd>↑</kbd> <kbd>↓</kbd> <kbd>←</kbd> <kbd>→</kbd>{" "}
            <kbd>WASD</kbd> or swipe
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

        <p id="puff-print-run-description" className="sr-only">
          Steer Puff around the paper sheet. Collect each letter in order to
          spell the word. Finishing a word speeds up the press and shortens your
          trail. At maximum speed, collect random letters in endless mode and
          keep growing. Press Escape to pause.
        </p>
        <p className="sr-only" aria-live="polite">
          {announcement}
        </p>
      </div>
    </main>
  );
}
