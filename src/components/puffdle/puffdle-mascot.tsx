"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { PuffdleGameState, PuffdleStats } from "@/lib/puffdle/game";
import { renderPuff } from "@/lib/puff/render";

import styles from "./puffdle-game.module.css";

interface PuffdleMascotProps {
  gameState: PuffdleGameState;
  stats: PuffdleStats;
  isShaking: boolean;
  onPoke?: () => void;
}

interface Particle {
  id: number;
  char: string;
  x: number; // px relative to stage center
  y: number; // px relative to stage center
  vx: number; // px / sec
  vy: number; // px / sec
  rot: number; // degrees
  vrot: number; // degrees / sec
  scale: number;
  color: "ink" | "red" | "muted" | "blue";
  alpha: number;
  life: number; // seconds
  maxLife: number;
}

interface Shockwave {
  id: number;
  radius: number; // px
  maxRadius: number;
  alpha: number;
  life: number;
  maxLife: number;
}

const COLS = 36;
const ROWS = 26;
const CELL_ASPECT = 0.6 / 0.74;
const BLINK_PERIOD = 4.4;
const BLINK_SHUT = 0.14;

const EXPLOSION_GLYPHS = [
  "*", "#", "%", "@", "+", "!", "BOOM", "POOF", "KABOOM", "TONER", "HAM", "x_x", ":::", "~~~",
];

const CONFETTI_GLYPHS = [
  "★", "✧", "✦", "*", "^o^", "100", "WIN", "+", "♪", "HAM", "!",
];

function blinkAt(time: number): number {
  const phase = time % BLINK_PERIOD;
  if (phase > BLINK_PERIOD - 0.12) return BLINK_SHUT;
  if (phase > BLINK_PERIOD - 0.2) return 0.5;
  return 1;
}

