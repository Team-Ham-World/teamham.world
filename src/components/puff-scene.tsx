"use client";

import { useEffect, useRef } from "react";

import { renderPuff } from "@/lib/puff/render";
import {
  appendPuffStamp,
  createPuffStamp,
  type PuffStamp,
} from "@/lib/puff/stamp";

/**
 * Puff is rendered live into two stacked `<pre>` layers.
 *
 * React owns the markup and nothing else. The animation loop writes straight
 * to `textContent`, because reconciling several thousand characters thirty
 * times a second would add work without changing what the browser paints.
 *
 * On desktop, ten clicks reveal the deliberately broken copy machine: the
 * current frame is rasterised once and the hero becomes an event-painted stamp
 * pad. It has no simulation and no animation loop after activation.
 */

/** Cells rendered per frame; the main cost knob for the live mascot. */
const CELL_BUDGET = 11500;
const CELL_BUDGET_NARROW = 5000;
const NARROW_WIDTH = 640;

/* The governor only steps down, avoiding visible resolution oscillation. */
const RENDER_BUDGET_MS = 15;
const QUALITY_STEP = 0.7;
const MIN_CELLS = 3200;
const SLOW_FRAMES_BEFORE_STEP = 8;
const WARMUP_FRAMES = 12;

/** ASCII does not need the display's full refresh rate. */
const FRAME_MS = 1000 / 33;

const PROBE_COLS = 40;
const FALLBACK_ADVANCE = 0.6;
const CELL_LINE_RATIO = 0.74;

/** A slight turn toward the headline, without hiding the far eye. */
const REST_YAW = -0.12;
const LOOK_YAW = 0.42;
const LOOK_PITCH = 0.24;
const LOOK_DEPTH_RATIO = 1.15;

/* The eyes lead quickly; the heavier body only follows after they run out of
   room, then stops once they have nearly re-centred. */
const EYE_YAW_LIMIT = 0.13;
const EYE_PITCH_LIMIT = 0.09;
const EYE_GAZE_X = 0.055;
const EYE_GAZE_Y = 0.04;
const EYE_RESPONSE = 20;
const BODY_RESPONSE = 4.5;
const POINTER_RESPONSE = 7.5;
const BODY_TRIGGER_RATIO = 0.92;
const BODY_RECENTER_RATIO = 0.28;

const SWAY_AMPLITUDE = 0.06;
const SWAY_SPEED = 0.5;
const BOB_AMPLITUDE = 0.05;
const BOB_SPEED = 1.7;

const BLINK_PERIOD = 4.6;
const BLINK_SHUT = 0.14;

const EASTER_EGG_CLICKS = 10;
const STAMP_PIXEL_RATIO_LIMIT = 1.5;
const STAMP_PREVIEW_SCALE = 0.31;

const INITIAL_PRINTS = [
  { x: 0.2, y: 0.3, scale: 1.32, opacity: 0.68 },
  { x: 0.5, y: 0.68, scale: 1.15, opacity: 0.62 },
  { x: 0.79, y: 0.33, scale: 1.38, opacity: 0.7 },
] as const;

