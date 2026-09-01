"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  createDefaultStats,
  createInitialPuffdleState,
  generateShareGrid,
  recordGameResult,
  submitGuess,
  type GameMode,
  type PuffdleGameState,
  type PuffdleStats,
  type TileEvaluation,
} from "@/lib/puffdle/game";
import type {
  PuffdleLeaderboardEntry,
  PuffdleLeaderboardSnapshot,
} from "@/lib/puffdle/leaderboard";
import {
  getDailyWord,
  getRandomUnlimitedWord,
  isValidGuess,
} from "@/lib/puffdle/words";

import styles from "./puffdle-game.module.css";
import { PuffdleMascot } from "./puffdle-mascot";

const KEYBOARD_ROWS = [
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
  ["ENTER", "Z", "X", "C", "V", "B", "N", "M", "⌫"],
];

const LOCAL_STATS_KEY = "ham:puffdle:stats:v1";
const DAILY_STATE_PREFIX = "ham:puffdle:daily:v1:";

type ModalView = "none" | "help" | "stats" | "leaderboard" | "gameover";

type LeaderboardState =
  | { status: "loading"; authenticated: false; username: null }
  | { status: "signed-out"; authenticated: false; username: null }
  | { status: "error"; authenticated: false; username: null }
  | ({
      status: "ready" | "saving";
      authenticated: true;
      username: string | null;
    } & PuffdleLeaderboardSnapshot);

function isLeaderboardEntry(value: unknown): value is PuffdleLeaderboardEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return (
    Number.isInteger(entry.rank) &&
    typeof entry.username === "string" &&
    Number.isInteger(entry.score) &&
    typeof entry.mine === "boolean"
  );
}

function parseLeaderboardPayload(value: unknown): LeaderboardState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  if (payload.authenticated === false) {
    return { status: "signed-out", authenticated: false, username: null };
  }
  if (
    payload.authenticated !== true ||
    !(typeof payload.username === "string" || payload.username === null) ||
    !Number.isInteger(payload.personalBest) ||
    !payload.stats ||
    typeof payload.stats !== "object" ||
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
    stats: payload.stats as PuffdleLeaderboardSnapshot["stats"],
    scores: payload.scores,
  };
}

