"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  GAME_EVENT,
  GATE_WIDTH,
  GROUND_HEIGHT,
  createPuffGame,
  flapPuff,
  resizePuffGame,
  stepPuffGame,
  type PuffGameState,
} from "@/lib/puff/game";
import type {
  PuffLeaderboardEntry,
  PuffLeaderboardSnapshot,
} from "@/lib/puff/leaderboard";
import {
  advancePuffRenderClock,
  getPuffRenderProfile,
  type PuffRenderPhase,
} from "@/lib/puff/performance";
import { renderPuff } from "@/lib/puff/render";

import styles from "./flappy-puff-game.module.css";

type GamePhase = PuffRenderPhase;
type SpritePose = "level" | "up" | "down" | "dead";
type LeaderboardState =
  | { status: "loading"; authenticated: false; username: null }
  | { status: "signed-out"; authenticated: false; username: null }
  | { status: "error"; authenticated: false; username: null }
  | ({
      status: "ready" | "saving";
      authenticated: true;
      username: string | null;
    } & PuffLeaderboardSnapshot);

interface Palette {
  paper: string;
  surface: string;
  ink: string;
  muted: string;
  red: string;
  blue: string;
}

interface PuffSpriteAtlas {
  palette: Palette;
  sprites: Record<SpritePose, HTMLCanvasElement>;
}

interface GateTextureAtlas {
  pixelRatio: number;
  arenaHeight: number;
  rowTexture: HTMLCanvasElement;
  capTexture: HTMLCanvasElement;
  capTextHeight: number;
}

const FIXED_STEP = 1 / 60;
const MAX_FRAME_DELTA = 0.1;
const MAX_CATCH_UP_STEPS = 5;
const BEST_SCORE_KEY = "ham:flappy-puff:best:v1";
const FLAP_KEYS = new Set(["Space", "ArrowUp", "KeyW"]);

const GATE_ROW_HEIGHT = 13;
const GATE_ROW_GLYPHS = ["#", "%", "H", ":"] as const;
const GATE_ROW_FONT =
  "700 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const GATE_CAP_FONT =
  "700 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
// The cap band spans gate.x-8..gate.x+GATE_WIDTH+8; the label starts at gate.x-2.
const GATE_CAP_BAND_OFFSET_X = 8;
const GATE_CAP_TEXT_OFFSET_X = 2;

function phaseRowString(phase: number): string {
  let line = "";
  for (let column = 0; column < 8; column += 1) {
    line += GATE_ROW_GLYPHS[Math.abs(phase + column) % GATE_ROW_GLYPHS.length];
  }
  return line;
}

const GATE_ROW_TEXTURE_TEXT = [0, 1, 2, 3].map(phaseRowString);

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

