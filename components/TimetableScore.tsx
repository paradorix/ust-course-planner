"use client";

/**
 * The body of /rate: a schedule-shape score for the current timetable,
 * however it got built — solver output or entirely hand-pinned. Reads
 * lib/preferences.ts directly rather than the solver's own objective, so a
 * timetable nobody ever ran "Generate" on still scores (see that file's
 * header for why the two are deliberately decoupled).
 *
 * Labelled "Preference match", not "your score" — it measures fit to what
 * was asked for, nothing more. That precision matters because
 * DEFAULT_PREFERENCES is inert on several axes: an unconfigured timetable
 * can read 100 no matter how the week actually looks. The comments below
 * (lib/comments.ts) exist specifically to stay honest in that case — they
 * describe the schedule's own geometry and never read the score.
 *
 * Instructor ratings sit in their own block below, visually separated from
 * the number — the score measures schedule shape only. Folding professors
 * into it would repeat the mistake this update explicitly avoided for the
 * course list view: there is no defensible way to average six differently-
 * scaled criteria (lib/rating.ts) into one figure.
 */

import RatingBadge from "@/components/RatingBadge";
import ScoreReveal from "@/components/ScoreReveal";
import type { Chip } from "@/components/Planner";
import { buildComments } from "@/lib/comments";
import type { PlacedSection } from "@/lib/conflicts";
import { scoreTimetable, type Preferences } from "@/lib/preferences";

function minutesLabel(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export default function TimetableScore({
  placed,
  prefs,
  liveOpen,
  instructorChips,
}: {
  placed: PlacedSection[];
  prefs: Preferences;
  liveOpen: Record<number, boolean>;
  instructorChips: (name: string) => Chip[];
}) {
  if (placed.length === 0) return null;

  const breakdown = scoreTimetable(placed, prefs, liveOpen);
  const comments = buildComments(breakdown, placed);
  const instructorNames = [
    ...new Set(placed.flatMap((p) => p.section.meetings.flatMap((m) => m.instructors))),
  ];

  return (
    <div className="rounded-lg bg-surface ring-1 ring-border-subtle p-3">
      <div className="flex items-center justify-between">
        <h2
          className="text-sm font-semibold"
          title="How well this timetable fits the preferences you set — not a judgement of the schedule itself"
        >
          Preference match
        </h2>
        <ScoreReveal value={breakdown.score} />
      </div>

      <p className="mt-1 text-[11px] text-muted">
        {breakdown.daysOnCampus} day{breakdown.daysOnCampus === 1 ? "" : "s"} on campus
        {breakdown.earliestStartMinutes !== null && breakdown.latestEndMinutes !== null
          ? ` · ${minutesLabel(breakdown.earliestStartMinutes)}–${minutesLabel(breakdown.latestEndMinutes)}`
          : ""}
        {" · "}
        {breakdown.gapMinutes} idle min between classes
      </p>

      <ul className="mt-2 space-y-1 text-[11px] text-foreground/80">
        {comments.map((c) => (
          <li key={c.id}>{c.text}</li>
        ))}
      </ul>

      {instructorNames.length > 0 ? (
        <div className="mt-3 space-y-1 border-t border-border-subtle pt-2">
          <p className="text-[10px] text-muted">
            Instructors — separate from the score above, averaged across all their courses.
          </p>
          {instructorNames.map((name) => (
            <div key={name} className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="text-foreground/90">{name}</span>
              {instructorChips(name).map((chip) => (
                <RatingBadge
                  key={chip.key}
                  score={chip.score}
                  label={chip.label}
                  scale="instructors"
                />
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
