/**
 * Smart selection: turns "these courses, these preferences" into a ranked
 * list of complete, clash-free timetables.
 *
 * No CSP/ILP library — at the scale of one term's schedule (a handful of
 * wanted courses, each with a handful of legal section combinations once
 * lecture/tutorial/lab pairing is applied) a pruned brute-force search stays
 * well under the node budget below. See courseCombos() for the pairing rule
 * and scoreTimetable() (lib/preferences.ts) for how a complete combination
 * is ranked once found.
 *
 * Hard constraints (a combination that fails these is never returned):
 *   - every wanted course is scheduled
 *   - every pinned section is present exactly as pinned
 *   - one section per section-type per course, respecting `association`
 *     pairing (see courseCombos)
 *   - no time conflict among the chosen sections (lib/conflicts.ts)
 *
 * Everything else — start/end time, blocked days, max days, seat
 * availability, compactness — is scored, never filtered. An over-constrained
 * preference set still returns its best available results, each carrying
 * the preferences it had to break (ScoreBreakdown.violations). This is
 * different from the two genuine dead ends below, which are structural
 * impossibilities rather than a trade-off: two pins that overlap in time, or
 * a pin that matches no legal section grouping for its own course. Those are
 * unsolvable by definition, not merely low-scoring, and are reported with a
 * specific reason rather than an empty list.
 */

import { findClashes, type PlacedSection } from "./conflicts.ts";
import { scoreTimetable, type Preferences, type ScoreBreakdown } from "./preferences.ts";
import type { Course, Section } from "./types.ts";

export interface SolveResult {
  placed: PlacedSection[];
  breakdown: ScoreBreakdown;
}

export interface SolveOutcome {
  results: SolveResult[];
  /** Set only for a structural impossibility — see file header. */
  error: string | null;
}

export interface SolveOptions {
  /** How many ranked results to keep. */
  limit?: number;
  /** Live seat status by class number, forwarded to scoreTimetable. */
  liveOpen?: Record<number, boolean>;
  /** Safety cap on search nodes visited, so a pathological input degrades rather than hangs. */
  maxNodes?: number;
}

interface TypeGroup {
  type: Section["type"];
  primary: boolean;
  options: Section[];
}

function typeGroups(course: Course): TypeGroup[] {
  const byType = new Map<Section["type"], Section[]>();
  for (const s of course.sections) {
    const list = byType.get(s.type);
    if (list) list.push(s);
    else byType.set(s.type, [s]);
  }
  return [...byType.entries()].map(([type, options]) => ({
    type,
    primary: options.some((s) => s.role === "E"),
    options,
  }));
}

/**
 * Every legal full combination of sections for one course: exactly one
 * section per type present, with secondary (role "N") sections restricted to
 * the primary section(s) they share an `association` with — a section whose
 * `association` is null pairs with anything, matching how the schedule data
 * itself expresses "any lab works with any lecture" (see AGENTS notes on
 * COMP1021 vs MATH1013 in the smart-planner plan). A pinned section for this
 * course prunes its whole type group down to that one section.
 *
 * Sections with no meetings at all are legal choices like any other — they
 * simply contribute nothing when the grid or the score is computed later.
 */
function courseCombos(course: Course, pinnedForCourse: Set<number>): Section[][] {
  const groups = typeGroups(course);
  const primaryGroups = groups.filter((g) => g.primary);
  const secondaryGroups = groups.filter((g) => !g.primary);

  const restrict = (group: TypeGroup): Section[] => {
    const pinnedInGroup = group.options.find((o) => pinnedForCourse.has(o.number));
    return pinnedInGroup ? [pinnedInGroup] : group.options;
  };

  let primaryCombos: Section[][] = [[]];
  for (const group of primaryGroups) {
    const next: Section[][] = [];
    for (const combo of primaryCombos) {
      for (const option of restrict(group)) next.push([...combo, option]);
    }
    primaryCombos = next;
  }

  const results: Section[][] = [];
  for (const primaryCombo of primaryCombos) {
    const associations = new Set(
      primaryCombo.map((s) => s.association).filter((a): a is number => a !== null),
    );
    // No primary group, or none of the chosen primaries carry association
    // info — nothing to pair against, so don't constrain secondaries at all.
    const unconstrained = primaryGroups.length === 0 || associations.size === 0;

    let combos: Section[][] = [primaryCombo];
    for (const group of secondaryGroups) {
      const next: Section[][] = [];
      for (const combo of combos) {
        for (const option of restrict(group)) {
          if (!unconstrained && option.association !== null && !associations.has(option.association)) {
            continue;
          }
          next.push([...combo, option]);
        }
      }
      combos = next;
    }
    results.push(...combos);
  }
  return results;
}

export function solve(
  courses: Course[],
  wantedCodes: string[],
  pinnedNumbers: number[],
  prefs: Preferences,
  opts: SolveOptions = {},
): SolveOutcome {
  const limit = opts.limit ?? 8;
  const maxNodes = opts.maxNodes ?? 200_000;
  const liveOpen = opts.liveOpen ?? {};

  const byCode = new Map(courses.map((c) => [c.code, c]));
  const wantedCourses = wantedCodes
    .map((code) => byCode.get(code))
    .filter((c): c is Course => c !== undefined);

  if (wantedCourses.length === 0) return { results: [], error: null };

  const pinnedSet = new Set(pinnedNumbers);
  const perCourse = wantedCourses.map((course) => {
    const pinnedForCourse = new Set(
      [...pinnedSet].filter((n) => course.sections.some((s) => s.number === n)),
    );
    return { course, combos: courseCombos(course, pinnedForCourse) };
  });

  const impossible = perCourse.find((p) => p.combos.length === 0);
  if (impossible) {
    return {
      results: [],
      error: `${impossible.course.code} has no valid combination of sections — a pinned section may not match this course's own lecture/tutorial grouping.`,
    };
  }

  // Most-constrained-first so a hard conflict is discovered, and pruned, early.
  perCourse.sort((a, b) => a.combos.length - b.combos.length);

  const results: SolveResult[] = [];
  let nodes = 0;

  function backtrack(index: number, placed: PlacedSection[]): void {
    if (nodes >= maxNodes) return;
    nodes++;

    if (index === perCourse.length) {
      results.push({ placed: [...placed], breakdown: scoreTimetable(placed, prefs, liveOpen) });
      return;
    }

    const { course, combos } = perCourse[index];
    for (const combo of combos) {
      if (nodes >= maxNodes) return;
      const candidate = combo.map((section) => ({ code: course.code, section }));
      if (findClashes([...placed, ...candidate]).length > 0) continue;
      backtrack(index + 1, [...placed, ...candidate]);
    }
  }

  backtrack(0, []);

  if (results.length === 0) {
    // No arrangement avoids a time conflict. If the collision is forced by
    // two pins, name them specifically — that's the actionable version of
    // this message; otherwise it's an unlucky combination across choices.
    const pinnedPlaced = wantedCourses.flatMap((course) =>
      course.sections
        .filter((s) => pinnedSet.has(s.number))
        .map((section) => ({ code: course.code, section })),
    );
    const pinClash = findClashes(pinnedPlaced)[0];
    return {
      results: [],
      error: pinClash
        ? `${pinClash.a.code} ${pinClash.a.section} and ${pinClash.b.code} ${pinClash.b.section} are both pinned but overlap — ${pinClash.detail}. Unpin one to continue.`
        : "No combination of sections avoids a time conflict — try unpinning a section or removing a course.",
    };
  }

  results.sort((a, b) => b.breakdown.score - a.breakdown.score);
  return { results: results.slice(0, limit), error: null };
}
