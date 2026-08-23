"use client";

/**
 * The planner shell: data loading, criterion selection, browsing, and the
 * week grid.
 *
 * Data is fetched client-side from the static files in public/data rather than
 * passed down from a server component — a term payload is ~2.4 MB of JSON
 * (~236 KB over the wire once compressed), which would bloat the HTML if it
 * were serialised into the page.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import CourseListView from "@/components/CourseListView";
import PreferencePanel from "@/components/PreferencePanel";
import PrintSummary from "@/components/PrintSummary";
import RatingBadge from "@/components/RatingBadge";
import SectionRow from "@/components/SectionRow";
import TemplateBar from "@/components/TemplateBar";
import WeekGrid from "@/components/WeekGrid";
import { clashingSections, findClashes, type PlacedSection } from "@/lib/conflicts";
import { DEFAULT_PREFERENCES, scoreTimetable, type Preferences } from "@/lib/preferences";
import { encodePrefs } from "@/lib/prefs-url";
import { byScoreDesc, scoreOf, type Scored } from "@/lib/rating";
import { downloadTimetableImage } from "@/lib/share-image";
import { solve, type SolveOutcome } from "@/lib/solver";
import {
  backfillWanted,
  loadStore,
  makeTemplate,
  saveStore,
  type Store,
  type Template,
} from "@/lib/templates";
import {
  CRITERIA,
  CRITERION_META,
  type Course,
  type Criterion,
  type RatingsFile,
  type TermSchedule,
} from "@/lib/types";

interface TermIndex {
  revision: string;
  fetchedAt: string;
  terms: { termNum: number; termCode: string; termName: string; courseCount: number }[];
}

/**
 * One rating chip to render. The browser builds these per course/instructor so
 * that "show every category" and "rank by one category" are the same code
 * path with a different-length list, rather than two branches everywhere.
 */
export interface Chip {
  key: Criterion;
  /** Only set when several categories are on screen and need naming. */
  label?: string;
  score: Scored | null;
}

export interface SeatInfo {
  capacity: number;
  enroll: number;
  wait: number;
  open: boolean;
}

interface SeatState {
  seats: Record<string, SeatInfo>;
  retrievedAt: string | null;
  failed: boolean;
}

const PAGE_SIZE = 60;

