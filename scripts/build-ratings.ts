/**
 * Weekly ratings build.
 *
 * Slices ust-rankings-data's published ratings down to just the term we serve
 * and just the fields the UI renders.
 *
 * The inputs are large — ratings-course.json is ~51 MB and
 * ratings-instructor.json ~40 MB — so they are streamed and reduced rather
 * than held in memory as parsed objects. The output is a flat lookup keyed by
 * course code or instructor name, which is a few hundred KB.
 *
 * Cadence is weekly (schedules rebuild daily) because these scores move
 * slowly and the inputs are expensive to pull. The two artifacts are separate
 * files precisely so their cadences can differ: a brand-new section can appear
 * a few days before its instructor has a rating row, which the UI renders as
 * "no rating data" rather than as a bad score.
 */

import { readdir, readFile } from "node:fs/promises";
import { CRITERIA, type Criterion, type RatingSet, type RatingValue } from "../lib/types.ts";
import { check, fetchToCache, log, runBuild, writeJsonAtomic } from "./lib/source.ts";

const BASE = "https://raw.githubusercontent.com/ust-archive/ust-rankings-data/data";
const SCHEDULE_DIR = "public/data/schedule";
const OUT_DIR = "public/data/ratings";

/** Shape of one entry in the upstream ratings files. */
interface SourceEntry {
  meta: { name?: string; subject?: string; code?: string };
  ratings?: Partial<
    Record<Criterion, Partial<Record<"rating" | "bayesian" | "confidence" | "samples", Record<string, number>>>>
  >;
}

/**
 * Pull one term's value out of the upstream per-term maps.
 *
 * Scores are emitted densely from an entity's first observed term onward, so
 * an entity active earlier but not in our term still has a meaningful latest
 * value. We take the requested term when present and otherwise fall back to
 * the most recent earlier term, which is what "their standing as of now"
 * means. We never read forward from a later term.
 */
function valueAt(
  series: Record<string, number> | undefined,
  termNum: number,
): number | undefined {
  if (!series) return undefined;
  const exact = series[String(termNum)];
  if (typeof exact === "number" && Number.isFinite(exact)) return exact;

  let bestTerm = -Infinity;
  let bestValue: number | undefined;
  for (const [key, value] of Object.entries(series)) {
    const t = Number(key);
    if (!Number.isFinite(t) || t > termNum || t <= bestTerm) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    bestTerm = t;
    bestValue = value;
  }
  return bestValue;
}

function extractRatings(entry: SourceEntry, termNum: number): RatingSet | null {
  const out: RatingSet = {};
  let found = false;

  for (const criterion of CRITERIA) {
    const block = entry.ratings?.[criterion];
    if (!block) continue;
    const bayesian = valueAt(block.bayesian, termNum);
    if (bayesian === undefined) continue;

    const value: RatingValue = {
      bayesian: Number(bayesian.toFixed(4)),
      rating: Number((valueAt(block.rating, termNum) ?? bayesian).toFixed(4)),
      confidence: Number((valueAt(block.confidence, termNum) ?? 0).toFixed(4)),
      samples: Math.round(valueAt(block.samples, termNum) ?? 0),
    };
    out[criterion] = value;
    found = true;
  }

  return found ? out : null;
}

/**
 * Parse a large top-level JSON array one element at a time.
 *
 * The upstream files are a single array of objects. Rather than parse the
 * whole thing, walk the raw text tracking brace depth (respecting strings and
 * escapes) and hand each complete top-level object to the callback, so only
 * one entry is ever materialised.
 */
function forEachArrayElement(raw: string, onEntry: (json: string) => void) {
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        onEntry(raw.slice(start, i + 1));
        start = -1;
      }
    }
  }

  check(depth === 0 && !inString, "Ratings file ended mid-object — truncated download?");
}

/** Mean and standard deviation, used to turn a raw score into a percentile. */
function describe(values: number[]) {
  const count = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / count;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / count;
  return { mean: Number(mean.toFixed(4)), stdev: Number(Math.sqrt(variance).toFixed(4)), count };
}

