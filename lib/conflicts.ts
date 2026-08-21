/**
 * Timetable conflict detection.
 *
 * Two meetings clash only if all three of these overlap: the weekday, the
 * time range, and the date window. The date window matters — plenty of HKUST
 * classes run for only part of a term, so two sections can share a Tuesday
 * 10:30 slot without ever colliding in practice.
 */

import type { Meeting, Section } from "./types.ts";

/** "HH:MM" → minutes since midnight. */
export function toMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

/** Half-open overlap: a block ending at 11:50 does not clash with one starting then. */
function rangesOverlap(aFrom: number, aTo: number, bFrom: number, bTo: number): boolean {
  return aFrom < bTo && bFrom < aTo;
}

export function meetingsClash(a: Meeting, b: Meeting): boolean {
  if (a.weekday !== b.weekday) return false;

  // Date windows are inclusive on both ends, so compare with <=.
  if (a.dateFrom > b.dateTo || b.dateFrom > a.dateTo) return false;

  return rangesOverlap(
    toMinutes(a.timeFrom),
    toMinutes(a.timeTo),
    toMinutes(b.timeFrom),
    toMinutes(b.timeTo),
  );
}

export interface Clash {
  a: { code: string; section: string };
  b: { code: string; section: string };
  weekday: string;
  detail: string;
}

export interface PlacedSection {
  code: string;
  section: Section;
}

/** Every pairwise clash among the chosen sections. */
export function findClashes(placed: PlacedSection[]): Clash[] {
  const clashes: Clash[] = [];

  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const left = placed[i];
      const right = placed[j];

      for (const a of left.section.meetings) {
        for (const b of right.section.meetings) {
          if (!meetingsClash(a, b)) continue;
          clashes.push({
            a: { code: left.code, section: left.section.section },
            b: { code: right.code, section: right.section.section },
            weekday: a.weekday,
            detail: `${a.weekday} ${a.timeFrom}–${a.timeTo} vs ${b.timeFrom}–${b.timeTo}`,
          });
        }
      }
    }
  }

  // One pair can clash on several meetings; report each pair once.
  const seen = new Set<string>();
  return clashes.filter((c) => {
    const key = `${c.a.code}${c.a.section}|${c.b.code}${c.b.section}|${c.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Section keys involved in at least one clash, for highlighting. */
export function clashingSections(placed: PlacedSection[]): Set<string> {
  const out = new Set<string>();
  for (const clash of findClashes(placed)) {
    out.add(`${clash.a.code}:${clash.a.section}`);
    out.add(`${clash.b.code}:${clash.b.section}`);
  }
  return out;
}