function makePuffSprite(palette: Palette, pose: SpritePose): HTMLCanvasElement {
  const cols = 23;
  const rows = 23;
  const cellWidth = 2.65;
  const cellHeight = 3.35;
  const pitch = pose === "up" ? -0.2 : pose === "down" || pose === "dead" ? 0.2 : 0;
  const frame = renderPuff(
    cols,
    rows,
    cellWidth / cellHeight,
    {
      time: pose === "dead" ? 2.8 : 1.2,
      bob: 0,
      squash: pose === "dead" ? 0.58 : pose === "up" ? -0.18 : 0,
      blink: pose === "dead" ? 0.08 : 1,
      gazeX: 0.045,
      gazeY: pose === "up" ? 0.03 : pose === "down" ? -0.02 : 0,
    },
    { yaw: 0.42, pitch },
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(cols * cellWidth);
  canvas.height = Math.ceil(rows * cellHeight);
  const context = canvas.getContext("2d");
  if (!context) return canvas;

  context.font = "4.5px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
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

function buildPuffSpriteAtlas(): PuffSpriteAtlas {
  const palette = readPalette();
  return {
    palette,
    sprites: {
      level: makePuffSprite(palette, "level"),
      up: makePuffSprite(palette, "up"),
      down: makePuffSprite(palette, "down"),
      dead: makePuffSprite(palette, "dead"),
    },
  };
}

function buildGateTextureAtlas(
  arenaHeight: number,
  pixelRatio: number,
  palette: Palette,
): GateTextureAtlas | null {
  const rowTextureContext = document.createElement("canvas").getContext("2d");
  const capTextureContext = document.createElement("canvas").getContext("2d");
  if (!rowTextureContext || !capTextureContext) return null;

  rowTextureContext.font = GATE_ROW_FONT;
  const rowTextWidth = Math.max(
    ...GATE_ROW_TEXTURE_TEXT.map((text) => rowTextureContext.measureText(text).width),
  );

  const rowTextureRows = GATE_ROW_GLYPHS.length + Math.ceil(arenaHeight / GATE_ROW_HEIGHT);
  const rowTexture = rowTextureContext.canvas;
  rowTexture.width = Math.ceil(rowTextWidth * pixelRatio);
  rowTexture.height = Math.ceil(rowTextureRows * GATE_ROW_HEIGHT * pixelRatio);
  rowTextureContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  rowTextureContext.font = GATE_ROW_FONT;
  rowTextureContext.textBaseline = "top";
  rowTextureContext.fillStyle = palette.ink;
  for (let row = 0; row < rowTextureRows; row += 1) {
    rowTextureContext.fillText(
      GATE_ROW_TEXTURE_TEXT[row % GATE_ROW_GLYPHS.length],
      0,
      row * GATE_ROW_HEIGHT,
    );
  }

  const capTexture = capTextureContext.canvas;
  capTexture.width = Math.ceil((GATE_WIDTH + 16) * pixelRatio);
  capTexture.height = Math.ceil(GATE_ROW_HEIGHT * pixelRatio);
  capTextureContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  capTextureContext.font = GATE_CAP_FONT;
  capTextureContext.textBaseline = "top";
  capTextureContext.fillStyle = palette.surface;
  capTextureContext.fillText(
    "+=====+",
    GATE_CAP_BAND_OFFSET_X - GATE_CAP_TEXT_OFFSET_X,
    0,
  );

  return {
    pixelRatio,
    arenaHeight,
    rowTexture,
    capTexture,
    capTextHeight: GATE_ROW_HEIGHT,
  };
}

function drawBackground(
  context: CanvasRenderingContext2D,
  state: PuffGameState,
  palette: Palette,
) {
  context.fillStyle = palette.surface;
  context.fillRect(0, 0, state.width, state.height);

  const floor = state.height - GROUND_HEIGHT;
  context.save();
  context.lineWidth = 1;
  context.strokeStyle = palette.blue;
  context.globalAlpha = 0.055;
  context.beginPath();
  for (let y = 48.5; y < floor; y += 48) {
    context.moveTo(0, y);
    context.lineTo(state.width, y);
  }
  context.stroke();

  context.strokeStyle = palette.red;
  context.globalAlpha = 0.075;
  context.beginPath();
  const marginX = Math.round(Math.min(86, state.width * 0.12)) + 0.5;
  context.moveTo(marginX, 0);
  context.lineTo(marginX, floor);
  context.stroke();
  context.restore();
}

function drawGateSection(
  context: CanvasRenderingContext2D,
  palette: Palette,
  gates: GateTextureAtlas,
  x: number,
  top: number,
  bottom: number,
  pattern: number,
) {
  if (bottom <= top) return;

  const startPhase = Math.floor(top / GATE_ROW_HEIGHT) + pattern;
  const phase =
    ((startPhase % GATE_ROW_GLYPHS.length) + GATE_ROW_GLYPHS.length) %
    GATE_ROW_GLYPHS.length;
  const sectionHeight =
    Math.ceil((bottom - top) / GATE_ROW_HEIGHT) * GATE_ROW_HEIGHT;
  const ratio = gates.pixelRatio;
  context.drawImage(
    gates.rowTexture,
    0,
    phase * GATE_ROW_HEIGHT * ratio,
    gates.rowTexture.width,
    sectionHeight * ratio,
    x + 5,
    top,
    gates.rowTexture.width / ratio,
    sectionHeight,
  );

  context.strokeStyle = palette.ink;
  context.lineWidth = 2;
  context.strokeRect(x, top, GATE_WIDTH, Math.max(1, bottom - top));
}

function drawGate(
  context: CanvasRenderingContext2D,
  state: PuffGameState,
  palette: Palette,
  gates: GateTextureAtlas,
  gate: PuffGameState["gates"][number],
) {
  const gapTop = gate.gapY - gate.gapHeight / 2;
  const gapBottom = gate.gapY + gate.gapHeight / 2;
  const floor = state.height - GROUND_HEIGHT;
  drawGateSection(context, palette, gates, gate.x, 0, gapTop - 13, gate.pattern);
  drawGateSection(context, palette, gates, gate.x, gapBottom + 13, floor, gate.pattern + 1);

  context.fillStyle = palette.red;
  context.fillRect(gate.x - 8, gapTop - 14, GATE_WIDTH + 16, 14);
  context.fillRect(gate.x - 8, gapBottom, GATE_WIDTH + 16, 14);
  context.drawImage(
    gates.capTexture,
    0,
    0,
    gates.capTexture.width,
    gates.capTexture.height,
    gate.x - GATE_CAP_BAND_OFFSET_X,
    gapTop - GATE_ROW_HEIGHT,
    GATE_WIDTH + 16,
    gates.capTextHeight,
  );
  context.drawImage(
    gates.capTexture,
    0,
    0,
    gates.capTexture.width,
    gates.capTexture.height,
    gate.x - GATE_CAP_BAND_OFFSET_X,
    gapBottom + 1,
    GATE_WIDTH + 16,
    gates.capTextHeight,
  );
}

function drawGround(
  context: CanvasRenderingContext2D,
  state: PuffGameState,
  palette: Palette,
) {
  const top = state.height - GROUND_HEIGHT;
  context.fillStyle = palette.paper;
  context.fillRect(0, top, state.width, GROUND_HEIGHT);
  context.fillStyle = palette.red;
  context.fillRect(0, top, state.width, 5);
  context.fillStyle = palette.ink;
  context.font = "700 13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  context.textBaseline = "top";
  const motif = "__/\\__HAM__";
  const width = context.measureText(motif).width;
  const offset = state.groundOffset % width;
  for (let x = -offset; x < state.width + width; x += width) {
    context.fillText(motif, x, top + 12);
  }
}

function drawBird(
  context: CanvasRenderingContext2D,
  state: PuffGameState,
  atlas: PuffSpriteAtlas,
  time: number,
) {
  const pose: SpritePose =
    state.status === "dead"
      ? "dead"
      : state.bird.velocityY < -80
        ? "up"
        : state.bird.velocityY > 130
          ? "down"
          : "level";
  const sprite = atlas.sprites[pose];
  const idleBob = state.status === "ready" ? Math.sin(time / 230) * 3 : 0;
  context.save();
  context.translate(state.bird.x, state.bird.y + idleBob);
  context.rotate(state.status === "ready" ? 0 : state.bird.angle * 0.42);
  context.drawImage(sprite, -sprite.width / 2, -sprite.height / 2);
  context.restore();

  if (state.status === "dead") {
    context.fillStyle = atlas.palette.red;
    context.font = "800 13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    context.textAlign = "center";
    context.fillText("* BONK *", state.bird.x, state.bird.y - sprite.height / 2 - 17);
    context.textAlign = "start";
  }
}

function drawGame(
  context: CanvasRenderingContext2D,
  state: PuffGameState,
  atlas: PuffSpriteAtlas,
  gates: GateTextureAtlas,
  time: number,
) {
  drawBackground(context, state, atlas.palette);
  for (const gate of state.gates) {
    if (gate.x + GATE_WIDTH + 8 < 0 || gate.x - 8 > state.width) continue;
    drawGate(context, state, atlas.palette, gates, gate);
  }
  drawGround(context, state, atlas.palette);
  drawBird(context, state, atlas, time);
}

function isLeaderboardEntry(value: unknown): value is PuffLeaderboardEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return (
    Number.isInteger(entry.rank) &&
    typeof entry.username === "string" &&
    Number.isInteger(entry.score) &&
    typeof entry.mine === "boolean"
  );
}

function readLeaderboardPayload(value: unknown): LeaderboardState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  if (payload.authenticated === false) {
    return { status: "signed-out", authenticated: false, username: null };
  }
  if (
    payload.authenticated !== true ||
    !(typeof payload.username === "string" || payload.username === null) ||
    !Number.isInteger(payload.personalBest) ||
    !Array.isArray(payload.scores) ||
    !payload.scores.every(isLeaderboardEntry)
  ) {
    return null;
  }
  return {
    status: "ready",
    authenticated: true,
    username: payload.username,
    personalBest: payload.personalBest as number,
    scores: payload.scores,
  };
}

