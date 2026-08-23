"use client";

/**
 * Contrastive alternatives to the current timetable: one per preference the
 * student actually set, showing the best result if that one thing were
 * relaxed. This is the only relaxation mechanism in the app (lib/
 * alternatives.ts) — there's no separate "why didn't I get everything"
 * dead end, because this list answers it directly, with a real timetable
 * attached rather than an error message.
 */

import type { Alternative } from "@/lib/alternatives";

export default function AlternativesList({
  alternatives,
  onApply,
}: {
  alternatives: Alternative[];
  onApply: (alt: Alternative) => void;
}) {
  if (alternatives.length === 0) return null;

  return (
    <div className="rounded-lg bg-surface ring-1 ring-border-subtle p-3">
      <h2 className="mb-2 text-sm font-semibold">Alternatives</h2>
      <div className="space-y-2">
        {alternatives.map((alt) => (
          <div
            key={alt.key}
            className="flex items-center justify-between gap-2 rounded-md bg-surface-raised p-2 text-xs ring-1 ring-border-subtle"
          >
            <div className="min-w-0">
              <p className="truncate font-medium text-foreground/90">{alt.label}</p>
              <p className="text-[11px] text-muted">
                Score {alt.result.breakdown.score}
                {alt.result.breakdown.violations.length > 0
                  ? ` · ${alt.result.breakdown.violations.length} other trade-off${
                      alt.result.breakdown.violations.length === 1 ? "" : "s"
                    }`
                  : " · meets everything else"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onApply(alt)}
              className="shrink-0 rounded-md bg-sky-500/15 px-2.5 py-1 text-[11px] font-medium text-sky-200 ring-1 ring-sky-500/40 hover:bg-sky-500/25"
            >
              Use this
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
