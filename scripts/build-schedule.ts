/**
 * Daily schedule build.
 *
 * Reads the two Parquet files from the public `ust-archive/schedule` dataset
 * and emits one compact JSON per served term into public/data/schedule/.
 *
 * Two things about the source shape drive the SQL below:
 *
 *  1. Both tables are append-only event logs keyed by (…, timestamp). A term
 *     carries several snapshots of the same class, so we take the latest event
 *     per logical record FIRST, and only then keep the ones whose latest state
 *     is ACTIVE. Filtering ACTIVE before deduping would resurrect classes that
 *     were later removed.
 *  2. We deliberately do NOT read ust-archive/ust-cq, which the upstream
 *     project still fetches — it has not updated since 2026-05-12 and its own
 *     docs call it retired.
 */

import { DuckDBInstance } from "@duckdb/node-api";
import type { Course, Meeting, Section, TermSchedule } from "../lib/types.ts";
import {
  check,
  fetchToCache,
  log,
  normalizeBigInts,
  resolveHuggingFaceRevision,
  runBuild,
  writeJsonAtomic,
} from "./lib/source.ts";

const DATASET = "ust-archive/schedule";
const OUT_DIR = "public/data/schedule";

/** Serve at most this many terms — "current + next", per the design. */
const MAX_TERMS = 2;

interface CourseRow {
  term_num: number;
  term_code: string;
  term_name: string;
  id: string;
  prefix: string;
  number: string;
  career: string;
  title: string;
  description: string;
  credits: number;
  prerequisite: string;
  corequisite: string;
  exclusion: string;
  attributes: { label: string; value: string; description: string }[] | null;
}

interface ClassRow {
  term_num: number;
  course_id: string;
  section: string;
  number: number;
  role: "E" | "N";
  type: "LEC" | "TUT" | "LAB" | "IND";
  association: number | null;
  remarks: string;
  consent: boolean;
  capacity: number;
  enroll: number;
  wait: number;
  open: boolean;
  meetings: Meeting[] | null;
}

/**
 * Latest event per logical record, then ACTIVE only. Used for both tables;
 * they differ only in their identity columns.
 */
function latestActive(file: string, keyColumns: string) {
  return `
    SELECT * EXCLUDE (rn) FROM (
      SELECT *, row_number() OVER (
        PARTITION BY ${keyColumns} ORDER BY "timestamp" DESC
      ) AS rn
      FROM read_parquet('${file}')
    ) WHERE rn = 1 AND status = 'ACTIVE'`;
}