interface StampSource {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

/** 1 with the eyes open, near 0 with them shut, via a brief two-step close. */
function blinkAt(time: number): number {
  const phase = time % BLINK_PERIOD;
  if (phase > BLINK_PERIOD - 0.1) return BLINK_SHUT;
  if (phase > BLINK_PERIOD - 0.18) return 0.5;
  return 1;
}

/** Character advance of the monospace font that actually resolved. */
function measureAdvance(pre: HTMLPreElement): number {
  const probe = document.createElement("span");
  probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre";
  probe.textContent = "0".repeat(PROBE_COLS);
  pre.appendChild(probe);

  const measuredFontSize = parseFloat(getComputedStyle(pre).fontSize) || 16;
  const advance =
    probe.getBoundingClientRect().width / PROBE_COLS / measuredFontSize;
  probe.remove();

  return advance > 0 ? advance : FALLBACK_ADVANCE;
}

/** Hysteresis keeps the body from twitching at the edge of the eye range. */
export function shouldBodyFollow(
  eyeYaw: number,
  eyePitch: number,
  following: boolean,
): boolean {
  const eyeDemand = Math.hypot(
    eyeYaw / EYE_YAW_LIMIT,
    eyePitch / EYE_PITCH_LIMIT,
  );
  return eyeDemand >
    (following ? BODY_RECENTER_RATIO : BODY_TRIGGER_RATIO);
}

export function PuffScene({
  anchorId,
  className,
}: {
  anchorId: string;
  className?: string;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const mascotRef = useRef<HTMLDivElement>(null);
  const inkRef = useRef<HTMLPreElement>(null);
  const accentRef = useRef<HTMLPreElement>(null);
  const stampCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const stage = stageRef.current;
    const mascot = mascotRef.current;
    const ink = inkRef.current;
    const accent = accentRef.current;
    const stampCanvas = stampCanvasRef.current;
    const anchor = document.getElementById(anchorId);
    if (!stage || !mascot || !ink || !accent || !stampCanvas || !anchor) {
      return;
    }

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const desktopEasterEgg = window.matchMedia(
      "(min-width: 1024px) and (hover: hover) and (pointer: fine)",
    );
    const initialAriaLabel = stage.getAttribute("aria-label");

    let cols = 0;
    let rows = 0;
    let cellAspect = 1;
    let cellWidth = 0;
    let cellHeight = 0;
    let fontSize = 0;
    let cellBudget =
      window.innerWidth < NARROW_WIDTH ? CELL_BUDGET_NARROW : CELL_BUDGET;
    let slowFrames = 0;
    let framesDrawn = 0;
    let lastInk = "";
    let lastAccent = "";
    let squash = 0;
    let easterEggClicks = 0;

    /* Pointer targets are absolute directions. Eye angles stay relative to the
       body so they can lead it and re-centre as the body catches up. */
    let lookYaw = REST_YAW;
    let lookPitch = 0;
    let eyeYaw = 0;
    let eyePitch = 0;
    let targetYaw = REST_YAW;
    let targetPitch = 0;
    let bodyFollowing = false;
    let pointerActive = false;
    let pointerEngagement = 0;
    let mascotCenterPageX = 0;
    let mascotCenterPageY = 0;
    let lookDepth = 1;

    /* The stamp pad is a tiny retained display list painted only on events. */
    let stampMode = false;
    let stampContext: CanvasRenderingContext2D | null = null;
    let stampSource: StampSource | null = null;
    let stampPageLeft = 0;
    let stampPageTop = 0;
    let stampWidth = 0;
    let stampHeight = 0;
    let stampSerial = 0;
    const stamps: PuffStamp[] = [];
    let isStamping = false;
    let lastStampedClientX = 0;
    let lastStampedClientY = 0;
    let lastPointerClientX = 0;
    let lastPointerClientY = 0;
    let pointerSeen = false;

    let onScreen = true;
    let dirty = true;
    let lastFrame = 0;
    let lastDraw = 0;
    let frameHandle = 0;
    let resizeFrameHandle = 0;
    let previewFrameHandle = 0;
    const started = performance.now();

    function configureStampCanvas(): boolean {
      const box = stage!.getBoundingClientRect();
      if (box.width < 1 || box.height < 1) return false;

      const pixelRatio = Math.min(
        window.devicePixelRatio || 1,
        STAMP_PIXEL_RATIO_LIMIT,
      );
      stampPageLeft = box.left + window.scrollX;
      stampPageTop = box.top + window.scrollY;
      stampWidth = box.width;
      stampHeight = box.height;
      stampCanvas!.width = Math.max(1, Math.round(box.width * pixelRatio));
      stampCanvas!.height = Math.max(1, Math.round(box.height * pixelRatio));
      stampContext = stampCanvas!.getContext("2d", {
        alpha: true,
        desynchronized: true,
      });
      if (!stampContext) return false;

      stampContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      stampContext.imageSmoothingEnabled = true;
      return true;
    }

    function captureStampSource(): StampSource | null {
      const box = mascot!.getBoundingClientRect();
      if (!lastInk || box.width < 1 || box.height < 1) return null;

      const pixelRatio = Math.min(
        window.devicePixelRatio || 1,
        STAMP_PIXEL_RATIO_LIMIT,
      );
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(box.width * pixelRatio));
      canvas.height = Math.max(1, Math.round(box.height * pixelRatio));
      const context = canvas.getContext("2d", { alpha: true });
      if (!context) return null;

      const inkStyle = getComputedStyle(ink!);
      const accentStyle = getComputedStyle(accent!);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.font = `${inkStyle.fontStyle} ${inkStyle.fontWeight} ${fontSize}px ${inkStyle.fontFamily}`;
      context.textAlign = "left";
      context.textBaseline = "top";

      context.fillStyle = inkStyle.color;
      for (const [row, line] of lastInk.split("\n").entries()) {
        context.fillText(line, 0, row * cellHeight);
      }
      context.fillStyle = accentStyle.color;
      for (const [row, line] of lastAccent.split("\n").entries()) {
        context.fillText(line, 0, row * cellHeight);
      }

      return { canvas, width: box.width, height: box.height };
    }

    function drawStamp(stamp: PuffStamp) {
      if (!stampContext || !stampSource) return;

      stampContext.save();
      stampContext.translate(stamp.x * stampWidth, stamp.y * stampHeight);
      stampContext.rotate(stamp.rotation);
      stampContext.scale(stamp.scale, stamp.scale);

      /* A faint second strike gives every copy a dry, double-fed edge. */
      stampContext.globalAlpha = stamp.opacity * 0.2;
      stampContext.drawImage(
        stampSource.canvas,
        -stampSource.width / 2 + stamp.ghostShiftX,
        -stampSource.height / 2 + stamp.ghostShiftY,
        stampSource.width,
        stampSource.height,
      );
      stampContext.globalAlpha = stamp.opacity;
      stampContext.drawImage(
        stampSource.canvas,
        -stampSource.width / 2,
        -stampSource.height / 2,
        stampSource.width,
        stampSource.height,
      );
      stampContext.restore();
    }

    function redrawStamps() {
      if (!stampContext) return;
      stampContext.clearRect(0, 0, stampWidth, stampHeight);
      for (const stamp of stamps) drawStamp(stamp);
    }

    function enqueueStamp(
      x: number,
      y: number,
      scaleMultiplier = 1,
      opacityMultiplier = 1,
    ) {
      if (!stampSource) return;

      const stamp = createPuffStamp(
        stampSerial++,
        x,
        y,
        scaleMultiplier,
        opacityMultiplier,
      );
      const halfWidth = (stampSource.width * stamp.scale) / 2;
      const halfHeight = (stampSource.height * stamp.scale) / 2;
      const centerX = Math.max(
        Math.min(halfWidth, stampWidth / 2),
        Math.min(stamp.x * stampWidth, stampWidth - halfWidth),
      );
      const centerY = Math.max(
        Math.min(halfHeight, stampHeight / 2),
        Math.min(stamp.y * stampHeight, stampHeight - halfHeight),
      );
      stamp.x = centerX / stampWidth;
      stamp.y = centerY / stampHeight;
      appendPuffStamp(stamps, stamp);
      stage!.dataset.puffStampCount = String(stamps.length);
    }

    function stampAtPointer(clientX: number, clientY: number) {
      const x = clientX + window.scrollX - stampPageLeft;
      const y = clientY + window.scrollY - stampPageTop;
      if (
        x < 0 ||
        x > stampWidth ||
        y < 0 ||
        y > stampHeight
      ) {
        return false;
      }

      enqueueStamp(x / stampWidth, y / stampHeight);
      redrawStamps();
      lastStampedClientX = clientX;
      lastStampedClientY = clientY;
      return true;
    }

    function positionStampPreview(clientX: number, clientY: number): boolean {
      if (!stampMode || !stampSource) return false;
      const x = clientX + window.scrollX - stampPageLeft;
      const y = clientY + window.scrollY - stampPageTop;
      const inside =
        x >= 0 && x <= stampWidth && y >= 0 && y <= stampHeight;
      if (!inside) {
        mascot!.style.visibility = "hidden";
        return false;
      }

      const turn = (x / stampWidth - 0.5) * 5;
      mascot!.style.transform = `translate3d(${x - stampSource.width / 2}px, ${y - stampSource.height / 2}px, 0) rotate(${turn}deg) scale(${STAMP_PREVIEW_SCALE})`;
      mascot!.style.visibility = "visible";
      return true;
    }

    function queueStampPreview() {
      if (previewFrameHandle !== 0) return;
      previewFrameHandle = requestAnimationFrame(() => {
        previewFrameHandle = 0;
        positionStampPreview(lastPointerClientX, lastPointerClientY);
      });
    }

    function resize() {
      const stageBox = stage!.getBoundingClientRect();
      const box = anchor!.getBoundingClientRect();
      if (box.width < 1 || box.height < 1) return;

      if (stampMode) {
        if (configureStampCanvas()) redrawStamps();
        if (pointerSeen) {
          positionStampPreview(lastPointerClientX, lastPointerClientY);
        }
        return;
      }

      mascot!.style.left = `${box.left - stageBox.left}px`;
      mascot!.style.top = `${box.top - stageBox.top}px`;
      mascot!.style.width = `${box.width}px`;
      mascot!.style.height = `${box.height}px`;

      /* Page coordinates avoid a layout read on every pointer event. */
      mascotCenterPageX = box.left + window.scrollX + box.width / 2;
      mascotCenterPageY = box.top + window.scrollY + box.height / 2;
      lookDepth = Math.max(box.width, box.height) * LOOK_DEPTH_RATIO;

      const advance = measureAdvance(ink!);
      cellAspect = advance / CELL_LINE_RATIO;
      cellWidth = Math.sqrt(
        (box.width * box.height * cellAspect) / cellBudget,
      );
      fontSize = cellWidth / advance;
      cellHeight = fontSize * CELL_LINE_RATIO;
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
        const elapsed =
          lastDraw === 0 ? FRAME_MS / 1000 : (now - lastDraw) / 1000;
        const step = Math.min(elapsed, 0.1);
        const yawDelta = targetYaw - lookYaw;
        const pitchDelta = targetPitch - lookPitch;

        const targetEyeYaw = Math.max(
          -EYE_YAW_LIMIT,
          Math.min(EYE_YAW_LIMIT, yawDelta),
        );
        const targetEyePitch = Math.max(
          -EYE_PITCH_LIMIT,
          Math.min(EYE_PITCH_LIMIT, pitchDelta),
        );
        const eyeEase = 1 - Math.exp(-EYE_RESPONSE * step);
        eyeYaw += (targetEyeYaw - eyeYaw) * eyeEase;
        eyePitch += (targetEyePitch - eyePitch) * eyeEase;

        bodyFollowing = pointerActive
          ? shouldBodyFollow(eyeYaw, eyePitch, bodyFollowing)
          : true;
        if (bodyFollowing) {
          const bodyEase = 1 - Math.exp(-BODY_RESPONSE * step);
          lookYaw += yawDelta * bodyEase;
          lookPitch += pitchDelta * bodyEase;
        }

        const pointerEase = 1 - Math.exp(-POINTER_RESPONSE * step);
        pointerEngagement +=
          ((pointerActive ? 1 : 0) - pointerEngagement) * pointerEase;
        squash *= Math.exp(-9 * elapsed);
      }
      lastDraw = now;

      const sway = still
        ? 0
        : Math.sin(time * SWAY_SPEED) *
          SWAY_AMPLITUDE *
          (1 - pointerEngagement * 0.8);
      const startedRender = performance.now();
      const frame = renderPuff(
        cols,
        rows,
        cellAspect,
        {
          time: still ? 1.2 : time,
          bob: still ? 0 : Math.sin(time * BOB_SPEED) * BOB_AMPLITUDE,
          squash,
          blink: still ? 1 : blinkAt(time),
          gazeX: still ? 0 : (eyeYaw / EYE_YAW_LIMIT) * EYE_GAZE_X,
          gazeY: still ? 0 : (-eyePitch / EYE_PITCH_LIMIT) * EYE_GAZE_Y,
        },
        { yaw: lookYaw + sway, pitch: lookPitch },
      );

      ink!.textContent = frame.ink;
      accent!.textContent = frame.accent;
      lastInk = frame.ink;
      lastAccent = frame.accent;

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
      if (stampMode) {
        frameHandle = 0;
        return;
      }
      frameHandle = requestAnimationFrame(tick);
      if (!onScreen || document.hidden || cols === 0) return;

      if (reduceMotion.matches && !dirty) return;
      if (now - lastFrame < FRAME_MS) return;

      lastFrame = now;
      dirty = false;
      draw(now);
    }

