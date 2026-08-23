/**
 * Contrastive alternatives: for each preference the student actually set,
 * what's the best timetable if that one thing were relaxed?
 *
 * This is deliberately the only relaxation mechanism in the app — there is
 * no separate "which preference is blocking you" computation. Re-solving
 * once per axis and reporting what changed answers both "why didn't I get
 * everything" and "what are my other options" with the same result.
 */

import { toMinutes, type PlacedSection } from "./conflicts.ts";
import type { Preferences, PreferenceKey } from "./preferences.ts";
import { solve, type SolveOptions, type SolveResult } from "./solver.ts";
import type { Course, Weekday } from "./types.ts";

export interface Alternative {
  key: PreferenceKey;
  /** e.g. "best if you allowed Fridays". */
  label: string;
  result: SolveResult;
  /** The relaxed preferences that produced this alternative — adopt them
   *  wholesale if the student picks it, so the score shown afterward
   *  doesn't immediately flag the very trade-off they just chose. */
  prefs: Preferences;
}

function minutesToHHMM(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function sameTimetable(a: PlacedSection[], b: PlacedSection[]): boolean {
  if (a.length !== b.length) return false;
  const numbers = new Set(a.map((p) => p.section.number));
  return b.every((p) => numbers.has(p.section.number));
}

interface Axis {
  key: PreferenceKey;
  label: string;
  relax: (p: Preferences) => Preferences;
}

function axesFor(prefs: Preferences): Axis[] {
  const axes: Axis[] = [];

  if (prefs.earliestStart !== null) {
    const shifted = minutesToHHMM(Math.max(0, toMinutes(prefs.earliestStart) - 60));
    axes.push({
      key: "earliestStart",
      label: `best if you started at ${shifted}`,
      relax: (p) => ({ ...p, earliestStart: shifted }),
    });
  }

  if (prefs.latestEnd !== null) {
    const shifted = minutesToHHMM(Math.min(23 * 60 + 59, toMinutes(prefs.latestEnd) + 60));
    axes.push({
      key: "latestEnd",
      label: `best if you ended at ${shifted}`,
      relax: (p) => ({ ...p, latestEnd: shifted }),
    });
  }

  if (prefs.maxDays !== null) {
    const next = prefs.maxDays + 1;
    axes.push({
      key: "maxDays",
      label: `best with ${next} day${next === 1 ? "" : "s"} on campus`,
      relax: (p) => ({ ...p, maxDays: next }),
    });
  }

  for (const day of prefs.blockedDays) {
    axes.push({
      key: "blockedDays",
      label: `best if you allowed ${day}`,
      relax: (p) => ({ ...p, blockedDays: p.blockedDays.filter((d: Weekday) => d !== day) }),
    });
  }

  if (prefs.preferOpenSeats) {
    axes.push({
      key: "openSeats",
      label: "best ignoring seat availability",
      relax: (p) => ({ ...p, preferOpenSeats: false }),
    });
  }

  if (prefs.preferCompact) {
    axes.push({
      key: "compactness",
      label: "best ignoring gaps between classes",
      relax: (p) => ({ ...p, preferCompact: false }),
    });
  }

  return axes;
}

/**
 * One alternative per preference axis currently in use. An axis is omitted
 * if relaxing it doesn't actually change the winning timetable — showing it
 * would just be the current pick again, wearing a different label.
 */
export function contrastiveAlternatives(
  courses: Course[],
  wantedCodes: string[],
  pinnedNumbers: number[],
  prefs: Preferences,
  current: SolveResult | null,
  opts: SolveOptions = {},
): Alternative[] {
  const alternatives: Alternative[] = [];
  for (const axis of axesFor(prefs)) {
    const relaxedPrefs = axis.relax(prefs);
    const outcome = solve(courses, wantedCodes, pinnedNumbers, relaxedPrefs, opts);
    const top = outcome.results[0];
    if (!top) continue;
    if (current && sameTimetable(top.placed, current.placed)) continue;
    alternatives.push({ key: axis.key, label: axis.label, result: top, prefs: relaxedPrefs });
  }
  return alternatives;
}