export function PuffdleGame() {
  const [mode, setMode] = useState<GameMode>("daily");
  const [gameState, setGameState] = useState<PuffdleGameState>(() => {
    const daily = getDailyWord();
    return createInitialPuffdleState(daily.word, "daily", daily.dayNumber);
  });
  const [stats, setStats] = useState<PuffdleStats>(createDefaultStats);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isShaking, setIsShaking] = useState(false);
  const [modal, setModal] = useState<ModalView>("none");
  const [leaderboard, setLeaderboard] = useState<LeaderboardState>({
    status: "loading",
    authenticated: false,
    username: null,
  });

  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string, durationMs = 1800) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMessage(msg);
    toastTimerRef.current = setTimeout(() => {
      setToastMessage(null);
    }, durationMs);
  }, []);

  // Fetch leaderboard data
  const loadLeaderboard = useCallback(async () => {
    try {
      const response = await fetch("/api/puffdle/leaderboard", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (response.status === 404) {
        setLeaderboard({ status: "signed-out", authenticated: false, username: null });
        return;
      }
      if (!response.ok) throw new Error("Leaderboard unavailable");
      const parsed = parseLeaderboardPayload(await response.json());
      if (!parsed) throw new Error("Invalid leaderboard response");
      setLeaderboard(parsed);
    } catch {
      setLeaderboard({ status: "error", authenticated: false, username: null });
    }
  }, []);

  // Load saved stats and daily state on initial client mount
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        const savedStats = localStorage.getItem(LOCAL_STATS_KEY);
        if (savedStats) {
          const parsed = JSON.parse(savedStats) as PuffdleStats;
          if (
            Number.isInteger(parsed.gamesPlayed) &&
            Number.isInteger(parsed.gamesWon) &&
            parsed.guessDistribution
          ) {
            setStats(parsed);
          }
        }
      } catch {
        // LocalStorage might be restricted
      }

      const daily = getDailyWord();
      try {
        const savedDailyState = localStorage.getItem(`${DAILY_STATE_PREFIX}${daily.dayNumber}`);
        if (savedDailyState) {
          const parsed = JSON.parse(savedDailyState) as PuffdleGameState;
          if (parsed && parsed.targetWord && parsed.dayNumber === daily.dayNumber) {
            setGameState(parsed);
            if (parsed.status !== "IN_PROGRESS") {
              setModal("gameover");
            }
          }
        }
      } catch {
        // Ignore storage errors
      }

      void loadLeaderboard();
    });

    return () => cancelAnimationFrame(frame);
  }, [loadLeaderboard]);

  // Sync Daily game state to local storage
  const persistDailyState = useCallback((stateToSave: PuffdleGameState) => {
    if (stateToSave.mode !== "daily") return;
    try {
      localStorage.setItem(
        `${DAILY_STATE_PREFIX}${stateToSave.dayNumber}`,
        JSON.stringify(stateToSave),
      );
    } catch {
      // Ignore storage errors
    }
  }, []);

  // Submit high score to backend API if member is authenticated
  const submitMemberScore = useCallback(
    async (points: number, updatedStats: PuffdleStats) => {
      if (!leaderboard.authenticated) return;
      setLeaderboard({ ...leaderboard, status: "saving" });
      try {
        const response = await fetch("/api/puffdle/leaderboard", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            score: points,
            gamesPlayed: updatedStats.gamesPlayed,
            gamesWon: updatedStats.gamesWon,
            currentStreak: updatedStats.currentStreak,
            maxStreak: updatedStats.maxStreak,
          }),
        });
        if (!response.ok) throw new Error("Score submission failed");
        const parsed = parseLeaderboardPayload(await response.json());
        if (!parsed || !parsed.authenticated) throw new Error("Invalid response");
        setLeaderboard(parsed);
      } catch {
        setLeaderboard((current) =>
          current.authenticated
            ? { ...current, status: "ready" }
            : { status: "error", authenticated: false, username: null },
        );
      }
    },
    [leaderboard],
  );

  // Switch between Daily and Unlimited modes
  const handleModeChange = useCallback(
    (newMode: GameMode) => {
      if (newMode === mode) return;
      setMode(newMode);
      setToastMessage(null);

      if (newMode === "daily") {
        const daily = getDailyWord();
        try {
          const saved = localStorage.getItem(`${DAILY_STATE_PREFIX}${daily.dayNumber}`);
          if (saved) {
            const parsed = JSON.parse(saved) as PuffdleGameState;
            if (parsed && parsed.dayNumber === daily.dayNumber) {
              setGameState(parsed);
              return;
            }
          }
        } catch {
          // Ignore
        }
        setGameState(createInitialPuffdleState(daily.word, "daily", daily.dayNumber));
      } else {
        const unlimitedWord = getRandomUnlimitedWord();
        setGameState(createInitialPuffdleState(unlimitedWord, "unlimited"));
      }
    },
    [mode],
  );

  // Start fresh Unlimited game
  const startNewUnlimitedGame = useCallback(() => {
    const word = getRandomUnlimitedWord();
    setGameState(createInitialPuffdleState(word, "unlimited"));
    setModal("none");
    showToast("NEW UNLIMITED GAME STARTED");
  }, [showToast]);

  // Handle letter typing
  const handleKeyInput = useCallback(
    (key: string) => {
      if (modal !== "none" && modal !== "gameover") return;
      if (gameState.status !== "IN_PROGRESS") return;

      const upperKey = key.toUpperCase();

      if (upperKey === "ENTER") {
        if (gameState.currentGuess.length < 5) {
          setIsShaking(true);
          showToast("NOT ENOUGH LETTERS");
          setTimeout(() => setIsShaking(false), 500);
          return;
        }

        if (!isValidGuess(gameState.currentGuess)) {
          setIsShaking(true);
          showToast("NOT IN WORD LIST");
          setTimeout(() => setIsShaking(false), 500);
          return;
        }

        const { state: nextState } = submitGuess(gameState, gameState.currentGuess);
        setGameState(nextState);
        persistDailyState(nextState);

        if (nextState.status !== "IN_PROGRESS") {
          const isWon = nextState.status === "WON";
          const updatedStats = recordGameResult(stats, isWon, nextState.guesses.length);
          setStats(updatedStats);
          try {
            localStorage.setItem(LOCAL_STATS_KEY, JSON.stringify(updatedStats));
          } catch {
            // Ignore
          }

          if (isWon) {
            showToast(`SOLVED IN ${nextState.guesses.length} GUESSES! +${nextState.pointsEarned} PTS`, 2400);
            void submitMemberScore(nextState.pointsEarned, updatedStats);
          } else {
            showToast(`OUT OF ATTEMPTS! WORD: ${nextState.targetWord}`, 3000);
          }

          setTimeout(() => {
            setModal("gameover");
          }, 1400);
        }
        return;
      }

      if (upperKey === "BACKSPACE" || upperKey === "⌫") {
        if (gameState.currentGuess.length > 0) {
          setGameState((prev) => ({
            ...prev,
            currentGuess: prev.currentGuess.slice(0, -1),
          }));
        }
        return;
      }

      if (/^[A-Z]$/.test(upperKey)) {
        if (gameState.currentGuess.length < 5) {
          setGameState((prev) => ({
            ...prev,
            currentGuess: prev.currentGuess + upperKey,
          }));
        }
      }
    },
    [gameState, modal, persistDailyState, showToast, stats, submitMemberScore],
  );

  // Physical keyboard event listener
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.code === "Escape") {
        setModal("none");
        return;
      }
      if (event.code === "Enter") {
        event.preventDefault();
        handleKeyInput("ENTER");
        return;
      }
      if (event.code === "Backspace") {
        event.preventDefault();
        handleKeyInput("BACKSPACE");
        return;
      }
      if (/^Key[A-Z]$/.test(event.code)) {
        event.preventDefault();
        handleKeyInput(event.key);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleKeyInput]);

  // Copy share emoji grid to clipboard
  const handleShare = useCallback(() => {
    const grid = generateShareGrid(gameState);
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(grid);
      showToast("COPIED TO CLIPBOARD!");
    } else {
      showToast("UNABLE TO ACCESS CLIPBOARD");
    }
  }, [gameState, showToast]);

  const winPercentage = useMemo(() => {
    if (stats.gamesPlayed === 0) return 0;
    return Math.round((stats.gamesWon / stats.gamesPlayed) * 100);
  }, [stats]);

  const maxDistCount = useMemo(() => {
    return Math.max(1, ...Object.values(stats.guessDistribution));
  }, [stats]);

  return (
    <div className={styles.gameContainer}>
      {/* Main Game Column */}
      <div className={styles.mainColumn}>
        {/* Header Block */}
        <header className={styles.headerBlock}>
          <div className={styles.topRow}>
            <div className={styles.titleGroup}>
              <span className={styles.eyebrow}>
                {mode === "daily" ? `DAILY TRANSMISSION #${gameState.dayNumber}` : "UNLIMITED ARCHIVE"}
              </span>
              <h1 className={styles.gameTitle}>PUFFDLE</h1>
            </div>

            <div className={styles.headerActions}>
              <button
                type="button"
                className={styles.iconButton}
                onClick={() => setModal("help")}
                aria-label="How to play"
              >
                [?] RULES
              </button>
              <button
                type="button"
                className={styles.iconButton}
                onClick={() => setModal("stats")}
                aria-label="Player statistics"
              >
                [#] STATS
              </button>
              <button
                type="button"
                className={styles.iconButton}
                onClick={() => setModal("leaderboard")}
                aria-label="Member leaderboard"
              >
                [*] RANKS
              </button>
            </div>
          </div>

          {/* Mode Tabs */}
          <div className={styles.modeTabs} role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "daily"}
              className={`${styles.modeTab} ${mode === "daily" ? styles.modeTabActive : ""}`}
              onClick={() => handleModeChange("daily")}
            >
              DAILY PUFFDLE
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "unlimited"}
              className={`${styles.modeTab} ${mode === "unlimited" ? styles.modeTabActive : ""}`}
              onClick={() => handleModeChange("unlimited")}
            >
              PUFFDLE UNLIMITED
            </button>
          </div>
        </header>

        {/* Toast message */}
        <div className={styles.toastContainer} aria-live="polite">
          {toastMessage && <div className={styles.toast}>{toastMessage}</div>}
        </div>

        {/* Wordle 6x5 Grid */}
        <main className={styles.boardArea} aria-label="Wordle guess board">
          {Array.from({ length: 6 }).map((_, rowIndex) => {
            const isSubmitted = rowIndex < gameState.guesses.length;
            const isCurrent = rowIndex === gameState.guesses.length;
            const submittedWord = isSubmitted ? gameState.guesses[rowIndex] : "";
            const evaluations = isSubmitted ? gameState.evaluations[rowIndex] : [];
            const rowIsShaking = isCurrent && isShaking;

            return (
              <div
                key={rowIndex}
                className={`${styles.row} ${rowIsShaking ? styles.rowShaking : ""}`}
              >
                {Array.from({ length: 5 }).map((__, colIndex) => {
                  let char = "";
                  let tileState: TileEvaluation | "empty" | "filled" = "empty";

                  if (isSubmitted) {
                    char = submittedWord[colIndex] || "";
                    tileState = evaluations[colIndex] || "empty";
                  } else if (isCurrent) {
                    char = gameState.currentGuess[colIndex] || "";
                    tileState = char ? "filled" : "empty";
                  }

                  let stateClass = "";
                  if (tileState === "correct") stateClass = styles.tileCorrect;
                  else if (tileState === "present") stateClass = styles.tilePresent;
                  else if (tileState === "absent") stateClass = styles.tileAbsent;
                  else if (tileState === "filled") stateClass = styles.tileFilled;

                  return (
                    <div
                      key={colIndex}
                      className={`${styles.tile} ${stateClass} ${isSubmitted ? styles.tileRevealed : ""}`}
                      style={
                        isSubmitted
                          ? { animationDelay: `${colIndex * 100}ms` }
                          : undefined
                      }
                    >
                      {char}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </main>

        {/* Virtual Keyboard */}
        <nav className={styles.keyboard} aria-label="Virtual keyboard">
          {KEYBOARD_ROWS.map((row, rowIdx) => (
            <div key={rowIdx} className={styles.keyboardRow}>
              {row.map((key) => {
                const isSpecial = key === "ENTER" || key === "⌫";
                const keyStatus = gameState.keyboardStatus[key];
                let statusClass = "";
                if (keyStatus === "correct") statusClass = styles.keyCorrect;
                else if (keyStatus === "present") statusClass = styles.keyPresent;
                else if (keyStatus === "absent") statusClass = styles.keyAbsent;

                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handleKeyInput(key)}
                    className={`${styles.key} ${isSpecial ? styles.keySpecial : ""} ${statusClass}`}
                  >
                    {key}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
      </div>

      {/* Right Column: Live Interactive ASCII Mascot Companion */}
      <div className={styles.sideColumn}>
        <PuffdleMascot
          gameState={gameState}
          stats={stats}
          isShaking={isShaking}
        />
      </div>

      {/* MODAL DIALOGS */}
      {modal !== "none" && (
        <div
          className={styles.modalBackdrop}
          onClick={(e) => {
            if (e.target === e.currentTarget) setModal("none");
          }}
        >
          <div className={styles.modalSheet} role="dialog" aria-modal="true">
            {/* HOW TO PLAY MODAL */}
            {modal === "help" && (
              <>
                <div className={styles.modalHeader}>
                  <h2 className={styles.modalTitle}>HOW TO PLAY</h2>
                  <button
                    type="button"
                    className={styles.closeButton}
                    onClick={() => setModal("none")}
                  >
                    [X]
                  </button>
                </div>
                <div className="space-y-4 text-sm leading-relaxed text-muted">
                  <p>
                    Guess the <strong>PUFFDLE</strong> in 6 attempts. Each guess must be a valid 5-letter English word.
                  </p>
                  <p>
                    After each guess, the color of the tiles will change to show how close your guess was to the word:
                  </p>

                  {/* Examples */}
                  <div className="space-y-2 py-2">
                    <div className="flex items-center gap-2">
                      <div className={`${styles.tile} ${styles.tileCorrect} h-10 w-10 text-base`}>W</div>
                      <span><strong>W</strong> is in the word and in the correct spot.</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className={`${styles.tile} ${styles.tilePresent} h-10 w-10 text-base`}>I</div>
                      <span><strong>I</strong> is in the word but in the wrong spot.</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className={`${styles.tile} ${styles.tileAbsent} h-10 w-10 text-base`}>U</div>
                      <span><strong>U</strong> is not in the word in any spot.</span>
                    </div>
                  </div>

                  <p>
                    <strong>Daily Puffdle</strong> cycles through words deterministically so words never repeat. <strong>Puffdle Unlimited</strong> gives you endless games anytime.
                  </p>
                </div>
                <div className={styles.modalActions}>
                  <button
                    type="button"
                    className={styles.primaryButton}
                    onClick={() => setModal("none")}
                  >
                    READY TO PLAY
                  </button>
                </div>
              </>
            )}

            {/* STATS MODAL */}
            {modal === "stats" && (
              <>
                <div className={styles.modalHeader}>
                  <h2 className={styles.modalTitle}>STATISTICS</h2>
                  <button
                    type="button"
                    className={styles.closeButton}
                    onClick={() => setModal("none")}
                  >
                    [X]
                  </button>
                </div>

                <div className={styles.statsGrid}>
                  <div className={styles.statBox}>
                    <span className={styles.statNumber}>{stats.gamesPlayed}</span>
                    <span className={styles.statLabel}>Played</span>
                  </div>
                  <div className={styles.statBox}>
                    <span className={styles.statNumber}>{winPercentage}%</span>
                    <span className={styles.statLabel}>Win %</span>
                  </div>
                  <div className={styles.statBox}>
                    <span className={styles.statNumber}>{stats.currentStreak}</span>
                    <span className={styles.statLabel}>Current Streak</span>
                  </div>
                  <div className={styles.statBox}>
                    <span className={styles.statNumber}>{stats.maxStreak}</span>
                    <span className={styles.statLabel}>Max Streak</span>
                  </div>
                </div>

                <h3 className={styles.distHeading}>GUESS DISTRIBUTION</h3>
                <div className={styles.distList}>
                  {([1, 2, 3, 4, 5, 6] as const).map((num) => {
                    const count = stats.guessDistribution[num] || 0;
                    const percent = Math.round((count / maxDistCount) * 100);
                    const isLastSolve =
                      gameState.status === "WON" && gameState.guesses.length === num;

                    return (
                      <div key={num} className={styles.distRow}>
                        <span>{num}</span>
                        <div
                          className={`${styles.distBar} ${isLastSolve ? styles.distBarHighlight : ""}`}
                          style={{ width: `${Math.max(8, percent)}%` }}
                        >
                          {count}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className={styles.modalActions}>
                  {gameState.status !== "IN_PROGRESS" && (
                    <button
                      type="button"
                      className={styles.primaryButton}
                      onClick={handleShare}
                    >
                      SHARE RESULTS
                    </button>
                  )}
                  {mode === "unlimited" && (
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={startNewUnlimitedGame}
                    >
                      NEW UNLIMITED GAME
                    </button>
                  )}
                </div>
              </>
            )}

            {/* LEADERBOARD MODAL */}
            {modal === "leaderboard" && (
              <>
                <div className={styles.modalHeader}>
                  <h2 className={styles.modalTitle}>MEMBER LEADERBOARD</h2>
                  <button
                    type="button"
                    className={styles.closeButton}
                    onClick={() => setModal("none")}
                  >
                    [X]
                  </button>
                </div>

                {leaderboard.status === "loading" && (
                  <p className="py-6 text-center font-mono text-sm text-muted">
                    Checking the member board...
                  </p>
                )}

                {leaderboard.status === "signed-out" && (
                  <div className={styles.memberNotice}>
                    Sign in with Discord as a verified Team HAM member to compete on the shared leaderboard and record high scores.
                  </div>
                )}

                {leaderboard.status === "error" && (
                  <div className={styles.memberNotice}>
                    The leaderboard service is currently offline. Your personal scores remain saved locally.
                  </div>
                )}

                {leaderboard.authenticated && (
                  <>
                    <div className="mb-4 flex items-center justify-between border-b border-ink pb-2 text-xs font-bold font-mono">
                      <span>MEMBER: {leaderboard.username}</span>
                      <span>HIGH SCORE: {leaderboard.personalBest} PTS</span>
                    </div>

                    {leaderboard.scores.length === 0 ? (
                      <p className="py-6 text-center font-mono text-sm text-muted">
                        No scores recorded yet. Be the first to solve a Puffdle!
                      </p>
                    ) : (
                      <div className={styles.leaderboardTable}>
                        {leaderboard.scores.map((entry) => (
                          <div
                            key={`${entry.rank}-${entry.username}`}
                            className={`${styles.leaderboardRow} ${entry.mine ? styles.leaderboardRowMine : ""}`}
                          >
                            <span>#{String(entry.rank).padStart(2, "0")}</span>
                            <span className="truncate">{entry.username}</span>
                            <span className={styles.scorePoints}>{entry.score} PTS</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}

                <div className={styles.modalActions}>
                  <button
                    type="button"
                    className={styles.primaryButton}
                    onClick={() => setModal("none")}
                  >
                    CLOSE
                  </button>
                </div>
              </>
            )}

            {/* GAME OVER MODAL */}
            {modal === "gameover" && (
              <>
                <div className={styles.modalHeader}>
                  <h2 className={styles.modalTitle}>
                    {gameState.status === "WON" ? "TRANSMISSION DECODED" : "OUT OF ATTEMPTS"}
                  </h2>
                  <button
                    type="button"
                    className={styles.closeButton}
                    onClick={() => setModal("none")}
                  >
                    [X]
                  </button>
                </div>

                <div className={styles.outcomeStamp}>
                  <p
                    className={`${styles.outcomeTitle} ${gameState.status === "WON" ? styles.outcomeWon : styles.outcomeLost}`}
                  >
                    {gameState.status === "WON" ? "VICTORY" : "GAME OVER"}
                  </p>
                  <p className={styles.outcomeWord}>
                    TARGET WORD: <strong>{gameState.targetWord}</strong>
                  </p>
                  {gameState.status === "WON" && (
                    <p className="mt-1 font-mono text-xs font-bold text-interactive-blue">
                      +{gameState.pointsEarned} PTS EARNED
                    </p>
                  )}
                </div>

                <div className={styles.statsGrid}>
                  <div className={styles.statBox}>
                    <span className={styles.statNumber}>{stats.gamesPlayed}</span>
                    <span className={styles.statLabel}>Played</span>
                  </div>
                  <div className={styles.statBox}>
                    <span className={styles.statNumber}>{winPercentage}%</span>
                    <span className={styles.statLabel}>Win %</span>
                  </div>
                  <div className={styles.statBox}>
                    <span className={styles.statNumber}>{stats.currentStreak}</span>
                    <span className={styles.statLabel}>Current Streak</span>
                  </div>
                  <div className={styles.statBox}>
                    <span className={styles.statNumber}>{stats.maxStreak}</span>
                    <span className={styles.statLabel}>Max Streak</span>
                  </div>
                </div>

                <div className={styles.modalActions}>
                  <button
                    type="button"
                    className={styles.primaryButton}
                    onClick={handleShare}
                  >
                    SHARE RESULT
                  </button>
                  {mode === "unlimited" ? (
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={startNewUnlimitedGame}
                    >
                      PLAY AGAIN
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={() => handleModeChange("unlimited")}
                    >
                      TRY UNLIMITED
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
