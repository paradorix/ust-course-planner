"use client";

/**
 * A single rating chip.
 *
 * The `null` case is deliberately loud rather than blank: a missing rating
 * must never look like a bad one. There is no zero, no empty star row, and no
 * greyed-out bar that reads as "rated poorly".
 */

import { badgeClasses, type Scored } from "@/lib/rating";

export default function RatingBadge({
  score,
  label,
  compact = false,
}: {
  score: Scored | null;
  label?: string;
  compact?: boolean;
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

  const { letter, percentile, value, thin } = score;

  return (
    <span
      title={`${label ? `${label}: ` : ""}${letter} · top ${(100 - percentile).toFixed(0)}%${
        thin ? ` · only ${value.samples} response${value.samples === 1 ? "" : "s"}` : ""
      }`}
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset tabular-nums ${badgeClasses(
        percentile,
      )}`}
    >
      {label ? <span className="font-normal opacity-70">{label}</span> : null}
      <span>{letter}</span>
      {!compact ? <span className="opacity-70">{percentile.toFixed(0)}%</span> : null}
      {thin ? (
        <span title="Few responses behind this score" className="opacity-70">
          ⚠
        </span>
      ) : null}
    </span>
  );
}
