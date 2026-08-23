"use client";

/**
 * Rate my timetable, as a destination rather than an always-visible card.
 *
 * Reloads its own data rather than receiving it from the planner — this is
 * a real route, not an overlay, so nothing survives navigation except what
 * this URL and localStorage carry. That means three independent things have
 * to line up for the score shown here to mean the same thing it would on
 * the planner:
 *
 *   1. The timetable: always the *active* localStorage template (lib/
 *      templates.ts), never something encoded in the URL. A `?t=` param
 *      records which template was active when the link was made, purely so
 *      a mismatch against the *current* active template can be caught and
 *      shown, rather than silently scoring a stranger's timetable (or your
 *      own, since-changed one) against preferences that aren't about it.
 *   2. The preferences: decoded from the URL (lib/prefs-url.ts) — they live
 *      only as React state on the planner and would otherwise vanish on
 *      navigation.
 *   3. Live seat data (/api/seats): scoreTimetable falls back to each
 *      section's daily snapshot when this is missing, so this page always
 *      waits for it to settle (success or failure) before its first paint —
 *      otherwise the same timetable could show two different scores
 *      depending on which page loaded it, and ScoreReveal would have to
 *      jump mid-animation when the real number arrived late.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import AlternativesList from "@/components/AlternativesList";
import type { Chip, SeatInfo } from "@/components/Planner";
import TimetableScore from "@/components/TimetableScore";
import { contrastiveAlternatives, type Alternative } from "@/lib/alternatives";
import type { PlacedSection } from "@/lib/conflicts";
import { decodePrefs, decodeTemplateId } from "@/lib/prefs-url";
import { scoreTimetable } from "@/lib/preferences";
import { scoreOf } from "@/lib/rating";
import type { SolveResult } from "@/lib/solver";
import { loadStore, saveStore, type Store } from "@/lib/templates";
import { CRITERIA, CRITERION_META, type RatingsFile, type TermSchedule } from "@/lib/types";

export default function RateView() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const prefs = useMemo(() => decodePrefs(searchParams), [searchParams]);
  const linkedTemplateId = useMemo(() => decodeTemplateId(searchParams), [searchParams]);

  const [store, setStore] = useState<Store>({ version: 2, activeId: null, templates: [] });
  const [hydrated, setHydrated] = useState(false);

  const [schedule, setSchedule] = useState<TermSchedule | null>(null);
  const [instructorRatings, setInstructorRatings] = useState<RatingsFile | null>(null);
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  const [liveOpen, setLiveOpen] = useState<Record<number, boolean>>({});
  const [seatsSettled, setSeatsSettled] = useState(false);

  useEffect(() => {
    setStore(loadStore());
    setHydrated(true);
  }, []);

  const active = useMemo(
    () => store.templates.find((t) => t.id === store.activeId) ?? null,
    [store],
  );

  // Fetch the active template's own term — not necessarily whatever term the
  // planner last had selected, since that selection lives in Planner's own
  // state, not the template.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    (async () => {
      try {
        const [scheduleResp, instructorResp] = await Promise.all([
          fetch(`/data/schedule/term-${active.termNum}.json`),
          fetch("/data/ratings/instructors.json"),
        ]);
        if (!scheduleResp.ok) throw new Error(`term ${active.termNum}: HTTP ${scheduleResp.status}`);
        const term = (await scheduleResp.json()) as TermSchedule;
        // Ratings are optional — a term can exist before its ratings slice
        // does, same as the planner treats it.
        const instructors = instructorResp.ok
          ? ((await instructorResp.json()) as RatingsFile)
          : null;
        if (cancelled) return;
        setSchedule(term);
        setInstructorRatings(instructors);
      } catch (e) {
        if (!cancelled) setScheduleError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active]);

  // See file header: this page waits for seats to settle before its first
  // paint rather than treating them as a live update like the planner does,
  // so the score never changes out from under the reveal animation.
  useEffect(() => {
    if (!schedule) return;
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch("/api/seats");
        if (!resp.ok) throw new Error(String(resp.status));
        const body = (await resp.json()) as { seats: Record<string, SeatInfo> };
        if (cancelled) return;
        const map: Record<number, boolean> = {};
        for (const [numStr, info] of Object.entries(body.seats)) map[Number(numStr)] = info.open;
        setLiveOpen(map);
      } catch {
        // Non-fatal — scoreTimetable falls back to each section's daily
        // snapshot when a class number is missing from liveOpen.
      } finally {
        if (!cancelled) setSeatsSettled(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [schedule]);

  const placed: PlacedSection[] = useMemo(() => {
    if (!schedule || !active) return [];
    const selected = new Set(active.selected);
    const out: PlacedSection[] = [];
    for (const course of schedule.courses) {
      for (const section of course.sections) {
        if (selected.has(section.number)) out.push({ code: course.code, section });
      }
    }
    return out;
  }, [schedule, active]);

  const instructorChips = useCallback(
    (name: string): Chip[] =>
      CRITERIA.map((c) => ({
        key: c,
        label: CRITERION_META[c].label,
        score: instructorRatings
          ? scoreOf(instructorRatings.entries[name], c, instructorRatings.distribution)
          : null,
      })),
    [instructorRatings],
  );

  const breakdown = useMemo(
    () => scoreTimetable(placed, prefs, liveOpen),
    [placed, prefs, liveOpen],
  );

  const alternatives: Alternative[] = useMemo(() => {
    if (!schedule || !active || placed.length === 0) return [];
    // The baseline is the timetable actually on screen, not a fresh solve —
    // otherwise this would diff against a pick the student never made. See
    // lib/alternatives.ts: it accepts any SolveResult shape, so a
    // hand-assembled one is exactly as valid as the solver's own output.
    const current: SolveResult = { placed, breakdown };
    return contrastiveAlternatives(
      schedule.courses,
      active.wanted,
      active.pinned,
      prefs,
      current,
      { liveOpen },
    );
  }, [schedule, active, placed, breakdown, prefs, liveOpen]);

  const handleApplyAlternative = useCallback(
    (alt: Alternative) => {
      if (!active) return;
      const latest = loadStore();
      const updated: Store = {
        ...latest,
        templates: latest.templates.map((t) =>
          t.id === active.id
            ? {
                ...t,
                selected: alt.result.placed.map((p) => p.section.number),
                updatedAt: new Date().toISOString(),
              }
            : t,
        ),
      };
      saveStore(updated);
      router.push("/");
    },
    [active, router],
  );

  const mismatch = hydrated && linkedTemplateId !== null && linkedTemplateId !== store.activeId;

  const loading = !hydrated || (active !== null && (!schedule || !seatsSettled));

  if (hydrated && !active) {
    return (
      <div className="mx-auto max-w-lg p-8 text-center">
        <p className="text-sm text-muted">Nothing to rate yet.</p>
        <p className="mt-1 text-xs text-muted">
          Build a timetable on the planner first, then come back here.
        </p>
        <Link
          href="/"
          className="mt-4 inline-block rounded-md bg-sky-500/20 px-3 py-2 text-xs font-semibold text-sky-200 ring-1 ring-sky-500/50 hover:bg-sky-500/30"
        >
          Back to planner
        </Link>
      </div>
    );
  }

  if (scheduleError) {
    return (
      <div className="m-8 rounded-lg border border-rose-500/40 bg-rose-500/10 p-6 text-sm">
        <p className="font-semibold text-rose-200">Couldn&apos;t load this timetable</p>
        <p className="mt-2 text-rose-100/80">{scheduleError}</p>
        <Link href="/" className="mt-3 inline-block text-xs text-sky-300 hover:text-sky-200">
          Back to planner
        </Link>
      </div>
    );
  }

  if (loading || !active) {
    return <div className="p-8 text-center text-sm text-muted">Loading…</div>;
  }

  if (placed.length === 0) {
    return (
      <div className="mx-auto max-w-lg p-8 text-center">
        <p className="text-sm text-muted">Nothing to rate yet.</p>
        <p className="mt-1 text-xs text-muted">
          &ldquo;{active.name}&rdquo; has no sections placed. Pin or generate a timetable first.
        </p>
        <Link
          href="/"
          className="mt-4 inline-block rounded-md bg-sky-500/20 px-3 py-2 text-xs font-semibold text-sky-200 ring-1 ring-sky-500/50 hover:bg-sky-500/30"
        >
          Back to planner
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 p-4 lg:p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Rate my timetable</h1>
          <p className="mt-1 text-xs text-muted">{active.name}</p>
        </div>
        <Link href="/" className="text-xs text-sky-300 hover:text-sky-200">
          ← Planner
        </Link>
      </header>

      {mismatch ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-100/90">
          This link carries preferences set for a different saved timetable than the one that&apos;s
          currently active (&ldquo;{active.name}&rdquo;). The score below is &ldquo;{active.name}
          &rdquo; scored against those preferences — not necessarily what either was meant to
          measure.
        </div>
      ) : null}

      <TimetableScore
        placed={placed}
        prefs={prefs}
        liveOpen={liveOpen}
        instructorChips={instructorChips}
      />

      <AlternativesList alternatives={alternatives} onApply={handleApplyAlternative} />
    </div>
  );
}