    function queueResize() {
      if (resizeFrameHandle !== 0) return;
      resizeFrameHandle = requestAnimationFrame(() => {
        resizeFrameHandle = 0;
        resize();
      });
    }

    function startStampPad(clientX: number, clientY: number): boolean {
      if (stampMode) return true;
      const source = captureStampSource();
      if (!source || !configureStampCanvas()) return false;

      stampSource = source;
      stampMode = true;
      stampCanvas!.hidden = false;
      mascot!.style.left = "0";
      mascot!.style.top = "0";
      mascot!.style.width = `${source.width}px`;
      mascot!.style.height = `${source.height}px`;
      mascot!.style.opacity = "0.24";
      mascot!.style.transformOrigin = "50% 50%";
      mascot!.style.zIndex = "1";

      for (const print of INITIAL_PRINTS) {
        enqueueStamp(print.x, print.y, print.scale, print.opacity);
      }
      redrawStamps();
      if (!reduceMotion.matches) {
        stampCanvas!.animate(
          [
            { opacity: 0 },
            { opacity: 0.9, offset: 0.34 },
            { opacity: 0.45, offset: 0.58 },
            { opacity: 1 },
          ],
          { duration: 260, easing: "steps(3, end)" },
        );
      }

      stage!.dataset.puffMode = "stamp-pad";
      stage!.setAttribute(
        "aria-label",
        "Puff stamp pad: click or drag through the hero to print ASCII copies.",
      );
      cancelAnimationFrame(frameHandle);
      frameHandle = 0;
      positionStampPreview(clientX, clientY);
      return true;
    }

