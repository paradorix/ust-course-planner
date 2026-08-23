import { describe, expect, it } from "vitest";
import { buildComments } from "../comments.ts";
import { DEFAULT_PREFERENCES, scoreTimetable, type Preferences } from "../preferences.ts";
import type { PlacedSection } from "../conflicts.ts";
import type { Meeting, Section } from "../types.ts";

function meeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    weekday: "Mon",
    dateFrom: "2026-09-01",
    dateTo: "2026-12-01",
    timeFrom: "10:00",
    timeTo: "10:50",
    venue: "LTA",
    venueName: "Lecture Theatre A",
    instructors: [],
    ...overrides,
  };
}

function placed(number: number, meetings: Meeting[]): PlacedSection {
  const section: Section = {
    section: "L1",
    number,
    type: "LEC",
    role: "E",
    association: 1,
    remarks: "",
    consent: false,
    meetings,
    snapshotCapacity: 50,
    snapshotEnroll: 10,
    snapshotWait: 0,
    snapshotOpen: true,
  };
  return { code: "COMP2011", section };
}

describe("buildComments — empty timetable", () => {
  it("says there's nothing to comment on rather than fabricating facts", () => {
    const breakdown = scoreTimetable([], DEFAULT_PREFERENCES);
    expect(buildComments(breakdown, [])).toEqual([{ id: "empty", text: "Nothing is on this timetable yet." }]);
  });
});

describe("buildComments — thresholds", () => {
  const fiveDays = ["Mon", "Tue", "Wed", "Thu", "Fri"].map((day, i) =>
    placed(i + 1, [meeting({ weekday: day as Meeting["weekday"] })]),
  );

  it("comments on 5+ days on campus with no preferences set (the hollow-100 case)", () => {
    const breakdown = scoreTimetable(fiveDays, DEFAULT_PREFERENCES);
    expect(breakdown.score).toBe(100); // inert preferences — score is hollow
    const comments = buildComments(breakdown, fiveDays);
    expect(comments.some((c) => c.id === "daysOnCampus")).toBe(true);
  });

  it("stays silent on days-on-campus under the threshold", () => {
    const twoDays = [
      placed(1, [meeting({ weekday: "Mon" })]),
      placed(2, [meeting({ weekday: "Tue" })]),
    ];
    const breakdown = scoreTimetable(twoDays, DEFAULT_PREFERENCES);
    expect(buildComments(breakdown, twoDays).some((c) => c.id === "daysOnCampus")).toBe(false);
  });

  it("flags a late end and an early start independently", () => {
    const rough = [
      placed(1, [meeting({ weekday: "Mon", timeFrom: "08:00", timeTo: "08:50" })]),
      placed(2, [meeting({ weekday: "Tue", timeFrom: "19:00", timeTo: "19:50" })]),
    ];
    const breakdown = scoreTimetable(rough, DEFAULT_PREFERENCES);
    const ids = buildComments(breakdown, rough).map((c) => c.id);
    expect(ids).toContain("earlyStart");
    expect(ids).toContain("lateEnd");
  });

  it("flags large gaps between classes on the same day", () => {
    const gappy = [
      placed(1, [meeting({ weekday: "Mon", timeFrom: "09:00", timeTo: "09:50" })]),
      placed(2, [meeting({ weekday: "Mon", timeFrom: "13:00", timeTo: "13:50" })]),
    ];
    // preferCompact off, so this exercises the independent threshold comment
    // rather than the "violation-compactness" path (DEFAULT_PREFERENCES has
    // preferCompact: true, which would otherwise turn the same gap into a
    // violation and suppress this comment by design — see the dedup test
    // below).
    const prefs: Preferences = { ...DEFAULT_PREFERENCES, preferCompact: false };
    const breakdown = scoreTimetable(gappy, prefs);
    expect(buildComments(breakdown, gappy).some((c) => c.id === "gaps")).toBe(true);
  });

  it("reports a gap through the violation channel instead when preferCompact is on (the default)", () => {
    const gappy = [
      placed(1, [meeting({ weekday: "Mon", timeFrom: "09:00", timeTo: "09:50" })]),
      placed(2, [meeting({ weekday: "Mon", timeFrom: "13:00", timeTo: "13:50" })]),
    ];
    const breakdown = scoreTimetable(gappy, DEFAULT_PREFERENCES);
    const comments = buildComments(breakdown, gappy);
    expect(comments.some((c) => c.id === "gaps")).toBe(false);
    expect(comments.some((c) => c.id === "violation-compactness")).toBe(true);
  });

  it("falls back to a single clean-week comment when nothing crosses a threshold", () => {
    const tidy = [placed(1, [meeting({ weekday: "Mon", timeFrom: "10:00", timeTo: "10:50" })])];
    const breakdown = scoreTimetable(tidy, DEFAULT_PREFERENCES);
    const comments = buildComments(breakdown, tidy);
    expect(comments).toHaveLength(1);
    expect(comments[0].id).toBe("clean");
  });

  it("does not double-report an axis already covered by a violation", () => {
    const prefs: Preferences = { ...DEFAULT_PREFERENCES, maxDays: 1 };
    const breakdown = scoreTimetable(fiveDays, prefs);
    const comments = buildComments(breakdown, fiveDays);
    // The violation for maxDays is present, but the independent
    // daysOnCampus comment must be suppressed to avoid saying it twice.
    expect(comments.some((c) => c.id === "daysOnCampus")).toBe(false);
    expect(comments.some((c) => c.id === "violation-maxDays")).toBe(true);
  });
});

describe("buildComments — ignores the score itself", () => {
  it("produces identical comments for breakdowns that differ only in score", () => {
    const tidy = [placed(1, [meeting({ weekday: "Mon", timeFrom: "10:00", timeTo: "10:50" })])];
    const breakdown = scoreTimetable(tidy, DEFAULT_PREFERENCES);
    const tampered = { ...breakdown, score: 3 };
    expect(buildComments(tampered, tidy)).toEqual(buildComments(breakdown, tidy));
  });
});
