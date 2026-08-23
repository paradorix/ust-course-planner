/**
 * Turns raw schedule geometry (lib/schedule-metrics.ts) into a score against
 * one student's stated preferences.
 *
 * This never throws and never refuses to score an unsatisfiable combination
 * — an over-constrained input is the normal case here, not an error state.
 * A violated preference just costs points and is reported by name in
 * `violations`, so the caller (the solver's objective, or the rate-my-
 * timetable UI) can always show something concrete, with the trade-off
 * visible rather than hidden behind a blank "no results" screen.
 *
 * Deliberately decoupled from lib/solver.ts: this scores ANY set of placed
 * sections, hand-built or generated, so "rate my timetable" works even when
 * no preferences were ever set (DEFAULT_PREFERENCES is intentionally inert).
 */

import { toMinutes, type PlacedSection } from "./conflicts.ts";
import {
  daysUsed,
  earliestStart,
  latestEnd,
  longestDayMinutes,
  totalGapMinutes,
} from "./schedule-metrics.ts";
import type { Weekday } from "./types.ts";

export type PreferenceKey =
  | "earliestStart"
  | "latestEnd"
  | "maxDays"
  | "blockedDays"
  | "openSeats"
  | "compactness";

export interface Preferences {
  /** "HH:MM" — no meeting should start earlier than this. Null = no opinion. */
  earliestStart: string | null;
  /** "HH:MM" — no meeting should end later than this. Null = no opinion. */
  latestEnd: string | null;
  /** Most days on campus wanted. Null = no opinion. */
  maxDays: number | null;
  /** Days the student cannot attend at all. */
  blockedDays: Weekday[];
  /** Prefer sections currently showing open seats over full ones. */
  preferOpenSeats: boolean;
  /** Prefer fewer idle minutes between classes on the same day. */
  preferCompact: boolean;
}

/** Inert on every axis — scoring against this never penalizes anything. */
export const DEFAULT_PREFERENCES: Preferences = {
  earliestStart: null,
  latestEnd: null,
  maxDays: null,
  blockedDays: [],
  preferOpenSeats: true,
  preferCompact: true,
};

export interface Violation {
  key: PreferenceKey;
  /** Human-readable, e.g. "starts 09:00 — you wanted 10:00". */
  detail: string;
  /** Points lost to this violation. Larger means it mattered more. */
  cost: number;
}

export interface ScoreBreakdown {
  /** 0–100. Only comparable across timetables scored against the same preferences. */
  score: number;
  daysOnCampus: number;
  daysUsed: Weekday[];
  earliestStartMinutes: number | null;
  latestEndMinutes: number | null;
  gapMinutes: number;
  longestDayMinutes: number;
  violations: Violation[];
}

// Soft costs, tuned so no single axis dominates unless it is violated by a
// lot (e.g. starting three hours earlier than asked beats one blocked day).
const MINUTE_COST = 0.4;
const DAY_OVER_COST = 12;
const BLOCKED_DAY_COST = 25;
const CLOSED_SECTION_COST = 15;
const GAP_MINUTE_COST = 0.05;

function formatMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Score one timetable against one set of preferences.
 *
 * `liveOpen` maps class number to the live open/closed status from
 * /api/seats; a section missing from it falls back to its daily snapshot
 * (`section.snapshotOpen`), the same fallback SectionRow already uses.
 */
export function scoreTimetable(
  placed: PlacedSection[],
  prefs: Preferences,
  liveOpen: Record<number, boolean> = {},
): ScoreBreakdown {
  const violations: Violation[] = [];
  const days = daysUsed(placed);
  const start = earliestStart(placed);
  const end = latestEnd(placed);
  const gaps = totalGapMinutes(placed);
  const longest = longestDayMinutes(placed);
  let penalty = 0;

  if (prefs.earliestStart !== null && start !== null) {
    const wanted = toMinutes(prefs.earliestStart);
    if (start < wanted) {
      const cost = (wanted - start) * MINUTE_COST;
      penalty += cost;
      violations.push({
        key: "earliestStart",
        detail: `starts ${formatMinutes(start)} — you wanted ${prefs.earliestStart}`,
        cost,
      });
    }
  }

  if (prefs.latestEnd !== null && end !== null) {
    const wanted = toMinutes(prefs.latestEnd);
    if (end > wanted) {
      const cost = (end - wanted) * MINUTE_COST;
      penalty += cost;
      violations.push({
        key: "latestEnd",
        detail: `ends ${formatMinutes(end)} — you wanted ${prefs.latestEnd}`,
        cost,
      });
    }
  }

  if (prefs.maxDays !== null && days.length > prefs.maxDays) {
    const over = days.length - prefs.maxDays;
    const cost = over * DAY_OVER_COST;
    penalty += cost;
    violations.push({
      key: "maxDays",
      detail: `${days.length} days on campus — you wanted at most ${prefs.maxDays}`,
      cost,
    });
  }

  const blockedHit = days.filter((d) => prefs.blockedDays.includes(d));
  if (blockedHit.length > 0) {
    const cost = blockedHit.length * BLOCKED_DAY_COST;
    penalty += cost;
    violations.push({
      key: "blockedDays",
      detail: `meets on ${blockedHit.join(", ")} — you blocked ${
        blockedHit.length === 1 ? "that day" : "those days"
      }`,
      cost,
    });
  }

  if (prefs.preferOpenSeats) {
    const closed = placed.filter((p) => {
      const open = liveOpen[p.section.number] ?? p.section.snapshotOpen;
      return open === false;
    });
    if (closed.length > 0) {
      const cost = closed.length * CLOSED_SECTION_COST;
      penalty += cost;
      violations.push({
        key: "openSeats",
        detail: `${closed.length} section${closed.length === 1 ? "" : "s"} showing full`,
        cost,
      });
    }
  }

  if (prefs.preferCompact && gaps > 0) {
    const cost = gaps * GAP_MINUTE_COST;
    penalty += cost;
    violations.push({
      key: "compactness",
      detail: `${gaps} idle minute${gaps === 1 ? "" : "s"} between classes`,
      cost,
    });
  }

  // Decays smoothly toward 0 rather than clamping abruptly, so two heavily
  // violated timetables can still be told apart instead of both reading 0.
  const score = Math.max(0, Math.round(100 / (1 + penalty / 100)));

  return {
    score,
    daysOnCampus: days.length,
    daysUsed: days,
    earliestStartMinutes: start,
    latestEndMinutes: end,
    gapMinutes: gaps,
    longestDayMinutes: longest,
    violations: violations.sort((a, b) => b.cost - a.cost),
  };
}