export function PuffdleMascot({
  gameState,
  stats,
  isShaking,
  onPoke,
}: PuffdleMascotProps) {
  const inkRef = useRef<HTMLPreElement>(null);
  const accentRef = useRef<HTMLPreElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const particleCanvasRef = useRef<HTMLCanvasElement>(null);

  // Mascot dynamic physics & reaction state
  const squashRef = useRef(0);
  const shakeTimeRef = useRef(0);
  const [mascotStatus, setMascotStatus] = useState<"idle" | "evaluating" | "shake" | "won" | "exploding" | "dead">("idle");
  const [speechText, setSpeechText] = useState("Monitoring transmission frequency. 5 letters needed.");
  const [pokeCount, setPokeCount] = useState(0);

  const initialFrame = useMemo(() => {
    return renderPuff(
      COLS,
      ROWS,
      CELL_ASPECT,
      { time: 1.2, bob: 0, squash: 0, blink: 1, gazeX: -0.04, gazeY: 0.02 },
      { yaw: -0.22, pitch: 0.04 },
    );
  }, []);

  const mascotStatusRef = useRef(mascotStatus);
  useEffect(() => {
    mascotStatusRef.current = mascotStatus;
  }, [mascotStatus]);

  const gameStateRef = useRef(gameState);
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  // Explosion and confetti particles
  const particlesRef = useRef<Particle[]>([]);
  const shockwavesRef = useRef<Shockwave[]>([]);
  const explosionTriggeredRef = useRef(false);
  const lastGuessCountRef = useRef(gameState.guesses.length);
  const lastCurrentGuessRef = useRef(gameState.currentGuess);

  // Dialogue selection based on game state & events
  useEffect(() => {
    let timer: NodeJS.Timeout | undefined;
    const frame = requestAnimationFrame(() => {
      if (gameState.status === "WON") {
        setSpeechText(`TRANSMISSION DECODED in ${gameState.guesses.length} attempts! Outstanding work!`);
        setMascotStatus("won");
        return;
      }

      if (gameState.status === "LOST") {
        setSpeechText(`CRITICAL TONER OVERLOAD! The word was ${gameState.targetWord}! PUFF EXPLODED!`);
        return;
      }

      if (isShaking) {
        setSpeechText("Bzzzt! Invalid transmission. Check length or dictionary!");
        setMascotStatus("shake");
        shakeTimeRef.current = 0.5; // trigger head-shake for 500ms
        return;
      }

      // When a guess was just submitted
      if (gameState.guesses.length > lastGuessCountRef.current) {
        const lastEval = gameState.evaluations[gameState.guesses.length - 1] || [];
        const greens = lastEval.filter((e) => e === "correct").length;
        const yellows = lastEval.filter((e) => e === "present").length;

        squashRef.current = 0.45; // perky bounce

        if (greens >= 3) {
          setSpeechText(`Direct hit! ${greens} characters in exact position!`);
        } else if (greens > 0 || yellows > 0) {
          setSpeechText(`Signal resonance: ${greens} exact, ${yellows} misplaced letters.`);
        } else {
          setSpeechText("Zero letter match on that probe. Eliminate those keys!");
        }

        setMascotStatus("evaluating");
        timer = setTimeout(() => setMascotStatus("idle"), 1200);
        return;
      }

      // Typing reaction
      if (gameState.currentGuess !== lastCurrentGuessRef.current) {
        if (gameState.currentGuess.length > (lastCurrentGuessRef.current?.length || 0)) {
          squashRef.current = -0.15; // stretch perkily on letter entered
        }
        if (gameState.currentGuess.length === 5) {
          setSpeechText("5 letters entered. Press [ENTER] to decode!");
        } else if (gameState.currentGuess.length === 0) {
          const remaining = 6 - gameState.guesses.length;
          if (remaining <= 2) {
            setSpeechText(`Down to ${remaining} attempt${remaining === 1 ? "" : "s"}! Focus, agent!`);
          } else {
            setSpeechText("Waiting for 5-letter frequency probe...");
          }
        }
      }

      lastGuessCountRef.current = gameState.guesses.length;
      lastCurrentGuessRef.current = gameState.currentGuess;
    });

    return () => {
      cancelAnimationFrame(frame);
      if (timer) clearTimeout(timer);
    };
  }, [gameState.status, gameState.guesses, gameState.evaluations, gameState.currentGuess, gameState.targetWord, isShaking]);

  // Handle Poke
  const handlePoke = useCallback(() => {
    squashRef.current = Math.min(0.9, squashRef.current + 0.5);
    setPokeCount((c) => c + 1);

    const remarks = [
      "*Squeak!* Puff is focused!",
      "Boing! Mind the fur!",
      "Puff nods approvingly.",
      "Transmission assist online.",
      "*Puff purrs mechanically*",
    ];
    setSpeechText(remarks[Math.floor(Math.random() * remarks.length)]);
    if (onPoke) onPoke();
  }, [onPoke]);

  // Trigger dramatic explosion when LOST
  useEffect(() => {
    if (gameState.status === "LOST" && !explosionTriggeredRef.current) {
      explosionTriggeredRef.current = true;
      setMascotStatus("exploding");

      // Generate 48 debris particles
      const newParticles: Particle[] = [];
      for (let i = 0; i < 48; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 120 + Math.random() * 280;
        const char = EXPLOSION_GLYPHS[Math.floor(Math.random() * EXPLOSION_GLYPHS.length)];
        const colors: Array<"ink" | "red" | "muted" | "blue"> = ["ink", "red", "red", "muted", "ink"];
        newParticles.push({
          id: i,
          char,
          x: 0,
          y: 0,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 60, // slight upward bias
          rot: Math.random() * 360,
          vrot: (Math.random() - 0.5) * 400,
          scale: 0.8 + Math.random() * 0.9,
          color: colors[Math.floor(Math.random() * colors.length)],
          alpha: 1,
          life: 0,
          maxLife: 1.6 + Math.random() * 1.0,
        });
      }
      particlesRef.current = newParticles;

      // Generate expanding shockwaves
      shockwavesRef.current = [
        { id: 1, radius: 10, maxRadius: 160, alpha: 1, life: 0, maxLife: 0.9 },
        { id: 2, radius: 5, maxRadius: 130, alpha: 0.8, life: 0, maxLife: 0.7 },
      ];

      const deadTimer = setTimeout(() => {
        setMascotStatus("dead");
      }, 700);

      return () => clearTimeout(deadTimer);
    }

    if (gameState.status !== "LOST") {
      explosionTriggeredRef.current = false;
      particlesRef.current = [];
      shockwavesRef.current = [];
    }
  }, [gameState.status]);

  // Main ASCII Mascot & Particle Animation Loop (Runs continuously on mount)
  useEffect(() => {
    (window as unknown as { __puff_mounted?: boolean }).__puff_mounted = true;
    const ink = inkRef.current;
    const accent = accentRef.current;
    const canvas = particleCanvasRef.current;
    if (!ink || !accent) return;

    let frameId = 0;
    let lastTime = performance.now();
    const started = performance.now();

    const render = (now: number) => {
      const deltaSec = Math.min(0.1, (now - lastTime) / 1000);
      lastTime = now;
      const time = (now - started) / 1000;

      // Decay squash physics
      squashRef.current *= Math.exp(-6 * deltaSec);
      if (shakeTimeRef.current > 0) {
        shakeTimeRef.current = Math.max(0, shakeTimeRef.current - deltaSec);
      }

      const currentStatus = mascotStatusRef.current;
      const currentGameStatus = gameStateRef.current.status;
      const isWon = currentGameStatus === "WON";
      const isLost = currentGameStatus === "LOST";
      const isExploding = currentStatus === "exploding";

      // Camera / view pose calculations
      let yaw = -0.22; // default slight turn toward board on left
      let pitch = 0.04;
      let bob = Math.sin(time * 2.2) * 0.04;
      let blink = blinkAt(time);
      const gazeX = -0.04;
      let gazeY = 0.02;
      let activeSquash = squashRef.current;

      if (shakeTimeRef.current > 0) {
        // Left-right wobble
        yaw += Math.sin(time * 30) * 0.35;
        pitch += Math.cos(time * 25) * 0.1;
        activeSquash = Math.max(0.3, activeSquash);
      } else if (isWon) {
        // Cheerful spin and celebration jumps
        bob = Math.sin(time * 5.0) * 0.12;
        yaw = Math.sin(time * 3.0) * 0.55;
        pitch = Math.cos(time * 4.0) * 0.12 - 0.08;
        blink = 1.0;
        gazeY = 0.05;
        activeSquash = Math.sin(time * 8.0) * 0.2;
      } else if (isLost || currentStatus === "dead") {
        // Dazed / bonked / dead pose
        bob = -0.06;
        yaw = -0.15;
        pitch = 0.22; // head hung low
        blink = 0.08; // X_X slit eyes
        activeSquash = 0.55; // squashed flat
      } else {
        // Gentle breathing & head sway
        yaw += Math.sin(time * 0.8) * 0.06;
        pitch += Math.sin(time * 1.2) * 0.04;
      }

      // Render sphere-traced ASCII mascot
      if (!isExploding) {
        const frame = renderPuff(
          COLS,
          ROWS,
          CELL_ASPECT,
          {
            time,
            bob,
            squash: activeSquash,
            blink,
            gazeX,
            gazeY,
          },
          { yaw, pitch },
        );

        ink.textContent = frame.ink;
        accent.textContent = frame.accent;
      } else {
        // Hide mascot during full blast peak
        ink.textContent = "";
        accent.textContent = "";
      }

      // Canvas Particle & Shockwave rendering (Explosion & Confetti)
      if (canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          const width = canvas.width;
          const height = canvas.height;
          ctx.clearRect(0, 0, width, height);

          const centerX = width / 2;
          const centerY = height / 2;

          // Render Victory Confetti
          if (isWon) {
            if (Math.random() < 0.18 && particlesRef.current.length < 35) {
              const char = CONFETTI_GLYPHS[Math.floor(Math.random() * CONFETTI_GLYPHS.length)];
              particlesRef.current.push({
                id: Math.random(),
                char,
                x: (Math.random() - 0.5) * width * 0.9,
                y: -centerY - 20,
                vx: (Math.random() - 0.5) * 40,
                vy: 60 + Math.random() * 90,
                rot: Math.random() * 360,
                vrot: (Math.random() - 0.5) * 180,
                scale: 0.9 + Math.random() * 0.5,
                color: Math.random() > 0.4 ? "red" : "ink",
                alpha: 1,
                life: 0,
                maxLife: 3.5,
              });
            }
          }

          // Update & Draw Shockwaves
          for (let i = shockwavesRef.current.length - 1; i >= 0; i--) {
            const sw = shockwavesRef.current[i];
            sw.life += deltaSec;
            const progress = sw.life / sw.maxLife;
            if (progress >= 1) {
              shockwavesRef.current.splice(i, 1);
              continue;
            }
            const currentR = sw.radius + (sw.maxRadius - sw.radius) * progress;
            const currentAlpha = (1 - progress) * sw.alpha;

            ctx.save();
            ctx.strokeStyle = "#d93625";
            ctx.lineWidth = 3;
            ctx.globalAlpha = currentAlpha;
            ctx.setLineDash([6, 6]);
            ctx.beginPath();
            ctx.arc(centerX, centerY, currentR, 0, Math.PI * 2);
            ctx.stroke();

            ctx.fillStyle = "#1c1a17";
            ctx.font = "800 11px ui-monospace, SFMono-Regular, Menlo, monospace";
            ctx.textAlign = "center";
            ctx.fillText("! BOOM !", centerX + Math.cos(progress * 6) * currentR, centerY + Math.sin(progress * 6) * currentR);
            ctx.restore();
          }

          // Update & Draw Particles
          for (let i = particlesRef.current.length - 1; i >= 0; i--) {
            const p = particlesRef.current[i];
            p.life += deltaSec;
            const progress = p.life / p.maxLife;
            if (progress >= 1) {
              particlesRef.current.splice(i, 1);
              continue;
            }

            p.x += p.vx * deltaSec;
            p.y += p.vy * deltaSec;
            p.rot += p.vrot * deltaSec;
            p.vy += 180 * deltaSec; // gravity
            p.vx *= Math.pow(0.96, deltaSec * 60); // drag
            p.alpha = Math.max(0, 1 - progress * 1.1);

            ctx.save();
            ctx.translate(centerX + p.x, centerY + p.y);
            ctx.rotate((p.rot * Math.PI) / 180);
            ctx.scale(p.scale, p.scale);
            ctx.globalAlpha = p.alpha;

            if (p.color === "red") ctx.fillStyle = "#d93625";
            else if (p.color === "blue") ctx.fillStyle = "#1d4ed8";
            else if (p.color === "muted") ctx.fillStyle = "#5c5648";
            else ctx.fillStyle = "#1c1a17";

            ctx.font = "800 13px ui-monospace, SFMono-Regular, Menlo, monospace";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(p.char, 0, 0);
            ctx.restore();
          }
        }
      }

      frameId = requestAnimationFrame(render);
    };

    frameId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frameId);
  }, []);

  // Status badge styling
  const statusLabel = useMemo(() => {
    if (mascotStatus === "exploding" || mascotStatus === "dead" || gameState.status === "LOST") return "✖ OVERHEATED";
    if (mascotStatus === "won" || gameState.status === "WON") return "★ DECODED";
    if (mascotStatus === "shake") return "▲ SIGNAL ERROR";
    if (mascotStatus === "evaluating") return "◆ ANALYZING";
    return "● MONITORING";
  }, [mascotStatus, gameState.status]);

  const statusClass = useMemo(() => {
    if (mascotStatus === "exploding" || mascotStatus === "dead" || gameState.status === "LOST") return styles.statusLost;
    if (mascotStatus === "won" || gameState.status === "WON") return styles.statusWon;
    if (mascotStatus === "evaluating" || mascotStatus === "shake") return styles.statusActive;
    return styles.statusIdle;
  }, [mascotStatus, gameState.status]);

  return (
    <aside
      className={`${styles.companionCard} ${mascotStatus === "exploding" ? styles.cardExploding : ""}`}
      aria-label="Puff Companion live mascot readout"
    >
      {/* Console Header */}
      <div className={styles.companionHeader}>
        <div className={styles.companionBrand}>
          <span className={styles.companionDot} />
          <span className={styles.companionName}>PUFF://COMPANION_V1</span>
        </div>
        <span className={`${styles.statusBadge} ${statusClass}`}>{statusLabel}</span>
      </div>

      {/* ASCII Rendering Stage */}
      <div
        ref={stageRef}
        className={styles.mascotStage}
        onClick={handlePoke}
        title="Click to interact with Puff!"
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handlePoke();
          }
        }}
        aria-label="Interactive ASCII Puff mascot. Click or press Enter to poke."
      >
        {/* Layer 1: Ink (Black) */}
        <pre
          ref={inkRef}
          aria-hidden="true"
          className={styles.asciiLayerInk}
        >
          {initialFrame.ink}
        </pre>
        {/* Layer 2: Accent (Decorative Red) */}
        <pre
          ref={accentRef}
          aria-hidden="true"
          className={styles.asciiLayerAccent}
        >
          {initialFrame.accent}
        </pre>

        {/* Dynamic Canvas for Confetti & Explosions */}
        <canvas
          ref={particleCanvasRef}
          width={300}
          height={240}
          aria-hidden="true"
          className={styles.particleCanvas}
        />

        {/* Mascot Overlays / Dazed smoke */}
        {(mascotStatus === "dead" || gameState.status === "LOST") && (
          <div className={styles.bonkOverlay} aria-hidden="true">
            <span className={styles.bonkStars}>* * * BONK * * *</span>
            <span className={styles.smokeWisp}>~ ~ ~ COPIER OVERHEAT ~ ~ ~</span>
          </div>
        )}

        {(mascotStatus === "won" || gameState.status === "WON") && (
          <div className={styles.wonOverlay} aria-hidden="true">
            <span className={styles.victoryRibbon}>★ TRANSMISSION SOLVED! ★</span>
          </div>
        )}

        <div className={styles.pokeHint}>[ CLICK PUFF TO POKE ]</div>
      </div>

      {/* Speech / Tactical Readout Balloon */}
      <div className={styles.speechBalloon} aria-live="polite">
        <div className={styles.speechSpeaker}>PUFF SAYS:</div>
        <p className={styles.speechText}>{speechText}</p>
      </div>

      {/* Mini Stats Footer */}
      <div className={styles.companionFooter}>
        <div className={styles.miniStat}>
          <span className={styles.miniStatLabel}>SOLVED</span>
          <span className={styles.miniStatValue}>{stats.gamesWon}/{stats.gamesPlayed}</span>
        </div>
        <div className={styles.miniStat}>
          <span className={styles.miniStatLabel}>STREAK</span>
          <span className={styles.miniStatValue}>{stats.currentStreak}</span>
        </div>
        <div className={styles.miniStat}>
          <span className={styles.miniStatLabel}>POKES</span>
          <span className={styles.miniStatValue}>{pokeCount}</span>
        </div>
      </div>
    </aside>
  );
}