    function onPointerMove(event: PointerEvent) {
      if (event.pointerType === "touch") return;
      lastPointerClientX = event.clientX;
      lastPointerClientY = event.clientY;
      pointerSeen = true;

      if (stampMode) {
        const x = event.clientX + window.scrollX - stampPageLeft;
        const y = event.clientY + window.scrollY - stampPageTop;
        const inside =
          x >= 0 && x <= stampWidth && y >= 0 && y <= stampHeight;
        queueStampPreview();
        const dragSpacing = Math.max(
          48,
          (stampSource?.width ?? 0) * STAMP_PREVIEW_SCALE * 0.32,
        );
        if (
          isStamping &&
          inside &&
          Math.hypot(
            event.clientX - lastStampedClientX,
            event.clientY - lastStampedClientY,
          ) >= dragSpacing
        ) {
          stampAtPointer(event.clientX, event.clientY);
        }
        return;
      }

      const dx = event.clientX + window.scrollX - mascotCenterPageX;
      const dy = event.clientY + window.scrollY - mascotCenterPageY;
      targetYaw = Math.max(
        -LOOK_YAW,
        Math.min(LOOK_YAW, Math.atan2(dx, lookDepth)),
      );
      targetPitch = Math.max(
        -LOOK_PITCH,
        Math.min(LOOK_PITCH, Math.atan2(dy, lookDepth)),
      );
      pointerActive = true;
    }

