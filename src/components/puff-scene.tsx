"use client";

import { useEffect, useRef } from "react";

import { renderPuff } from "@/lib/puff/render";

/**
 * The Puff, rendered live into two stacked `<pre>` layers.
 *
 * React owns the markup and nothing else. The animation loop writes straight to
 * `textContent` on two nodes it holds refs to, because the alternative — a
 * state update per frame — would ask React to reconcile a few thousand
 * characters thirty times a second to produce a change it cannot see anyway.
 *
 * The Puff does not spin. It rests turned toward the headline and follows the
 * pointer from there, and that is the whole of it: it is an illustration that
 * looks at you, not a control. Nothing the visitor does can leave it facing
 * away from the room.
 */

/**
 * Cells rendered per frame, which is the real cost knob: a cell that misses the
 * mascot is retired by the bounding-sphere test in a dozen operations, so cost
 * tracks the count rather than the area of the screen. The character size is
 * then solved backwards from this so a large monitor and a phone do the same
 * amount of work — the art always fills its box, and only the grain changes.
 */
const CELL_BUDGET = 11500;
const CELL_BUDGET_NARROW = 5000;
const NARROW_WIDTH = 640;

/*
 * Quality governor.
 *
 * The budget above is what the mascot is *designed* at, and on a current
 * machine it costs about ten milliseconds a frame. On a laptop four times
 * slower it costs forty, which pins the main thread and takes scrolling and
 * every other interaction on the page down with it — for a decorative animal
 * in the corner of a hero. So the grid is not fixed: the loop times its own
 * render, and a machine that cannot keep up gets a coarser one until it can.
 *
 * It only ever steps down. Stepping back up on a fast frame would oscillate
 * around the threshold and the visitor would watch the mascot pulse between two
 * resolutions, which is far worse than simply being slightly coarse.
 */
const RENDER_BUDGET_MS = 15;
const QUALITY_STEP = 0.7;
const MIN_CELLS = 3200;
/** Consecutive slow frames before stepping down; absorbs one-off stalls. */
const SLOW_FRAMES_BEFORE_STEP = 8;
/** Frames ignored at startup, while the JIT is still warming up on this code. */
const WARMUP_FRAMES = 12;

/**
 * Rendering is capped well under the display rate; ASCII does not need 60fps.
 *
 * Deliberately a little under a two-frame interval on a 60Hz display rather
 * than exactly 1000/30. At exactly 33.3ms the gate lands on the same side of
 * the comparison as vsync itself and lets frames through every second callback
 * and then every third, which beats visibly at around 24fps. Undershooting the
 * interval makes every second callback pass cleanly.
 */
const FRAME_MS = 1000 / 33;

/** Character count the cell probe measures across, for an averaged advance. */
const PROBE_COLS = 40;
/** Used if the probe cannot measure an advance (fonts still loading). */
const FALLBACK_ADVANCE = 0.6;

/**
 * Line height, as a fraction of font size. Imposed rather than measured.
 *
 * A `<pre>` inherits a line height around 1.5, which makes a character cell
 * two and a half times taller than it is wide. The projection can correct the
 * *proportions* of a model drawn on cells that shape, but it cannot buy back
 * the rows: at a fixed cell budget, tall cells spend the budget on columns and
 * leave far too few rows to hold a curve, and the mascot comes out faceted.
 * Roughly square cells spend it evenly. Some vertical overlap is wanted — the
 * heavy end of the ramp closes up into solid mass while the light end stays
 * open, which deepens the very contrast the ramp exists to draw. Not so much
 * overlap, though, that a run of colons down one column fuses into a dotted
 * rule; the coat then reads as ruled paper rather than as fur.
 */
const CELL_LINE_RATIO = 0.74;

/**
 * Resting yaw: turned toward the headline it shares the hero with, rather than
 * staring straight out of the page. Everything the pointer does is a deviation
 * from here, and it always settles back to it.
 */
const REST_YAW = -0.34;

/** How far the Puff will turn to follow a pointer, in radians. */
const LOOK_YAW = 0.5;
const LOOK_PITCH = 0.3;
/** Fraction of the remaining distance the head covers each frame. */
const LOOK_EASE = 0.07;