await runBuild("Ratings build", async () => {
  // Rate against the newest term the schedule build published, so the two
  // artifacts always agree on which term the UI is showing.
  const files = await readdir(SCHEDULE_DIR).catch(() => [] as string[]);
  const termNums = files
    .map((f) => /^term-(\d+)\.json$/.exec(f)?.[1])
    .filter((n): n is string => Boolean(n))
    .map(Number);
  check(
    termNums.length > 0,
    `No schedule terms found in ${SCHEDULE_DIR} — run "npm run data:schedule" first`,
  );
  const termNum = Math.max(...termNums);
  log("rating at term", String(termNum));

  // Only keep ratings for entities that actually appear in a served term.
  // Shipping scores for courses nobody can enrol in this term is dead weight
  // in the browser, and scoping here also tells us how well instructor names
  // line up between the two independent sources.
  const wantedCourses = new Set<string>();
  const wantedInstructors = new Set<string>();
  for (const term of termNums) {
    const schedule = JSON.parse(
      await readFile(`${SCHEDULE_DIR}/term-${term}.json`, "utf8"),
    ) as { courses: { code: string; sections: { meetings: { instructors: string[] }[] }[] }[] };
    for (const course of schedule.courses) {
      wantedCourses.add(course.code);
      for (const section of course.sections) {
        for (const meeting of section.meetings) {
          for (const name of meeting.instructors) wantedInstructors.add(name);
        }
      }
    }
  }
  log(
    "scoped to schedule",
    `${wantedCourses.size} courses, ${wantedInstructors.size} instructor names`,
  );

  const results: Record<"courses" | "instructors", Record<string, RatingSet>> = {
    courses: {},
    instructors: {},
  };
  const distributions: Record<
    "courses" | "instructors",
    Record<string, { mean: number; stdev: number; count: number }>
  > = { courses: {}, instructors: {} };

  for (const kind of ["courses", "instructors"] as const) {
    const filename = kind === "courses" ? "ratings-course.json" : "ratings-instructor.json";
    const { path } = await fetchToCache(`${BASE}/${filename}`, filename);
    const raw = await readFile(path, "utf8");

    const entries = results[kind];
    const samples: Record<string, number[]> = {};
    let total = 0;
    let malformed = 0;

    forEachArrayElement(raw, (json) => {
      total++;
      let entry: SourceEntry;
      try {
        entry = JSON.parse(json) as SourceEntry;
      } catch {
        malformed++;
        return;
      }

      const key =
        kind === "courses"
          ? entry.meta?.subject && entry.meta?.code
            ? `${entry.meta.subject}${entry.meta.code}`
            : undefined
          : entry.meta?.name;
      if (!key) {
        malformed++;
        return;
      }

      const wanted = kind === "courses" ? wantedCourses : wantedInstructors;
      if (!wanted.has(key)) return;

      const ratings = extractRatings(entry, termNum);
      if (!ratings) return;

      entries[key] = ratings;
      for (const [criterion, value] of Object.entries(ratings)) {
        (samples[criterion] ??= []).push((value as RatingValue).bayesian);
      }
    });

    // A parse that silently drops most of the file would quietly gut the
    // ratings, so treat widespread malformation as a failed build.
    check(total > 100, `${filename} yielded only ${total} entries — refusing to publish`);
    check(
      malformed / total < 0.05,
      `${filename}: ${malformed} of ${total} entries were unreadable — source shape may have changed`,
    );
    const wanted = kind === "courses" ? wantedCourses : wantedInstructors;
    const matched = Object.keys(entries).length;
    check(
      matched > 100,
      `${filename} produced only ${matched} rated entries at term ${termNum}`,
    );

    for (const [criterion, values] of Object.entries(samples)) {
      distributions[kind][criterion] = describe(values);
    }

    // For instructors this percentage is the name-match rate between two
    // independently maintained sources, so a sudden drop is a real signal
    // that spellings have drifted — not just thinner rating coverage.
    log(
      filename,
      `${matched} of ${wanted.size} in-schedule ${kind} have ratings ` +
        `(${((matched / wanted.size) * 100).toFixed(0)}%), from ${total} source entries`,
    );
  }

  for (const kind of ["courses", "instructors"] as const) {
    const size = await writeJsonAtomic(`${OUT_DIR}/${kind}.json`, {
      termNum,
      distribution: distributions[kind],
      entries: results[kind],
    });
    log(`${kind}.json`, `${(size / 1024).toFixed(0)} KB`);
  }

  await writeJsonAtomic(`${OUT_DIR}/index.json`, {
    termNum,
    builtAt: new Date().toISOString(),
    source: `${BASE} (branch: data)`,
    criteria: CRITERIA,
  });
});
