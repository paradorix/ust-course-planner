"use client";

/**
 * A single rating chip.
 *
 * The `null` case is deliberately loud rather than blank: a missing rating
 * must never look like a bad one. There is no zero, no empty star row, and no
 * greyed-out bar that reads as "rated poorly".
 *
 * Course and instructor chips share a letter vocabulary but are ranked
 * against different populations, so `scale` names the population in the
 * tooltip. The chips themselves stay terse — the surrounding UI states the
 * distinction once in words rather than repeating it on every chip.
 */

import { badgeClasses, type Scored } from "@/lib/rating";

export default function RatingBadge({
  score,
  label,
  scale = "courses",
}: {
  score: Scored | null;
  label?: string;
  scale?: "courses" | "instructors";
}) {
  if (!score) {
    return (
      <span
        title="No rating data for this — not a low rating."
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] ring-1 ring-inset ring-border-subtle text-muted"
      >
        {label ? <span className="opacity-70">{label}</span> : null}
        no rating data
      </span>
    );
  }

  const { letter, percentile, thin, population } = score;

  const rank = population
    ? ` · ${percentile.toFixed(0)}th percentile of ${population} ${scale} this term`
    : "";
  const scopeNote =
    scale === "instructors" ? " · across all their courses, not just this one" : "";
  const thinNote = thin ? " · based on relatively little feedback" : "";

  return (
    <span
      title={`${label ? `${label}: ` : ""}${letter}${rank}${scopeNote}${thinNote}`}
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset tabular-nums ${badgeClasses(
        percentile,
      )}`}
    >
      {label ? <span className="font-normal opacity-70">{label}</span> : null}
      <span>{letter}</span>
      <span className="opacity-70">{percentile.toFixed(0)}%</span>
      {thin ? (
        <span title="Based on relatively little feedback" className="opacity-70">
          ⚠
        </span>
      ) : null}
    </span>
  );
}
