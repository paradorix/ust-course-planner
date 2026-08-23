/**
 * Rate-my-timetable commentary: short, factual lines describing the shape of
 * a timetable. Reads only lib/preferences.ts's ScoreBreakdown and the placed
 * sections — never the score number.
 *
 * That restriction is what keeps a comment true when DEFAULT_PREFERENCES is
 * in effect (see lib/preferences.ts): with nothing set, every axis is
 * inert and the score is 100 regardless of how the week actually looks. A
 * comment built from the score would inherit that hollowness; one built
 * from the breakdown's raw geometry does not — a punishing 5-day week
 * starting at 08:00 still gets called out here even when nothing "failed".
 *
 * Each line states a fact, never an adjective of judgment ("heavy",
 * "brutal", "great"). "5 days on campus" lets the reader supply their own
 * norm; the thresholds below only decide whether a fact is worth
 * mentioning, not whether it's good or bad. Where a preference violation
 * already names the same axis (e.g. maxDays), the independent threshold
 * comment for that axis is skipped so the violations list ("breaks: ...")
 * and this one don't just restate each other.
 */

import type { PlacedSection } from "./conflicts.ts";
import type { PreferenceKey, ScoreBreakdown, Violation } from "./preferences.ts";

export interface Comment {
  id: string;
  text: string;
}

const DAYS_THRESHOLD = 5;
const LATE_END_MINUTES = 18 * 60;
const EARLY_START_MINUTES = 9 * 60;
const GAP_THRESHOLD_MINUTES = 120;

function hasViolation(violations: Violation[], key: PreferenceKey): boolean {
  return violations.some((v) => v.key === key);
}

function formatMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function formatDuration(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function buildComments(breakdown: ScoreBreakdown, placed: PlacedSection[]): Comment[] {
  if (placed.length === 0) {
    return [{ id: "empty", text: "Nothing is on this timetable yet." }];
  }

  const comments: Comment[] = [];

  if (breakdown.daysOnCampus >= DAYS_THRESHOLD && !hasViolation(breakdown.violations, "maxDays")) {
    comments.push({
      id: "daysOnCampus",
      text: `${breakdown.daysOnCampus} days on campus — ${breakdown.daysUsed.join(", ")}.`,
    });
  }

  if (
    breakdown.latestEndMinutes !== null &&
    breakdown.latestEndMinutes > LATE_END_MINUTES &&
    !hasViolation(breakdown.violations, "latestEnd")
  ) {
    comments.push({
      id: "lateEnd",
      text: `Runs as late as ${formatMinutes(breakdown.latestEndMinutes)}.`,
    });
  }

  if (
    breakdown.earliestStartMinutes !== null &&
    breakdown.earliestStartMinutes < EARLY_START_MINUTES &&
    !hasViolation(breakdown.violations, "earliestStart")
  ) {
    comments.push({
      id: "earlyStart",
      text: `Starts as early as ${formatMinutes(breakdown.earliestStartMinutes)}.`,
    });
  }

  if (
    breakdown.gapMinutes >= GAP_THRESHOLD_MINUTES &&
    !hasViolation(breakdown.violations, "compactness")
  ) {
    comments.push({
      id: "gaps",
      text: `${formatDuration(breakdown.gapMinutes)} of idle time between classes across the week.`,
    });
  }

  // Preference violations are already facts about this exact timetable — a
  // student who did set preferences should see why they weren't fully met
  // here too, not only in the separate "breaks:" list next to the score.
  for (const v of breakdown.violations) {
    comments.push({ id: `violation-${v.key}`, text: v.detail });
  }

  if (comments.length === 0) {
    comments.push({
      id: "clean",
      text: "No day starts before 09:00, ends after 18:00, or leaves a 2-hour-plus gap.",
    });
  }

  return comments;
}
