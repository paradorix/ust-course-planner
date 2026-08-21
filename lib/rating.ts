/**
 * Turning raw standardized scores into something a student can read.
 *
 * The upstream scores are standardized values centred near zero, which are
 * meaningless on their own. We convert to a percentile against the population
 * of courses (or instructors) actually on offer this term, then to a letter.
 *
 * The one rule everything here obeys: absence of a rating is never rendered
 * as a low rating. Callers get `null`, and the UI must say "no rating data"
 * rather than showing a zero, an empty bar, or a bottom-of-list position.
 */

import type { Criterion, RatingSet, RatingsFile, RatingValue } from "./types.ts";

export interface Scored {
  value: RatingValue;
  /** 0–100, relative to this term's population for that criterion. */
  percentile: number;
  letter: string;
  /** Few samples means the score is weakly supported; the UI flags it. */
  thin: boolean;
}

/** Normal CDF via Abramowitz–Stegun; good to ~1e-7, which is far beyond need. */
function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

const LETTERS: [number, string][] = [
  [93, "A+"],
  [85, "A"],
  [77, "A-"],
  [69, "B+"],
  [58, "B"],
  [46, "B-"],
  [34, "C+"],
  [22, "C"],
  [12, "C-"],
  [5, "D"],
  [0, "F"],
];

export function letterFor(percentile: number): string {
  for (const [floor, letter] of LETTERS) {
    if (percentile >= floor) return letter;
  }
  return "F";
}

/**
 * Score one entity on one criterion.
 * Returns null when there is no rating — never a default or a zero.
 */
export function scoreOf(
  ratings: RatingSet | undefined,
  criterion: Criterion,
  distribution: RatingsFile["distribution"],
): Scored | null {
  const value = ratings?.[criterion];
  if (!value) return null;

  const stats = distribution?.[criterion];
  // Without a population we cannot place the score, so report it unranked
  // rather than inventing a percentile.
  if (!stats || !stats.stdev) {
    return { value, percentile: 50, letter: "—", thin: value.samples < 3 };
  }

  const z = (value.bayesian - stats.mean) / stats.stdev;
  const percentile = Math.max(0, Math.min(100, normalCdf(z) * 100));

  return {
    value,
    percentile,
    letter: letterFor(percentile),
    thin: value.samples < 3,
  };
}

/** Tailwind classes for a score badge, keyed off percentile. */
export function badgeClasses(percentile: number): string {
  if (percentile >= 85) return "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30";
  if (percentile >= 69) return "bg-lime-500/15 text-lime-300 ring-lime-500/30";
  if (percentile >= 46) return "bg-amber-500/15 text-amber-300 ring-amber-500/30";
  if (percentile >= 22) return "bg-orange-500/15 text-orange-300 ring-orange-500/30";
  return "bg-rose-500/15 text-rose-300 ring-rose-500/30";
}

/**
 * Sort comparator that keeps unrated entities visible.
 *
 * Unrated items sort after rated ones but are never removed — hiding them
 * would erase every new course and every new instructor from the results,
 * which is the opposite of useful.
 */
export function byScoreDesc(a: Scored | null, b: Scored | null): number {
  if (a && b) return b.value.bayesian - a.value.bayesian;
  if (a) return -1;
  if (b) return 1;
  return 0;
}
