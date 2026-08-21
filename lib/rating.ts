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
  /** Weakly evidenced relative to its peers; the UI flags it. */
  thin: boolean;
  /** How many entities this was ranked against, for the UI to name the scale. */
  population: number;
}

/**
 * Place a value in its population using the empirical quantile ladder.
 *
 * `ladder[k]` is the value at the k-th percentile, so the returned number is
 * the entity's actual rank in the sorted population. This deliberately does
 * not fit a curve: these distributions are strongly left-skewed and
 * heavy-tailed, and a normal approximation misreports rank by up to 24
 * percentile points — enough to badge the single highest-rated course on
 * offer as 97th percentile.
 */
function percentileIn(ladder: number[], value: number): number {
  const last = ladder.length - 1;
  if (value <= ladder[0]) return 0;
  if (value >= ladder[last]) return 100;

  // First breakpoint at or above the value.
  let lo = 0;
  let hi = last;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ladder[mid] < value) lo = mid + 1;
    else hi = mid;
  }

  if (ladder[lo] !== value) {
    // Strictly between two breakpoints — interpolate between their ranks.
    const below = ladder[lo - 1];
    return ((lo - 1 + (value - below) / (ladder[lo] - below)) / last) * 100;
  }

  // Shrinkage toward the prior pulls many entities onto identical values, so
  // the ladder contains flat runs. Everyone in a run is genuinely tied, so
  // report the middle of it rather than handing one arbitrary edge to
  // whoever happens to look it up.
  let start = lo;
  let end = lo;
  while (start > 0 && ladder[start - 1] === value) start--;
  while (end < last && ladder[end + 1] === value) end++;
  return (((start + end) / 2 / last) * 100);
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
  // rather than inventing a percentile — and do not warn about thin evidence
  // either, since there is nothing to calibrate that against.
  if (!stats || !stats.ladder || stats.ladder.length < 2) {
    return { value, percentile: 50, letter: "—", thin: false, population: 0 };
  }

  const percentile = percentileIn(stats.ladder, value.bayesian);

  return {
    value,
    percentile,
    letter: letterFor(percentile),
    // `samples` counts only responses new in one term and is 0 almost
    // everywhere, so it cannot carry this. `confidence` is the cumulative
    // weight of evidence, compared here against its own population's 10th
    // percentile.
    thin: value.confidence < stats.confidenceP10,
    population: stats.count,
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