    function onPointerDown(event: PointerEvent) {
      if (!stampMode || event.pointerType === "touch" || event.button !== 0) {
        return;
      }
      if (stampAtPointer(event.clientX, event.clientY)) {
        /* The hero becomes a pad in this mode; do not select headline text
           underneath it while the visitor drags a run of prints. */
        event.preventDefault();
        isStamping = true;
      }
    }

    function stopStamping() {
      isStamping = false;
    }

    function onStageClick(event: MouseEvent) {
      if (stampMode || !desktopEasterEgg.matches || !lastInk) return;

      const box = mascot!.getBoundingClientRect();
      const col = Math.floor((event.clientX - box.left) / cellWidth);
      const row = Math.floor((event.clientY - box.top) / cellHeight);
      if (col < 0 || col >= cols || row < 0 || row >= rows) return;

      const textIndex = row * (cols + 1) + col;
      if (lastInk[textIndex] === " " && lastAccent[textIndex] === " ") return;

      squash = Math.min(1, squash + 0.32);
      easterEggClicks++;
      if (
        easterEggClicks >= EASTER_EGG_CLICKS &&
        !startStampPad(event.clientX, event.clientY)
      ) {
        easterEggClicks = EASTER_EGG_CLICKS - 1;
      }
    }

    function resetPointer() {
      stopStamping();
      if (stampMode) {
        cancelAnimationFrame(previewFrameHandle);
        previewFrameHandle = 0;
        mascot!.style.visibility = "hidden";
        return;
      }
      targetYaw = REST_YAW;
      targetPitch = 0;
      pointerActive = false;
    }

