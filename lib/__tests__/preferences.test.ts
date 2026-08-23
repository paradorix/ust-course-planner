import { describe, expect, it } from "vitest";
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

function placed(number: number, meetings: Meeting[], sectionOverrides: Partial<Section> = {}): PlacedSection {
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
    ...sectionOverrides,
  };
  return { code: "COMP2011", section };
}

describe("scoreTimetable — never refuses", () => {
  it("scores an empty timetable without throwing", () => {
    const result = scoreTimetable([], DEFAULT_PREFERENCES);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.violations).toEqual([]);
  });

  it("still returns a real score for an impossible combination of preferences", () => {
    const items = [
      placed(1, [meeting({ weekday: "Fri", timeFrom: "08:00", timeTo: "09:00" })]),
      placed(2, [meeting({ weekday: "Fri", timeFrom: "20:00", timeTo: "21:00" })]),
    ];
    const prefs: Preferences = {
      ...DEFAULT_PREFERENCES,
      earliestStart: "10:00",
      latestEnd: "17:00",
      maxDays: 0,
      blockedDays: ["Fri"],
    };
    const result = scoreTimetable(items, prefs);
    // Every axis is violated; the function must still return a finite score
    // and name every violation rather than throwing or returning nothing.
    expect(Number.isFinite(result.score)).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0);
    const keys = result.violations.map((v) => v.key).sort();
    // Also picks up "compactness": the two meetings are 11 hours apart.
    expect(keys).toEqual(["blockedDays", "compactness", "earliestStart", "latestEnd", "maxDays"]);
  });
});

describe("scoreTimetable — individual axes", () => {
  it("penalizes starting earlier than requested", () => {
    const items = [placed(1, [meeting({ timeFrom: "08:00", timeTo: "08:50" })])];
    const prefs: Preferences = { ...DEFAULT_PREFERENCES, earliestStart: "10:00" };
    const result = scoreTimetable(items, prefs);
    expect(result.violations.some((v) => v.key === "earliestStart")).toBe(true);
  });

  it("does not penalize starting at or after the requested time", () => {
    const items = [placed(1, [meeting({ timeFrom: "10:00", timeTo: "10:50" })])];
    const prefs: Preferences = { ...DEFAULT_PREFERENCES, earliestStart: "10:00" };
    const result = scoreTimetable(items, prefs);
    expect(result.violations.some((v) => v.key === "earliestStart")).toBe(false);
  });

  it("penalizes exceeding maxDays", () => {
    const items = [
      placed(1, [meeting({ weekday: "Mon" })]),
      placed(2, [meeting({ weekday: "Tue" })]),
      placed(3, [meeting({ weekday: "Wed" })]),
    ];
    const prefs: Preferences = { ...DEFAULT_PREFERENCES, maxDays: 1 };
    const result = scoreTimetable(items, prefs);
    const violation = result.violations.find((v) => v.key === "maxDays");
    expect(violation).toBeDefined();
    expect(violation!.detail).toContain("3 days");
  });

  it("penalizes meeting on a blocked day", () => {
    const items = [placed(1, [meeting({ weekday: "Fri" })])];
    const prefs: Preferences = { ...DEFAULT_PREFERENCES, blockedDays: ["Fri"] };
    const result = scoreTimetable(items, prefs);
    expect(result.violations.some((v) => v.key === "blockedDays")).toBe(true);
  });

  it("uses live seat status over the snapshot when both are present", () => {
    const items = [placed(1, [meeting()], { snapshotOpen: true })];
    const prefs: Preferences = { ...DEFAULT_PREFERENCES, preferOpenSeats: true };
    const result = scoreTimetable(items, prefs, { 1: false });
    expect(result.violations.some((v) => v.key === "openSeats")).toBe(true);
  });

  it("falls back to the snapshot when no live status is given", () => {
    const items = [placed(1, [meeting()], { snapshotOpen: false })];
    const prefs: Preferences = { ...DEFAULT_PREFERENCES, preferOpenSeats: true };
    const result = scoreTimetable(items, prefs);
    expect(result.violations.some((v) => v.key === "openSeats")).toBe(true);
  });

  it("a timetable satisfying every preference scores at the top and has no violations", () => {
    const items = [placed(1, [meeting({ weekday: "Mon", timeFrom: "10:00", timeTo: "10:50" })])];
    const prefs: Preferences = {
      ...DEFAULT_PREFERENCES,
      earliestStart: "09:00",
      latestEnd: "18:00",
      maxDays: 5,
      blockedDays: [],
      preferOpenSeats: false,
      preferCompact: false,
    };
    const result = scoreTimetable(items, prefs);
    expect(result.violations).toEqual([]);
    expect(result.score).toBe(100);
  });
});