export default function Planner() {
  const [index, setIndex] = useState<TermIndex | null>(null);
  const [termNum, setTermNum] = useState<number | null>(null);
  const [schedule, setSchedule] = useState<TermSchedule | null>(null);
  const [courseRatings, setCourseRatings] = useState<RatingsFile | null>(null);
  const [instructorRatings, setInstructorRatings] = useState<RatingsFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // "all" is the default: with no category chosen the browser shows every
  // category's ranking side by side rather than picking one for the user.
  const [criterion, setCriterion] = useState<Criterion | "all">("all");
  const [search, setSearch] = useState("");
  const [career, setCareer] = useState<string>("all");
  const [onlyRated, setOnlyRated] = useState(false);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [smartPlannerEnabled, setSmartPlannerEnabled] = useState(true);
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [solveOutcome, setSolveOutcome] = useState<SolveOutcome | null>(null);

  const [store, setStore] = useState<Store>({ version: 2, activeId: null, templates: [] });
  const [hydrated, setHydrated] = useState(false);
  const [seatState, setSeatState] = useState<SeatState>({
    seats: {},
    retrievedAt: null,
    failed: false,
  });

  // ---- data loading -------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch("/data/schedule/index.json");
        if (!resp.ok) throw new Error(`schedule index: HTTP ${resp.status}`);
        const body = (await resp.json()) as TermIndex;
        if (cancelled) return;
        setIndex(body);
        // Newest term first — that's the one being planned.
        const newest = [...body.terms].sort((a, b) => b.termNum - a.termNum)[0];
        setTermNum(newest?.termNum ?? null);
      } catch (e) {
        if (!cancelled) {
          setError(
            `Could not load the schedule index. Run "npm run data:all" to generate it. (${
              e instanceof Error ? e.message : String(e)
            })`,
          );
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (termNum === null) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [scheduleResp, courseResp, instructorResp] = await Promise.all([
          fetch(`/data/schedule/term-${termNum}.json`),
          fetch("/data/ratings/courses.json"),
          fetch("/data/ratings/instructors.json"),
        ]);
        if (!scheduleResp.ok) throw new Error(`term ${termNum}: HTTP ${scheduleResp.status}`);
        const term = (await scheduleResp.json()) as TermSchedule;
        // Ratings rebuild on a slower cadence than schedules, so treat them as
        // optional: a term can legitimately exist before its ratings slice does.
        const courses = courseResp.ok ? ((await courseResp.json()) as RatingsFile) : null;
        const instructors = instructorResp.ok
          ? ((await instructorResp.json()) as RatingsFile)
          : null;
        if (cancelled) return;
        setSchedule(term);
        setCourseRatings(courses);
        setInstructorRatings(instructors);
        setVisible(PAGE_SIZE);
        setError(null);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [termNum]);

  // Live seats, fetched once per term view. Failure is non-fatal — the daily
  // snapshot in the schedule file is the fallback, clearly labelled as such.
  useEffect(() => {
    if (!schedule) return;
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch("/api/seats");
        if (!resp.ok) throw new Error(String(resp.status));
        const body = (await resp.json()) as {
          seats: Record<string, SeatInfo>;
          retrievedAt: string;
        };
        if (!cancelled) {
          setSeatState({ seats: body.seats, retrievedAt: body.retrievedAt, failed: false });
        }
      } catch {
        if (!cancelled) setSeatState({ seats: {}, retrievedAt: null, failed: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [schedule]);

  // ---- templates ----------------------------------------------------------

  useEffect(() => {
    const loaded = loadStore();
    setStore(loaded);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) saveStore(store);
  }, [store, hydrated]);

  const active = useMemo(
    () => store.templates.find((t) => t.id === store.activeId) ?? null,
    [store],
  );

  // Ensure there is always something to plan into once a term is known.
  useEffect(() => {
    if (!hydrated || termNum === null) return;
    setStore((prev) => {
      if (prev.templates.length > 0) return prev;
      const first = makeTemplate("My timetable", termNum);
      return { version: 2, activeId: first.id, templates: [first] };
    });
  }, [hydrated, termNum]);

  // Class number -> course code, the join a v1 -> v2 migrated template needs
  // to derive `wanted` from what it has (`pinned`). See lib/templates.ts.
  const classToCode = useMemo(() => {
    const map = new Map<number, string>();
    for (const course of schedule?.courses ?? []) {
      for (const section of course.sections) map.set(section.number, course.code);
    }
    return map;
  }, [schedule]);

  useEffect(() => {
    if (!hydrated || !schedule) return;
    setStore((prev) => backfillWanted(prev, (n) => classToCode.get(n) ?? null));
  }, [hydrated, schedule, classToCode]);

  const updateActive = useCallback((mutate: (template: Template) => Template) => {
    setStore((prev) => {
      if (!prev.activeId) return prev;
      return {
        ...prev,
        templates: prev.templates.map((t) =>
          t.id === prev.activeId ? { ...mutate(t), updatedAt: new Date().toISOString() } : t,
        ),
      };
    });
  }, []);

  const wanted = useMemo(
    () => new Set(active?.termNum === termNum ? active.wanted : []),
    [active, termNum],
  );

  const pinned = useMemo(
    () => new Set(active?.termNum === termNum ? active.pinned : []),
    [active, termNum],
  );

  const selected = useMemo(
    () => new Set(active?.termNum === termNum ? active.selected : []),
    [active, termNum],
  );

  // Wanting a course is the primary act of selection now — sections are
  // pinned or solver-derived. Dropping a course drops anything pinned or
  // placed for it too, so nothing of it lingers on the grid unexplained.
  const toggleWanted = useCallback(
    (code: string) => {
      if (termNum === null) return;
      updateActive((template) => {
        const has = template.wanted.includes(code);
        if (!has) return { ...template, termNum, wanted: [...template.wanted, code] };
        const isThisCourse = (n: number) => classToCode.get(n) === code;
        return {
          ...template,
          termNum,
          wanted: template.wanted.filter((c) => c !== code),
          pinned: template.pinned.filter((n) => !isThisCourse(n)),
          selected: template.selected.filter((n) => !isThisCourse(n)),
        };
      });
    },
    [termNum, updateActive, classToCode],
  );

  // Pinning forces one specific section onto the grid and implicitly wants
  // its course. Unpinning removes it from the grid too — until the solver
  // (smart mode) exists, a pin is the only thing that puts a section in play.
  const togglePin = useCallback(
    (classNumber: number) => {
      if (termNum === null) return;
      const code = classToCode.get(classNumber);
      updateActive((template) => {
        const has = template.pinned.includes(classNumber);
        if (has) {
          return {
            ...template,
            termNum,
            pinned: template.pinned.filter((n) => n !== classNumber),
            selected: template.selected.filter((n) => n !== classNumber),
          };
        }
        return {
          ...template,
          termNum,
          wanted: code && !template.wanted.includes(code) ? [...template.wanted, code] : template.wanted,
          pinned: [...template.pinned, classNumber],
          selected: [...template.selected, classNumber],
        };
      });
    },
    [termNum, updateActive, classToCode],
  );

  // Live seat status by class number, in the shape lib/preferences.ts wants —
  // the same data SectionRow already shows, reused as a solver input.
  const liveOpen = useMemo(() => {
    const map: Record<number, boolean> = {};
    for (const [numStr, info] of Object.entries(seatState.seats)) map[Number(numStr)] = info.open;
    return map;
  }, [seatState.seats]);

  // Runs the solver over the active template's wishlist + pins + preferences
  // and writes its top pick straight into `selected` — sections stay
  // solver-derived; pinning is the only manual override.
  const handleGenerate = useCallback(() => {
    if (!schedule || !active) return;
    const outcome = solve(schedule.courses, active.wanted, active.pinned, prefs, { liveOpen });
    setSolveOutcome(outcome);
    const top = outcome.results[0];
    if (top) {
      const numbers = top.placed.map((p) => p.section.number);
      updateActive((template) => ({ ...template, selected: numbers }));
    }
  }, [schedule, active, prefs, liveOpen, updateActive]);

  // ---- derived ------------------------------------------------------------

  const shownCriteria = useMemo(
    (): readonly Criterion[] => (criterion === "all" ? CRITERIA : [criterion]),
    [criterion],
  );

  const courseChips = useCallback(
    (course: Course): Chip[] =>
      shownCriteria.map((c) => ({
        key: c,
        label: criterion === "all" ? CRITERION_META[c].label : undefined,
        score: courseRatings
          ? scoreOf(courseRatings.entries[course.code], c, courseRatings.distribution)
          : null,
      })),
    [shownCriteria, criterion, courseRatings],
  );

  const instructorChips = useCallback(
    (name: string): Chip[] =>
      shownCriteria.map((c) => ({
        key: c,
        label: criterion === "all" ? CRITERION_META[c].label : undefined,
        score: instructorRatings
          ? scoreOf(instructorRatings.entries[name], c, instructorRatings.distribution)
          : null,
      })),
    [shownCriteria, criterion, instructorRatings],
  );

  const filtered = useMemo(() => {
    if (!schedule) return [];
    const needle = search.trim().toLowerCase();

    const rows = schedule.courses
      .filter((course) => {
        if (career !== "all" && course.career !== career) return false;
        if (!needle) return true;
        return (
          course.code.toLowerCase().includes(needle) ||
          course.title.toLowerCase().includes(needle) ||
          course.sections.some((s) =>
            s.meetings.some((m) =>
              m.instructors.some((i) => i.toLowerCase().includes(needle)),
            ),
          )
        );
      })
      .map((course) => ({ course, chips: courseChips(course) }))
      // "rated only" means rated on whatever is currently on screen: one
      // category when ranking by it, any category when showing them all.
      .filter(({ chips }) => !onlyRated || chips.some((c) => c.score));

    rows.sort((a, b) => {
      // With every category shown at once, none of them is *the* ranking, and
      // the data does not support collapsing them into one. Fall back to code
      // order rather than inventing a composite.
      if (criterion !== "all") {
        const byScore = byScoreDesc(a.chips[0].score, b.chips[0].score);
        if (byScore !== 0) return byScore;
      }
      return a.course.code.localeCompare(b.course.code);
    });

    return rows;
  }, [schedule, search, career, onlyRated, criterion, courseChips]);

  const placed: PlacedSection[] = useMemo(() => {
    if (!schedule) return [];
    const out: PlacedSection[] = [];
    for (const course of schedule.courses) {
      for (const section of course.sections) {
        if (selected.has(section.number)) out.push({ code: course.code, section });
      }
    }
    return out;
  }, [schedule, selected]);

  const clashes = useMemo(() => findClashes(placed), [placed]);
  const clashKeys = useMemo(() => clashingSections(placed), [placed]);

  const credits = useMemo(() => {
    if (!schedule) return 0;
    // Credits are per course, not per section: adding a lecture and its
    // tutorial must not count the course twice.
    const codes = new Set(placed.map((p) => p.code));
    let total = 0;
    for (const course of schedule.courses) {
      if (codes.has(course.code)) total += course.credits;
    }
    return total;
  }, [schedule, placed]);

  const handleShare = useCallback(() => {
    if (!schedule || placed.length === 0) return;
    downloadTimetableImage({
      templateName: active?.name ?? "My timetable",
      termName: schedule.termName,
      credits,
      placed,
      breakdown: scoreTimetable(placed, prefs, liveOpen),
    });
  }, [schedule, active, credits, placed, prefs, liveOpen]);

  const termBounds = useMemo(() => {
    let start = "9999-12-31";
    let end = "0000-01-01";
    for (const course of schedule?.courses ?? []) {
      for (const section of course.sections) {
        for (const m of section.meetings) {
          if (m.dateFrom < start) start = m.dateFrom;
          if (m.dateTo > end) end = m.dateTo;
        }
      }
    }
    return { start, end };
  }, [schedule]);

  const careers = useMemo(() => {
    const set = new Set<string>();
    for (const course of schedule?.courses ?? []) set.add(course.career);
    return [...set].sort();
  }, [schedule]);

  const listRef = useRef<HTMLDivElement>(null);

  // ---- render -------------------------------------------------------------

  if (error && !schedule) {
    return (
      <div className="m-8 rounded-lg border border-rose-500/40 bg-rose-500/10 p-6 text-sm">
        <p className="font-semibold text-rose-200">Couldn&apos;t load planner data</p>
        <p className="mt-2 text-rose-100/80">{error}</p>
      </div>
    );
  }

  const ratedCount = filtered.filter((r) => r.chips.some((c) => c.score)).length;

  return (
    <div className="flex flex-col gap-4 p-4 lg:p-6">
      <header className="flex flex-wrap items-end justify-between gap-4 print:hidden">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">UST Course Planner</h1>
          <p className="text-xs text-muted mt-1">
            Ratings shown per section. Unofficial — not affiliated with HKUST.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs">
          {index && index.terms.length > 0 ? (
            <label className="flex items-center gap-2">
              <span className="text-muted">Term</span>
              <select
                value={termNum ?? ""}
                onChange={(e) => setTermNum(Number(e.target.value))}
                className="rounded-md bg-surface-raised px-2 py-1.5 ring-1 ring-border-subtle outline-none focus:ring-sky-500"
              >
                {[...index.terms]
                  .sort((a, b) => b.termNum - a.termNum)
                  .map((t) => (
                    <option key={t.termNum} value={t.termNum}>
                      {t.termName}
                    </option>
                  ))}
              </select>
            </label>
          ) : null}

          {index ? (
            <span
              className="text-muted"
              title={`Schedule source revision ${index.revision}`}
            >
              schedule as of {new Date(index.fetchedAt).toLocaleDateString()}
            </span>
          ) : null}
        </div>
      </header>

      <section className="rounded-lg bg-surface ring-1 ring-border-subtle p-3 print:hidden">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted mr-1">Rank by</span>
          <button
            type="button"
            onClick={() => setCriterion("all")}
            title="Show every category's ranking side by side, unweighted"
            className={`rounded-md px-2.5 py-1.5 text-xs font-medium ring-1 transition ${
              criterion === "all"
                ? "bg-sky-500/20 text-sky-200 ring-sky-500/50"
                : "bg-surface-raised text-muted ring-border-subtle hover:text-foreground"
            }`}
          >
            All categories
          </button>
          {CRITERIA.map((c) => {
            const meta = CRITERION_META[c];
            const on = criterion === c;
            return (
              <button
                key={c}
                type="button"
                onClick={() => setCriterion(c)}
                title={`${meta.blurb} · source: ${meta.source === "sfq" ? "official SFQ survey" : "student reviews"}`}
                className={`rounded-md px-2.5 py-1.5 text-xs font-medium ring-1 transition ${
                  on
                    ? "bg-sky-500/20 text-sky-200 ring-sky-500/50"
                    : "bg-surface-raised text-muted ring-border-subtle hover:text-foreground"
                }`}
              >
                {meta.label}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-muted">
          {criterion === "all"
            ? "Showing every category, unweighted and uncombined — pick one to rank the list by."
            : `${CRITERION_META[criterion].blurb}.`}{" "}
          Scores are percentiles against courses on offer this term, not raw survey numbers.
        </p>
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] print:block">
        {/* ---- browser ---- */}
        <section className="flex flex-col rounded-lg bg-surface ring-1 ring-border-subtle print:hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle p-3">
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setVisible(PAGE_SIZE);
                listRef.current?.scrollTo({ top: 0 });
              }}
              placeholder="Search code, title, or instructor…"
              className="min-w-0 flex-1 rounded-md bg-surface-raised px-3 py-2 text-sm ring-1 ring-border-subtle outline-none placeholder:text-muted focus:ring-sky-500"
            />
            <select
              value={career}
              onChange={(e) => setCareer(e.target.value)}
              className="rounded-md bg-surface-raised px-2 py-2 text-xs ring-1 ring-border-subtle outline-none focus:ring-sky-500"
            >
              <option value="all">All levels</option>
              {careers.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-xs text-muted">
              <input
                type="checkbox"
                checked={onlyRated}
                onChange={(e) => setOnlyRated(e.target.checked)}
                className="accent-sky-500"
              />
              rated only
            </label>
          </div>

          <div className="px-3 py-2 text-[11px] text-muted border-b border-border-subtle">
            {loading ? (
              "Loading…"
            ) : (
              <>
                {filtered.length} course{filtered.length === 1 ? "" : "s"} · {ratedCount}{" "}
                {criterion === "all"
                  ? "with a rating in at least one category"
                  : `with a ${CRITERION_META[criterion].label.toLowerCase()} rating`}
                {ratedCount < filtered.length ? (
                  <>
                    {" "}
                    · {filtered.length - ratedCount} unrated (still listed, sorted last)
                  </>
                ) : null}
              </>
            )}
          </div>

          <div ref={listRef} className="max-h-[70vh] overflow-y-auto">
            {filtered.slice(0, visible).map(({ course, chips }) => {
              const open = expanded === course.code;
              return (
                <div key={course.code} className="border-b border-border-subtle/60 last:border-0">
                  <div className="flex w-full items-start gap-2 p-3 hover:bg-surface-raised/60">
                    <button
                      type="button"
                      onClick={() => setExpanded(open ? null : course.code)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-semibold">{course.code}</span>
                        {criterion !== "all"
                          ? chips.map((chip) => (
                              <RatingBadge key={chip.key} score={chip.score} scale="courses" />
                            ))
                          : null}
                        <span className="text-[11px] text-muted">
                          {course.credits} cr · {course.sections.length} section
                          {course.sections.length === 1 ? "" : "s"}
                        </span>
                      </div>
                      <div className="mt-0.5 truncate text-sm text-foreground/90">
                        {course.title}
                      </div>
                      {/*
                        Six chips do not fit on the code line, so in
                        all-categories mode they get their own wrapping row.
                      */}
                      {criterion === "all" ? (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {chips.map((chip) => (
                            <RatingBadge
                              key={chip.key}
                              score={chip.score}
                              label={chip.label}
                              scale="courses"
                            />
                          ))}
                        </div>
                      ) : null}
                    </button>

                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <button
                        type="button"
                        onClick={() => toggleWanted(course.code)}
                        title={
                          wanted.has(course.code)
                            ? "Remove this course — also drops any pinned sections and clears it from the grid"
                            : "Want this course — the solver will fill in a section once smart mode runs"
                        }
                        className={`rounded-md px-2.5 py-1 text-xs font-medium ring-1 transition ${
                          wanted.has(course.code)
                            ? "bg-rose-500/15 text-rose-200 ring-rose-500/40 hover:bg-rose-500/25"
                            : "bg-sky-500/15 text-sky-200 ring-sky-500/40 hover:bg-sky-500/25"
                        }`}
                      >
                        {wanted.has(course.code) ? "Remove" : "Add"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setExpanded(open ? null : course.code)}
                        className="text-muted text-xs"
                      >
                        {open ? "−" : "+"}
                      </button>
                    </div>
                  </div>

                  {open ? (
                    <div className="px-3 pb-3">
                      {course.description ? (
                        <p className="mb-3 text-xs leading-relaxed text-muted">
                          {course.description}
                        </p>
                      ) : null}

                      {course.prerequisite || course.exclusion || course.corequisite ? (
                        <div className="mb-3 space-y-1 rounded-md bg-surface-raised p-2 text-[11px]">
                          {course.prerequisite ? (
                            <div>
                              <span className="text-muted">Prerequisite: </span>
                              {course.prerequisite}
                            </div>
                          ) : null}
                          {course.corequisite ? (
                            <div>
                              <span className="text-muted">Corequisite: </span>
                              {course.corequisite}
                            </div>
                          ) : null}
                          {course.exclusion ? (
                            <div>
                              <span className="text-muted">Exclusion: </span>
                              {course.exclusion}
                            </div>
                          ) : null}
                          <p className="pt-1 text-muted italic">
                            Shown as written by HKUST — the planner does not check these for you.
                          </p>
                        </div>
                      ) : null}

                      {/*
                        The course badges above and the instructor badges below
                        share a letter vocabulary but are not the same
                        measurement, and stacked together they read as if they
                        were. Say so once per course rather than on every
                        section or every chip.
                      */}
                      <p className="mb-2 text-[10px] text-muted">
                        Instructor scores rank each person against all instructors, averaged
                        over every course they teach — not against this course&apos;s score
                        above.
                      </p>

                      <div className="space-y-1.5">
                        {course.sections.map((section) => (
                          <SectionRow
                            key={section.number}
                            section={section}
                            pinned={pinned.has(section.number)}
                            clashing={clashKeys.has(`${course.code}:${section.section}`)}
                            seat={seatState.seats[String(section.number)] ?? null}
                            seatsFailed={seatState.failed}
                            instructorChips={instructorChips}
                            onTogglePin={() => togglePin(section.number)}
                          />
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}

            {visible < filtered.length ? (
              <button
                type="button"
                onClick={() => setVisible((v) => v + PAGE_SIZE)}
                className="w-full p-3 text-xs text-sky-300 hover:bg-surface-raised"
              >
                Show {Math.min(PAGE_SIZE, filtered.length - visible)} more
              </button>
            ) : null}

            {!loading && filtered.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted">No courses match that search.</p>
            ) : null}
          </div>
        </section>

        {/* ---- timetable ---- */}
        <section className="flex flex-col gap-3">
          <div className="print:hidden">
            <TemplateBar
              store={store}
              setStore={setStore}
              termNum={termNum}
              credits={credits}
              clashCount={clashes.length}
            />
          </div>

          <div className="print:hidden">
            <PreferencePanel
              enabled={smartPlannerEnabled}
              onChangeEnabled={setSmartPlannerEnabled}
              wantedCodes={active?.termNum === termNum ? (active?.wanted ?? []) : []}
              courses={schedule?.courses ?? []}
              prefs={prefs}
              onChangePrefs={setPrefs}
              onRemoveWanted={toggleWanted}
              onGenerate={handleGenerate}
              error={solveOutcome?.error ?? null}
            />
          </div>

          {clashes.length > 0 ? (
            <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-xs">
              <p className="font-semibold text-rose-200">
                {clashes.length} time clash{clashes.length === 1 ? "" : "es"}
              </p>
              <ul className="mt-1.5 space-y-1 text-rose-100/85">
                {clashes.map((c, i) => (
                  <li key={i}>
                    {c.a.code} {c.a.section} ↔ {c.b.code} {c.b.section} — {c.detail}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="rounded-lg bg-surface ring-1 ring-border-subtle p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 print:hidden">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold">Timetable</h2>
                <div className="flex rounded-md ring-1 ring-border-subtle overflow-hidden text-[11px]">
                  <button
                    type="button"
                    onClick={() => setView("grid")}
                    className={`px-2 py-1 font-medium transition ${
                      view === "grid"
                        ? "bg-sky-500/20 text-sky-200"
                        : "bg-surface-raised text-muted hover:text-foreground"
                    }`}
                  >
                    Grid
                  </button>
                  <button
                    type="button"
                    onClick={() => setView("list")}
                    className={`px-2 py-1 font-medium transition ${
                      view === "list"
                        ? "bg-sky-500/20 text-sky-200"
                        : "bg-surface-raised text-muted hover:text-foreground"
                    }`}
                  >
                    List
                  </button>
                </div>
              </div>
              {placed.length > 0 ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleShare}
                    title="Renders the grid to a PNG image and downloads it — nothing is uploaded anywhere"
                    className="rounded-md bg-surface-raised px-2.5 py-1 text-xs font-medium text-sky-300 ring-1 ring-border-subtle hover:text-sky-200"
                  >
                    Share as image
                  </button>
                  <button
                    type="button"
                    onClick={() => window.print()}
                    title="Opens your browser's print dialog — choose 'Save as PDF' as the destination"
                    className="rounded-md bg-surface-raised px-2.5 py-1 text-xs font-medium text-sky-300 ring-1 ring-border-subtle hover:text-sky-200"
                  >
                    Export as PDF
                  </button>
                </div>
              ) : null}
            </div>

            {placed.length === 0 ? (
              <p className="py-16 text-center text-sm text-muted">
                Pick sections on the left and they&apos;ll appear here.
              </p>
            ) : (
              <>
                <PrintSummary
                  templateName={active?.name ?? "My timetable"}
                  termName={schedule?.termName ?? ""}
                  placed={placed}
                  credits={credits}
                  generatedAt={new Date()}
                />
                <div className="print:hidden">
                  {view === "grid" ? (
                    <WeekGrid
                      placed={placed}
                      clashKeys={clashKeys}
                      termStart={termBounds.start}
                      termEnd={termBounds.end}
                      onRemove={togglePin}
                    />
                  ) : (
                    <CourseListView
                      courses={schedule?.courses ?? []}
                      placed={placed}
                      courseChips={courseChips}
                      instructorChips={instructorChips}
                    />
                  )}
                </div>
              </>
            )}
            {placed.length > 0 && view === "grid" ? (
              <p className="mt-2 text-[11px] text-muted print:hidden">
                Click a block to remove it. Amber dates mark meetings that run for only part of
                the term.
              </p>
            ) : null}
          </div>

          <div className="print:hidden">
            {placed.length > 0 ? (
              <Link
                href={`/rate?${encodePrefs(prefs, active?.id ?? null).toString()}`}
                title="Score this timetable against your preferences, with comments and alternatives — a separate page"
                className="block w-full rounded-md bg-sky-500/20 px-3 py-2.5 text-center text-sm font-semibold text-sky-200 ring-1 ring-sky-500/50 transition hover:bg-sky-500/30"
              >
                Rate my timetable →
              </Link>
            ) : (
              <span
                title="Pick sections first — there's nothing to rate yet"
                className="block w-full cursor-not-allowed rounded-md bg-surface-raised px-3 py-2.5 text-center text-sm font-semibold text-muted/60 ring-1 ring-border-subtle"
              >
                Rate my timetable →
              </span>
            )}
          </div>

          <p className="text-[11px] text-muted print:hidden">
            {seatState.failed
              ? "Live seat counts unavailable — showing the daily snapshot instead."
              : seatState.retrievedAt
                ? `Live seat counts retrieved ${new Date(seatState.retrievedAt).toLocaleTimeString()}. Advisory only — SIS is authoritative.`
                : "Fetching live seat counts…"}
          </p>
        </section>
      </div>
    </div>
  );
}