    function onPointerOut(event: PointerEvent) {
      if (event.relatedTarget === null) resetPointer();
    }

    const onMotionPreferenceChange = () => {
      if (!stampMode) dirty = true;
    };

    const observer = new ResizeObserver(queueResize);
    observer.observe(stage);
    observer.observe(anchor);
    const visibility = new IntersectionObserver(
      ([entry]) => {
        onScreen = entry.isIntersecting;
      },
      { rootMargin: "120px" },
    );
    visibility.observe(stage);

    resize();
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", stopStamping, { passive: true });
    window.addEventListener("pointercancel", stopStamping, { passive: true });
    window.addEventListener("pointerout", onPointerOut, { passive: true });
    window.addEventListener("blur", resetPointer);
    window.addEventListener("resize", queueResize, { passive: true });
    window.addEventListener("click", onStageClick);
    reduceMotion.addEventListener("change", onMotionPreferenceChange);
    frameHandle = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frameHandle);
      cancelAnimationFrame(resizeFrameHandle);
      cancelAnimationFrame(previewFrameHandle);
      observer.disconnect();
      visibility.disconnect();
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", stopStamping);
      window.removeEventListener("pointercancel", stopStamping);
      window.removeEventListener("pointerout", onPointerOut);
      window.removeEventListener("blur", resetPointer);
      window.removeEventListener("resize", queueResize);
      window.removeEventListener("click", onStageClick);
      reduceMotion.removeEventListener("change", onMotionPreferenceChange);

      mascot.style.visibility = "";
      mascot.style.opacity = "";
      mascot.style.transform = "";
      mascot.style.transformOrigin = "";
      mascot.style.zIndex = "";
      stampCanvas.hidden = true;
      if (initialAriaLabel === null) stage.removeAttribute("aria-label");
      else stage.setAttribute("aria-label", initialAriaLabel);
      delete stage.dataset.puffMode;
      delete stage.dataset.puffStampCount;
    };
  }, [anchorId]);

  return (
    <div
      ref={stageRef}
      role="img"
      aria-label="HAM's mascot: a small round creature covered in fur, with a loop of red marker curling off its head."
      className={`overflow-hidden select-none ${className ?? ""}`}
    >
      <canvas
        ref={stampCanvasRef}
        hidden
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full"
      />
      {/* The two text layers stay live before discovery and become the preview. */}
      <div ref={mascotRef} className="pointer-events-none absolute">
        <pre
          ref={inkRef}
          aria-hidden="true"
          className="font-mono absolute inset-0 m-0 text-ink"
        />
        <pre
          ref={accentRef}
          aria-hidden="true"
          className="font-mono absolute inset-0 m-0 text-decorative-red"
        />
      </div>
    </div>
  );
}
