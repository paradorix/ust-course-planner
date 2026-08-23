"use client";

/**
 * Animated reveal of the preference-match number on /rate.
 *
 * Counts up over ~900ms on a student's first visit to /rate each browser
 * session (gated on sessionStorage) — after that, every reload within the
 * same session renders the final value immediately. The point is arriving
 * at a number, not making someone sit through the same animation on a
 * fourth reload.
 *
 * prefers-reduced-motion gets a short opacity fade instead of the count-up
 * — a transition, not motion — mirroring the reduced-motion treatment
 * already given to the clash-flash overlay in app/globals.css. Either way
 * the final value is always present in the DOM with aria-live="polite", so
 * screen readers and anyone skimming past never wait on the animation.
 *
 * The reveal plays once per mount by design — applying an alternative
 * navigates back to the planner rather than re-scoring in place, so this
 * component is never asked to animate a second time without a fresh page.
 *
 * The mode (count / fade / instant) is decided once, into a ref, rather
 * than re-derived from sessionStorage on every effect run. Dev-mode Strict
 * Mode mounts, cleans up, and re-mounts every effect once as a matter of
 * course — with the sessionStorage check inline in the effect body, that
 * throwaway first run would itself mark the reveal "seen" before the real
 * run ever executed, so the real run would see the flag already set and
 * skip the animation entirely (silently, no error — it would just never
 * play). Deciding the mode once and re-reading it from the ref keeps the
 * second, real run consistent with the first.
 */

import { useEffect, useRef, useState } from "react";

const SESSION_KEY = "ust-course-planner:rate-seen";
const COUNT_MS = 900;
const FADE_MS = 250;

type Mode = "count" | "fade" | "instant";

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function hasSeenReveal(): boolean {
  try {
    return window.sessionStorage.getItem(SESSION_KEY) === "1";
  } catch {
    // Private mode / quota failure — can't remember either way, so default
    // to "seen" rather than forcing the animation on every single visit.
    return true;
  }
}

function markRevealSeen(): void {
  try {
    window.sessionStorage.setItem(SESSION_KEY, "1");
  } catch {
    // Non-fatal — this visit still gets its one animation.
  }
}

export default function ScoreReveal({ value }: { value: number }) {
  const [display, setDisplay] = useState(value);
  const elRef = useRef<HTMLSpanElement>(null);
  const modeRef = useRef<Mode | null>(null);

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;

    if (modeRef.current === null) {
      if (hasSeenReveal()) {
        modeRef.current = "instant";
      } else {
        markRevealSeen();
        const reduceMotion =
          window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
        modeRef.current = reduceMotion ? "fade" : "count";
      }
    }

    if (modeRef.current === "instant") return;

    if (modeRef.current === "fade") {
      // Driven by direct style mutation, not React state — the number never
      // counts, only its opacity moves, so there's nothing here for
      // setState to own.
      el.style.opacity = "0";
      const raf = requestAnimationFrame(() => {
        el.style.transition = `opacity ${FADE_MS}ms ease-out`;
        el.style.opacity = "1";
      });
      return () => cancelAnimationFrame(raf);
    }

    let frame: number;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / COUNT_MS);
      setDisplay(Math.round(value * easeOutCubic(t)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return (
    <span
      ref={elRef}
      aria-live="polite"
      className="text-4xl font-bold tabular-nums text-sky-300"
    >
      {display}
    </span>
  );
}