/** Idle sway, so a Puff nobody is pointing at is still alive. */
const SWAY_AMPLITUDE = 0.11;
const SWAY_SPEED = 0.5;
const BOB_AMPLITUDE = 0.05;
const BOB_SPEED = 1.7;

const BLINK_PERIOD = 4.6;
const BLINK_SHUT = 0.14;

/** 1 with the eyes open, near 0 with them shut, via a brief two-step close. */
function blinkAt(time: number): number {
  const phase = time % BLINK_PERIOD;
  if (phase > BLINK_PERIOD - 0.1) return BLINK_SHUT;
  if (phase > BLINK_PERIOD - 0.18) return 0.5;
  return 1;
}

/**
 * Character advance width of whatever monospace font actually resolved, as a
 * fraction of the font size.
 *
 * Measured rather than assumed because the stack ends in `monospace`, and the
 * font behind that keyword differs by platform — an advance taken on trust is
 * wrong by a few percent on any machine that resolved a different one, which
 * over sixty columns is a visibly cropped or short-measured mascot.
 */
function measureAdvance(pre: HTMLPreElement): number {
  const probe = document.createElement("span");
  probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre";
  probe.textContent = "0".repeat(PROBE_COLS);
  pre.appendChild(probe);

  const fontSize = parseFloat(getComputedStyle(pre).fontSize) || 16;
  const advance = probe.getBoundingClientRect().width / PROBE_COLS / fontSize;
  probe.remove();

  return advance > 0 ? advance : FALLBACK_ADVANCE;
}

