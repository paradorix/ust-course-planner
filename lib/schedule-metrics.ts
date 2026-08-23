/**
 * Pure geometry over a set of scheduled sections — how compact the week is,
 * not how good the courses are. Deliberately knows nothing about ratings,
 * preferences, or a student's intent; lib/preferences.ts is the layer that
 * turns these numbers into a score against what someone actually wants.
 *
 * Shared by the solver's objective (lib/solver.ts) and the rate-my-timetable
 * UI, so a hand-built timetable and a generated one are measured identically.
 */

import { toMinutes, type PlacedSection } from "./conflicts.ts";
import { WEEKDAYS, type Weekday } from "./types.ts";

interface Interval {
  from: number;
  to: number;
}

function intervalsByDay(placed: PlacedSection[]): Map<Weekday, Interval[]> {
  const byDay = new Map<Weekday, Interval[]>();
  for (const p of placed) {
    for (const m of p.section.meetings) {
      const list = byDay.get(m.weekday);
      const interval = { from: toMinutes(m.timeFrom), to: toMinutes(m.timeTo) };
      if (list) list.push(interval);
      else byDay.set(m.weekday, [interval]);
    }
  }
  return byDay;
}

/** Every weekday with at least one meeting, in WEEKDAYS order. */
export function daysUsed(placed: PlacedSection[]): Weekday[] {
  const set = new Set<Weekday>();
  for (const p of placed) for (const m of p.section.meetings) set.add(m.weekday);
  return WEEKDAYS.filter((d) => set.has(d));
}

export function daysOnCampus(placed: PlacedSection[]): number {
  return daysUsed(placed).length;
}

/** Earliest meeting start, in minutes since midnight. Null with no meetings at all. */
export function earliestStart(placed: PlacedSection[]): number | null {
  let min: number | null = null;
  for (const p of placed) {
    for (const m of p.section.meetings) {
      const t = toMinutes(m.timeFrom);
      if (min === null || t < min) min = t;
    }
  }
  return min;
}

/** Latest meeting end, in minutes since midnight. Null with no meetings at all. */
export function latestEnd(placed: PlacedSection[]): number | null {
  let max: number | null = null;
  for (const p of placed) {
    for (const m of p.section.meetings) {
      const t = toMinutes(m.timeTo);
      if (max === null || t > max) max = t;
    }
  }
  return max;
}

/**
 * Total idle minutes between meetings, summed across days the student is
 * on campus. Overlapping or back-to-back meetings on the same day are merged
 * first, so a lecture immediately followed by its tutorial contributes no gap.
 */
export function totalGapMinutes(placed: PlacedSection[]): number {
  let total = 0;
  for (const intervals of intervalsByDay(placed).values()) {
    intervals.sort((a, b) => a.from - b.from);
    let mergedEnd: number | null = null;
    for (const iv of intervals) {
      if (mergedEnd !== null && iv.from > mergedEnd) total += iv.from - mergedEnd;
      mergedEnd = mergedEnd === null ? iv.to : Math.max(mergedEnd, iv.to);
    }
  }
  return total;
}

/** The single longest on-campus day, from first start to last end, in minutes. */
export function longestDayMinutes(placed: PlacedSection[]): number {
  let longest = 0;
  for (const intervals of intervalsByDay(placed).values()) {
    const from = Math.min(...intervals.map((i) => i.from));
    const to = Math.max(...intervals.map((i) => i.to));
    longest = Math.max(longest, to - from);
  }
  return longest;
}
