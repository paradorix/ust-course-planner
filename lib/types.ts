/**
 * Shared shapes for the generated data files.
 *
 * Everything here mirrors what `scripts/build-schedule.ts` and
 * `scripts/build-ratings.ts` emit into `public/data/`. The build scripts
 * validate against these shapes before writing, so a change here needs a
 * matching change there.
 */

/** The six rating dimensions published by ust-rankings-data. */
export const CRITERIA = [
  "teaching",
  "content",
  "grading",
  "workload",
  "instructor",
  "course",
] as const;

export type Criterion = (typeof CRITERIA)[number];

/** Human-facing labels and orientation for each criterion. */
export const CRITERION_META: Record<
  Criterion,
  { label: string; blurb: string; source: "review" | "sfq" }
> = {
  teaching: {
    label: "Teaching",
    blurb: "How well the material is taught",
    source: "review",
  },
  content: {
    label: "Content",
    blurb: "How worthwhile the material itself is",
    source: "review",
  },
  grading: {
    label: "Grading",
    blurb: "How fair and generous the marking is",
    source: "review",
  },
  workload: {
    // Polarity here is higher = lighter workload, confirmed by the project
    // owner. The upstream feed still does not document this, so the claim
    // rests on that confirmation rather than on the source data; the data is
    // at least consistent with it (MATH3043, honours real analysis, sits at
    // #644 of 658).
    label: "Workload",
    blurb: "How light the workload is",
    source: "review",
  },
  instructor: {
    label: "Instructor (SFQ)",
    blurb: "Official survey score for the instructor",
    source: "sfq",
  },
  course: {
    label: "Course (SFQ)",
    blurb: "Official survey score for the course",
    source: "sfq",
  },
};

export type Weekday = "Sun" | "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat";

export const WEEKDAYS: Weekday[] = [
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun",
];

/** One meeting block of a section: a weekly slot over a date window. */
export interface Meeting {
  weekday: Weekday;
  /** ISO date, inclusive. Not every meeting spans the whole term. */
  dateFrom: string;
  /** ISO date, inclusive. */
  dateTo: string;
  /** "HH:MM", 24-hour. */
  timeFrom: string;
  /** "HH:MM", 24-hour. */
  timeTo: string;
  venue: string;
  venueName: string;
  instructors: string[];
}

/** A single class: one section of a course in one term. */
export interface Section {
  /** e.g. "L1", "T2A". */
  section: string;
  /** Class number, unique within a term. Used as the stable selection key. */
  number: number;
  type: "LEC" | "TUT" | "LAB" | "IND";
  /** "E" = primary instruction, "N" = secondary. */
  role: "E" | "N";
  /** Groups a lecture with its tutorials/labs, when the source provides it. */
  association: number | null;
  remarks: string;
  consent: boolean;
  meetings: Meeting[];
  /**
   * Seat figures as of the schedule build, NOT live. The live values come
   * from /api/seats. Kept here only as a fallback when that route fails.
   */
  snapshotCapacity: number;
  snapshotEnroll: number;
  snapshotWait: number;
  snapshotOpen: boolean;
}

export interface Course {
  /** Opaque source id, unique per term. */
  id: string;
  /** e.g. "COMP". */
  prefix: string;
  /** e.g. "1023". */
  number: string;
  /** e.g. "COMP1023". */
  code: string;
  title: string;
  credits: number;
  career: string;
  description: string;
  /** Free-text prose, shown verbatim. Deliberately not machine-parsed. */
  prerequisite: string;
  corequisite: string;
  exclusion: string;
  attributes: { label: string; value: string; description: string }[];
  sections: Section[];
}

export interface TermSchedule {
  termNum: number;
  termCode: string;
  termName: string;
  courses: Course[];
}

/** One criterion's score for one entity, already reduced to what the UI shows. */
export interface RatingValue {
  /** Posterior mean; this is the rankable number. */
  bayesian: number;
  /** Raw standardized estimate, before shrinkage toward the prior. */
  rating: number;
  /** 0..1-ish weight of evidence behind the estimate. */
  confidence: number;
  /** Number of underlying observations. */
  samples: number;
}

export type RatingSet = Partial<Record<Criterion, RatingValue>>;

export interface RatingsFile {
  /** Term the scores were sliced at. */
  termNum: number;
  /**
   * Percentile lookup per criterion, so the UI can render a letter grade
   * without shipping the whole population.
   *
   * `ladder` holds 101 empirical breakpoints — `ladder[k]` is the value at
   * the k-th percentile — so a score is placed by its real rank rather than
   * by a curve fitted to it. `confidenceP10` is the 10th percentile of this
   * criterion's confidence values, the cutoff below which the UI marks a
   * score as thinly evidenced.
   */
  distribution: Record<
    Criterion,
    { count: number; ladder: number[]; confidenceP10: number }
  >;
  /** Keyed by course code ("COMP1023") or by canonical instructor name. */
  entries: Record<string, RatingSet>;
}

/** Provenance for one generated artifact, surfaced in the UI. */
export interface SourceMeta {
  /** Immutable upstream commit the data came from. */
  revision: string;
  /** ISO timestamp of when we fetched it. */
  fetchedAt: string;
  /** SHA-256 of each downloaded file, keyed by filename. */
  digests: Record<string, string>;
}

export interface DataMeta {
  schedule: SourceMeta & { terms: number[] };
  ratings: SourceMeta & { termNum: number };
}