function Leaderboard({ state }: { state: LeaderboardState }) {
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
    return <p className={styles.boardMessage}>The score printer is offline right now.</p>;
  }
  if (state.scores.length === 0) {
    return <p className={styles.boardMessage}>No scores yet. The first print could be yours.</p>;
  }

  return (
    <ol className={styles.leaderboard} aria-label="Flappy Puff member leaderboard">
      {state.scores.slice(0, 7).map((entry) => (
        <li key={`${entry.rank}-${entry.username}`} data-mine={entry.mine || undefined}>
          <span>{String(entry.rank).padStart(2, "0")}</span>
          <strong>{entry.username}</strong>
          <b>{entry.score}</b>
        </li>
      ))}
    </ol>
  );
}

export function FlappyPuffGame({ exitHref }: Readonly<{ exitHref: string }>) {
  const router = useRouter();
  const arenaRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<PuffGameState | null>(null);
  const phaseRef = useRef<GamePhase>("ready");
  const finishRunRef = useRef<(score: number) => void>(() => {});
  const [phase, setPhaseState] = useState<GamePhase>("ready");
  const [score, setScore] = useState(0);
  const [localBest, setLocalBest] = useState(0);
  const [newBest, setNewBest] = useState(false);
  const [announcement, setAnnouncement] = useState("Flappy Puff unlocked.");
  const [leaderboard, setLeaderboard] = useState<LeaderboardState>({
    status: "loading",
    authenticated: false,
    username: null,
  });

  const setPhase = useCallback((next: GamePhase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  const loadLeaderboard = useCallback(async () => {
    try {
      const response = await fetch("/api/puff/leaderboard", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (response.status === 404) {
        setLeaderboard({ status: "signed-out", authenticated: false, username: null });
        return;
      }
      if (!response.ok) throw new Error("leaderboard unavailable");
      const parsed = readLeaderboardPayload(await response.json());
      if (!parsed) throw new Error("invalid leaderboard response");
      setLeaderboard(parsed);
    } catch {
      setLeaderboard({ status: "error", authenticated: false, username: null });
    }
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      void loadLeaderboard();
      try {
        const stored = Number.parseInt(localStorage.getItem(BEST_SCORE_KEY) || "0", 10);
        if (Number.isSafeInteger(stored) && stored >= 0) setLocalBest(stored);
      } catch {
        // Private browsing may make localStorage unavailable; the run still works.
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [loadLeaderboard]);

  const submitMemberScore = useCallback(
    async (runScore: number) => {
      if (!leaderboard.authenticated || runScore <= 0) return;
      setLeaderboard({ ...leaderboard, status: "saving" });
      try {
        const response = await fetch("/api/puff/leaderboard", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ score: runScore }),
        });
        if (!response.ok) throw new Error("score save failed");
        const parsed = readLeaderboardPayload(await response.json());
        if (!parsed || !parsed.authenticated) throw new Error("invalid score response");
        setLeaderboard(parsed);
      } catch {
        setLeaderboard((current) =>
          current.authenticated
            ? { ...current, status: "ready" }
            : { status: "error", authenticated: false, username: null },
        );
        setAnnouncement("Score saved locally. The member board could not be reached.");
      }
    },
    [leaderboard],
  );

  const finishRun = useCallback(
    (runScore: number) => {
      const memberBest = leaderboard.authenticated ? leaderboard.personalBest : 0;
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
      setAnnouncement(`Run over. Score ${runScore}. Press Space to flap again.`);
      void submitMemberScore(runScore);
    },
    [leaderboard, localBest, setPhase, submitMemberScore],
  );
  useEffect(() => {
    finishRunRef.current = finishRun;
  }, [finishRun]);

  const createFreshRun = useCallback(
    (flapImmediately = false) => {
      const rect = arenaRef.current?.getBoundingClientRect();
      const width = Math.max(320, rect?.width || 800);
      const height = Math.max(260, rect?.height || 500);
      const game = createPuffGame(width, height, Date.now() & 0xffff_ffff);
      gameRef.current = game;
      setScore(0);
      setNewBest(false);
      if (flapImmediately) {
        flapPuff(game);
        setPhase("playing");
        setAnnouncement("New run started.");
      } else {
        setPhase("ready");
        setAnnouncement("Press Space, W, Up, click, or tap to flap.");
      }
    },
    [setPhase],
  );

  const flap = useCallback(() => {
    const game = gameRef.current;
    if (!game || phaseRef.current === "paused") return;
    if (phaseRef.current === "dead") {
      createFreshRun(true);
      return;
    }
    if (flapPuff(game)) {
      setPhase("playing");
    }
  }, [createFreshRun, setPhase]);

  const exitGame = useCallback(() => {
    // replace() so Back cannot reopen a run the player explicitly exited.
    router.replace(exitHref);
  }, [router, exitHref]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (FLAP_KEYS.has(event.code)) {
        event.preventDefault();
        flap();
        return;
      }
      if (event.code === "Enter" && (phaseRef.current === "ready" || phaseRef.current === "dead")) {
        event.preventDefault();
        flap();
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
          exitGame();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [exitGame, flap, setPhase]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden" && phaseRef.current === "playing") {
        setPhase("paused");
        setAnnouncement("Game paused while this tab was away.");
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [setPhase]);

  useEffect(() => {
    const arena = arenaRef.current;
    const canvas = canvasRef.current;
    if (!arena || !canvas) return;
    const context = canvas.getContext("2d", {
      alpha: false,
      desynchronized: true,
    });
    if (!context) return;

    const atlas = buildPuffSpriteAtlas();
    let gates: GateTextureAtlas | null = null;
    let needsRedraw = true;
    let lastDrawnPhase: GamePhase | null = null;
    const coarsePointer =
      window.matchMedia("(any-pointer: coarse)").matches ||
      navigator.maxTouchPoints > 0;
    let renderProfile = getPuffRenderProfile({
      devicePixelRatio: window.devicePixelRatio || 1,
      coarsePointer,
    });

    const resize = () => {
      const rect = arena.getBoundingClientRect();
      const width = Math.max(320, rect.width);
      const height = Math.max(260, rect.height);
      renderProfile = getPuffRenderProfile({
        devicePixelRatio: window.devicePixelRatio || 1,
        coarsePointer,
      });
      const ratio = renderProfile.pixelRatio;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.imageSmoothingEnabled = false;
      context.fillStyle = atlas.palette.surface;
      context.fillRect(0, 0, width, height);
      if (!gates || gates.arenaHeight < height || gates.pixelRatio !== ratio) {
        gates = buildGateTextureAtlas(height, ratio, atlas.palette) ?? gates;
      }
      if (gameRef.current) resizePuffGame(gameRef.current, width, height);
      else gameRef.current = createPuffGame(width, height);
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
        accumulator += delta;
        let steps = 0;
        while (accumulator >= FIXED_STEP && steps < MAX_CATCH_UP_STEPS) {
          const events = stepPuffGame(game, FIXED_STEP);
          accumulator -= FIXED_STEP;
          steps += 1;
          if (events & GAME_EVENT.SCORED) {
            setScore(game.score);
            setAnnouncement(`${game.score} toner stacks cleared.`);
          }
          if (events & GAME_EVENT.CRASHED) {
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
        frameIntervalMs: renderProfile.frameIntervalMs,
        phase: currentPhase,
        forceDraw: needsRedraw || phaseChanged,
        canDraw: Boolean(game && gates),
      });
      renderAccumulatorMs = renderStep.accumulatorMs;
      if (game && gates && renderStep.shouldDraw) {
        drawGame(context, game, atlas, gates, now);
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
      aria-labelledby="puff-game-title"
      aria-describedby="puff-game-description"
    >
      <div className={styles.sheet}>
        <header className={styles.header}>
          <div className={styles.titleBlock}>
            <p>Secret transmission // No. 10</p>
            <h1 id="puff-game-title">FLAPPY PUFF.EXE</h1>
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
            <p>Best <strong>{String(bestScore).padStart(2, "0")}</strong></p>
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
            onPointerDown={(event) => {
              event.preventDefault();
              flap();
            }}
            aria-label="An ASCII flying game. Guide Puff through gaps in moving toner stacks."
          />

          {phase === "ready" && (
            <div className={styles.overlay}>
              <div className={styles.startCard}>
                <p className={styles.eyebrow}>ASCII AIRWORTHINESS TEST</p>
                <h3>Thread the toner.</h3>
                <p>Every flap is a decision. Clear a stack for one point. Touch anything and the copier wins.</p>
                <button type="button" onClick={() => flap()} className={styles.primaryButton}>
                  Flap to start <kbd>SPACE</kbd>
                </button>
              </div>
            </div>
          )}

          {phase === "paused" && (
            <div className={styles.overlay}>
              <div className={styles.pauseCard}>
                <p className={styles.eyebrow}>FEED SUSPENDED</p>
                <h3>Paused.</h3>
                <p>Puff is holding altitude through pure administrative magic.</p>
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
                  <button type="button" onClick={exitGame} className={styles.secondaryButton}>
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
                  <p className={styles.eyebrow}>END OF PRINT RUN</p>
                  <p className={styles.bigScore}>{score}</p>
                  {newBest && <p className={styles.newBestStamp}>New best</p>}
                  <p className={styles.scoreLabel}>toner stacks cleared</p>
                  <p className={styles.bestLine}>Best print: <strong>{bestScore}</strong></p>
                  <div className={styles.buttonRow}>
                    <button type="button" onClick={() => createFreshRun(true)} className={styles.primaryButton}>
                      Flap again <kbd>SPACE</kbd>
                    </button>
                    <button type="button" onClick={exitGame} className={styles.secondaryButton}>
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
            Flap: <kbd>SPACE</kbd> <kbd>↑</kbd> <kbd>W</kbd> click / tap
            <span aria-hidden="true">{" // "}</span>
            Pause: <kbd>ESC</kbd>
          </p>
          <button type="button" onClick={exitGame}>[X] EXIT TRANSMISSION</button>
        </footer>

        <p id="puff-game-description" className="sr-only">
          Guide Puff through toner-stack openings. Flap with Space, Up, W,
          click, or tap. Press Escape to pause.
        </p>
        <p className="sr-only" aria-live="polite">{announcement}</p>
      </div>
    </main>
  );
}