await runBuild("Schedule build", async () => {
  const revision = await resolveHuggingFaceRevision(DATASET);
  log("revision", revision);

  const base = `https://huggingface.co/datasets/${DATASET}/resolve/${revision}`;
  const classes = await fetchToCache(`${base}/classes.parquet`, "classes.parquet");
  const courses = await fetchToCache(`${base}/courses.parquet`, "courses.parquet");

  const instance = await DuckDBInstance.create(":memory:");
  const db = await instance.connect();
  const query = async <T>(sql: string): Promise<T[]> =>
    normalizeBigInts((await (await db.run(sql)).getRowObjectsJS()) as T[]);

  await db.run(`CREATE VIEW live_classes AS ${latestActive(classes.path, 'term_num, "number"')}`);
  await db.run(`CREATE VIEW live_courses AS ${latestActive(courses.path, "term_num, id")}`);

  // Pick the terms worth serving: any term still running or yet to start.
  // Falls back to the newest term so a gap between terms never yields nothing.
  const today = new Date().toISOString().slice(0, 10);
  const termRows = await query<{ term_num: number; term_name: string; last_day: string }>(`
    WITH ends AS (
      SELECT term_num, any_value(term_name) AS term_name,
             max(m.date_to) AS last_day
      FROM live_classes, UNNEST(schedules) AS t(m)
      GROUP BY term_num
    )
    SELECT * FROM ends ORDER BY term_num`);

  check(termRows.length > 0, "No terms found in the schedule dataset");

  const upcoming = termRows.filter((t) => t.last_day >= today);
  const served = (upcoming.length > 0 ? upcoming : termRows.slice(-1)).slice(0, MAX_TERMS);
  log(
    "terms served",
    served.map((t) => `${t.term_num} ${t.term_name} (ends ${t.last_day})`).join(", "),
  );

  const termNums = served.map((t) => t.term_num);
  const inTerms = `term_num IN (${termNums.join(", ")})`;

  const courseRows = await query<CourseRow>(`
    SELECT term_num, term_code, term_name, id, prefix, "number", career, title,
           description, credits, prerequisite, corequisite, exclusion, attributes
    FROM live_courses WHERE ${inTerms}
    ORDER BY prefix, "number"`);

  // Format times and dates in SQL so the JSON carries plain "HH:MM" /
  // "YYYY-MM-DD" strings rather than DuckDB TIME microseconds.
  const classRows = await query<ClassRow>(`
    SELECT term_num, course_id, section, "number", "role", "type", association,
           remarks, consent, capacity, enroll, wait, "open",
           list_transform(schedules, m -> struct_pack(
             weekday      := CAST(m.weekday AS VARCHAR),
             dateFrom     := strftime(m.date_from, '%Y-%m-%d'),
             dateTo       := strftime(m.date_to,   '%Y-%m-%d'),
             -- TIME has no strftime overload; its VARCHAR form is
             -- "HH:MM:SS", so trim to the minute.
             timeFrom     := substr(CAST(m.time_from AS VARCHAR), 1, 5),
             timeTo       := substr(CAST(m.time_to   AS VARCHAR), 1, 5),
             venue        := m.venue,
             venueName    := m.venue_name,
             instructors  := m.instructors
           )) AS meetings
    FROM live_classes WHERE ${inTerms}
    ORDER BY course_id, section`);

  log("rows", `${courseRows.length} courses, ${classRows.length} classes`);

  const sectionsByCourse = new Map<string, Section[]>();
  for (const row of classRows) {
    const meetings = (row.meetings ?? []).filter(
      (m) => m.weekday && m.timeFrom && m.timeTo && m.dateFrom && m.dateTo,
    );
    const section: Section = {
      section: row.section,
      number: row.number,
      type: row.type,
      role: row.role,
      association: row.association ?? null,
      remarks: row.remarks ?? "",
      consent: Boolean(row.consent),
      meetings,
      snapshotCapacity: row.capacity ?? 0,
      snapshotEnroll: row.enroll ?? 0,
      snapshotWait: row.wait ?? 0,
      snapshotOpen: Boolean(row.open),
    };
    const key = `${row.term_num}:${row.course_id}`;
    const list = sectionsByCourse.get(key);
    if (list) list.push(section);
    else sectionsByCourse.set(key, [section]);
  }

  const byTerm = new Map<number, TermSchedule>();
  for (const term of served) {
    const meta = courseRows.find((c) => c.term_num === term.term_num);
    check(meta, `Term ${term.term_num} has no course rows`);
    byTerm.set(term.term_num, {
      termNum: term.term_num,
      termCode: meta.term_code,
      termName: meta.term_name,
      courses: [],
    });
  }

  for (const row of courseRows) {
    const term = byTerm.get(row.term_num);
    if (!term) continue;
    const sections = sectionsByCourse.get(`${row.term_num}:${row.id}`) ?? [];
    // A course with no schedulable section cannot be planned around, so it
    // would only be noise in a planner.
    if (sections.length === 0) continue;

    const course: Course = {
      id: row.id,
      prefix: row.prefix,
      number: row.number,
      code: `${row.prefix}${row.number}`,
      title: row.title,
      credits: Number(row.credits) || 0,
      career: row.career,
      description: row.description ?? "",
      prerequisite: row.prerequisite ?? "",
      corequisite: row.corequisite ?? "",
      exclusion: row.exclusion ?? "",
      attributes: row.attributes ?? [],
      sections,
    };
    term.courses.push(course);
  }

  // Validate before writing anything. A term that lost its courses, or times
  // that stopped parsing, means the source changed shape — fail closed and
  // keep whatever is already on disk.
  const timePattern = /^\d{2}:\d{2}$/;
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  for (const term of byTerm.values()) {
    check(
      term.courses.length > 50,
      `Term ${term.termNum} produced only ${term.courses.length} courses — refusing to publish`,
    );
    check(term.termCode && term.termName, `Term ${term.termNum} is missing its code or name`);
    for (const course of term.courses) {
      check(course.code.length >= 5, `Course ${course.id} has a malformed code "${course.code}"`);
      for (const section of course.sections) {
        for (const m of section.meetings) {
          check(
            timePattern.test(m.timeFrom) && timePattern.test(m.timeTo),
            `${course.code} ${section.section}: unparseable time "${m.timeFrom}"–"${m.timeTo}"`,
          );
          check(
            datePattern.test(m.dateFrom) && datePattern.test(m.dateTo),
            `${course.code} ${section.section}: unparseable date window`,
          );
        }
      }
    }
  }

  for (const term of byTerm.values()) {
    const size = await writeJsonAtomic(`${OUT_DIR}/term-${term.termNum}.json`, term);
    const sections = term.courses.reduce((n, c) => n + c.sections.length, 0);
    log(
      `term-${term.termNum}.json`,
      `${term.courses.length} courses, ${sections} sections, ${(size / 1024).toFixed(0)} KB`,
    );
  }

  await writeJsonAtomic(`${OUT_DIR}/index.json`, {
    revision,
    fetchedAt: new Date().toISOString(),
    digests: { "classes.parquet": classes.digest, "courses.parquet": courses.digest },
    terms: [...byTerm.values()].map((t) => ({
      termNum: t.termNum,
      termCode: t.termCode,
      termName: t.termName,
      courseCount: t.courses.length,
    })),
  });
});
