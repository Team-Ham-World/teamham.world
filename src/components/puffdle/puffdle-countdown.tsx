import { useEffect, useState } from "react";

import styles from "./puffdle-game.module.css";

export function PuffdleCountdown({ nextPuzzleAt, onReset }: {
  nextPuzzleAt?: string;
  onReset?: () => Promise<void>;
}) {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    let requestedReset = false;
    const update = () => {
      const now = Date.now();
      const deadline = nextPuzzleAt
        ? Date.parse(nextPuzzleAt)
        : (Math.floor(now / 86_400_000) + 1) * 86_400_000;
      const seconds = Math.max(0, Math.ceil((deadline - now) / 1000));
      setRemaining(seconds);
      if (seconds === 0 && !requestedReset && onReset) {
        requestedReset = true;
        void onReset();
      }
    };
    const frame = requestAnimationFrame(update);
    const timer = setInterval(update, 1000);
    document.addEventListener("visibilitychange", update);
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, [nextPuzzleAt, onReset]);

  const time = remaining === null ? "--:--:--" : [
    Math.floor(remaining / 3600),
    Math.floor((remaining % 3600) / 60),
    remaining % 60,
  ].map(value => String(value).padStart(2, "0")).join(":");

  return (
    <div className={styles.countdown}>
      <div>
        <p className={styles.countdownLabel}>NEXT DAILY WORD</p>
        <p className={styles.countdownReset}>Resets daily at 00:00 UTC</p>
      </div>
      <span className={styles.countdownTime} role="timer" aria-label="Time until the next daily word" aria-live="off">
        {remaining === 0 ? "Refreshing…" : time}
      </span>
    </div>
  );
}