export function PuffScene({ className }: { className?: string }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const inkRef = useRef<HTMLPreElement>(null);
  const accentRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const stage = stageRef.current;
    const ink = inkRef.current;
    const accent = accentRef.current;
    if (!stage || !ink || !accent) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    /* Grid, recomputed whenever the stage resizes or the governor steps down. */
    let cols = 0;
    let rows = 0;
    let cellAspect = 1;
    /* Keyed on the viewport, not the stage. The stage is one column of a
       two-column hero and is narrow on a desktop too; what the smaller budget
       is actually for is a smaller machine. */
    let cellBudget =
      window.innerWidth < NARROW_WIDTH ? CELL_BUDGET_NARROW : CELL_BUDGET;
    let slowFrames = 0;
    let framesDrawn = 0;

    /* Gaze. Both are offsets from REST_YAW / level, eased toward the pointer. */
    let lookYaw = 0;
    let lookPitch = 0;
    let targetYaw = 0;
    let targetPitch = 0;

    let onScreen = true;
    let dirty = true;
    let lastFrame = 0;
    let frameHandle = 0;
    const started = performance.now();

    function resize() {
      const box = stage!.getBoundingClientRect();
      if (box.width < 1 || box.height < 1) return;

      const advance = measureAdvance(ink!);
      cellAspect = advance / CELL_LINE_RATIO;

      /* Solve the cell width that lands the grid on the budget:
         cols * rows = (w / cw) * (h * aspect / cw) = budget. */
      const cellWidth = Math.sqrt(
        (box.width * box.height * cellAspect) / cellBudget,
      );
      const fontSize = cellWidth / advance;
      const cellHeight = fontSize * CELL_LINE_RATIO;

      cols = Math.max(8, Math.floor(box.width / cellWidth));
      rows = Math.max(8, Math.floor(box.height / cellHeight));

      for (const layer of [ink!, accent!]) {
        layer.style.fontSize = `${fontSize}px`;
        layer.style.lineHeight = `${cellHeight}px`;
      }
      dirty = true;
    }

    function draw(now: number) {
      const time = (now - started) / 1000;
      const still = reduceMotion.matches;

      if (!still) {
        lookYaw += (targetYaw - lookYaw) * LOOK_EASE;
        lookPitch += (targetPitch - lookPitch) * LOOK_EASE;
      }

      const sway = still ? 0 : Math.sin(time * SWAY_SPEED) * SWAY_AMPLITUDE;
      const startedRender = performance.now();
      const frame = renderPuff(
        cols,
        rows,
        cellAspect,
        {
          time: still ? 1.2 : time,
          bob: still ? 0 : Math.sin(time * BOB_SPEED) * BOB_AMPLITUDE,
          squash: 0,
          blink: still ? 1 : blinkAt(time),
        },
        { yaw: REST_YAW + sway + lookYaw, pitch: lookPitch },
      );

      ink!.textContent = frame.ink;
      accent!.textContent = frame.accent;

      /* Measured around the marcher alone, not the whole callback: the two
         text writes that follow are the browser's cost, not ours, and are not
         something a smaller grid would meaningfully change. */
      const cost = performance.now() - startedRender;
      if (++framesDrawn > WARMUP_FRAMES && cellBudget > MIN_CELLS) {
        slowFrames = cost > RENDER_BUDGET_MS ? slowFrames + 1 : 0;
        if (slowFrames >= SLOW_FRAMES_BEFORE_STEP) {
          cellBudget = Math.max(MIN_CELLS, Math.round(cellBudget * QUALITY_STEP));
          slowFrames = 0;
          resize();
        }
      }
    }

    function tick(now: number) {
      frameHandle = requestAnimationFrame(tick);
      if (!onScreen || document.hidden || cols === 0) return;

      /* Under reduced motion the Puff holds one pose, so a frame is only drawn
         when the layout has actually changed under it. */
      if (reduceMotion.matches && !dirty) return;
      if (now - lastFrame < FRAME_MS) return;

      lastFrame = now;
      dirty = false;
      draw(now);
    }

    /*
     * Aiming the gaze off the viewport rather than off the stage's own box is
     * deliberate: it needs no layout read, so pointer movement never forces a
     * reflow against the text we are rewriting every frame.
     */
    function onPointerMove(event: PointerEvent) {
      targetYaw = (event.clientX / window.innerWidth - 0.5) * 2 * LOOK_YAW;
      targetPitch = (event.clientY / window.innerHeight - 0.5) * 2 * LOOK_PITCH;
    }

    /* A pointer that has left the window is not somewhere to keep staring. */
    function onPointerOut(event: PointerEvent) {
      if (event.relatedTarget === null) {
        targetYaw = 0;
        targetPitch = 0;
      }
    }

    /* Switching the setting on or off has to force one frame: coming out of
       reduced motion there is nothing else to restart the loop, and going into
       it the last drawn frame may be mid-bob. */
    const onMotionPreferenceChange = () => {
      dirty = true;
    };

    const observer = new ResizeObserver(resize);
    observer.observe(stage);
    const visibility = new IntersectionObserver(
      ([entry]) => {
        onScreen = entry.isIntersecting;
      },
      { rootMargin: "120px" },
    );
    visibility.observe(stage);

    resize();
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerout", onPointerOut, { passive: true });
    reduceMotion.addEventListener("change", onMotionPreferenceChange);
    frameHandle = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frameHandle);
      observer.disconnect();
      visibility.disconnect();
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerout", onPointerOut);
      reduceMotion.removeEventListener("change", onMotionPreferenceChange);
    };
  }, []);

  return (
    <div
      ref={stageRef}
      role="img"
      aria-label="HAM's mascot: a small round creature covered in fur, with a loop of red marker curling off its head."
      className={`relative overflow-hidden select-none ${className ?? ""}`}
    >
      {/*
        Two layers, exactly overlapping, so a frame reaches the DOM as two text
        writes. Colouring per character would mean a span per cell — a few
        thousand elements rebuilt thirty times a second.

        Both are taken out of flow, and the ink layer has to be as much as the
        accent one. A `<pre>` of `white-space: pre` has a min-content width of
        its longest line, and a grid or flex item's automatic minimum size
        honours that — so an in-flow layer lets the art dictate the width of the
        column it is sitting in. That is a feedback loop, because the column's
        width is the input the grid was solved from: the governor enlarges the
        characters, the wider line widens the column, the ResizeObserver sees a
        bigger stage and solves for more columns again. Out of flow, the stage is
        sized purely by its parent and the loop cannot close.
      */}
      <pre
        ref={inkRef}
        aria-hidden="true"
        className="font-mono pointer-events-none absolute inset-0 m-0 text-ink"
      />
      <pre
        ref={accentRef}
        aria-hidden="true"
        className="font-mono pointer-events-none absolute inset-0 m-0 text-decorative-red"
      />
    </div>
  );
}
