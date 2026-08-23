import { describe, expect, it } from "vitest";
import {
  daysOnCampus,
  daysUsed,
  earliestStart,
  latestEnd,
  longestDayMinutes,
  totalGapMinutes,
} from "../schedule-metrics.ts";
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

function placed(code: string, number: number, meetings: Meeting[]): PlacedSection {
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
  return { code, section };
}

describe("daysUsed / daysOnCampus", () => {
  it("returns no days for an empty timetable", () => {
    expect(daysUsed([])).toEqual([]);
    expect(daysOnCampus([])).toBe(0);
  });

  it("returns unique days in WEEKDAYS order regardless of meeting order", () => {
    const items = [
      placed("A", 1, [meeting({ weekday: "Wed" })]),
      placed("B", 2, [meeting({ weekday: "Mon" }), meeting({ weekday: "Wed" })]),
    ];
    expect(daysUsed(items)).toEqual(["Mon", "Wed"]);
    expect(daysOnCampus(items)).toBe(2);
  });
});

describe("earliestStart / latestEnd", () => {
  it("returns null with no meetings", () => {
    expect(earliestStart([placed("A", 1, [])])).toBeNull();
    expect(latestEnd([placed("A", 1, [])])).toBeNull();
  });

  it("finds the true min/max across sections", () => {
    const items = [
      placed("A", 1, [meeting({ timeFrom: "10:00", timeTo: "10:50" })]),
      placed("B", 2, [meeting({ timeFrom: "08:00", timeTo: "09:15" })]),
      placed("C", 3, [meeting({ timeFrom: "16:00", timeTo: "18:50" })]),
    ];
    expect(earliestStart(items)).toBe(8 * 60);
    expect(latestEnd(items)).toBe(18 * 60 + 50);
  });
});

describe("totalGapMinutes", () => {
  it("is zero for back-to-back meetings", () => {
    const items = [
      placed("A", 1, [meeting({ timeFrom: "10:00", timeTo: "10:50" })]),
      placed("B", 2, [meeting({ timeFrom: "10:50", timeTo: "11:40" })]),
    ];
    expect(totalGapMinutes(items)).toBe(0);
  });

  it("counts the idle window between two meetings on the same day", () => {
    const items = [
      placed("A", 1, [meeting({ timeFrom: "09:00", timeTo: "09:50" })]),
      placed("B", 2, [meeting({ timeFrom: "13:00", timeTo: "13:50" })]),
    ];
    expect(totalGapMinutes(items)).toBe(13 * 60 - 9 * 60 - 50);
  });

  it("does not double count overlapping meetings as a gap", () => {
    const items = [
      placed("A", 1, [meeting({ timeFrom: "09:00", timeTo: "10:50" })]),
      placed("B", 2, [meeting({ timeFrom: "10:00", timeTo: "11:00" })]),
    ];
    expect(totalGapMinutes(items)).toBe(0);
  });

  it("sums gaps independently across different days", () => {
    const items = [
      placed("A", 1, [
        meeting({ weekday: "Mon", timeFrom: "09:00", timeTo: "09:50" }),
        meeting({ weekday: "Mon", timeFrom: "11:00", timeTo: "11:50" }),
      ]),
      placed("B", 2, [
        meeting({ weekday: "Wed", timeFrom: "09:00", timeTo: "09:50" }),
        meeting({ weekday: "Wed", timeFrom: "10:00", timeTo: "10:50" }),
      ]),
    ];
    // Monday: 70 min gap (09:50 -> 11:00). Wednesday: 10 min gap.
    expect(totalGapMinutes(items)).toBe(70 + 10);
  });
});

describe("longestDayMinutes", () => {
  it("is zero with no meetings", () => {
    expect(longestDayMinutes([])).toBe(0);
  });

  it("spans from first start to last end on the busiest day", () => {
    const items = [
      placed("A", 1, [meeting({ weekday: "Mon", timeFrom: "09:00", timeTo: "09:50" })]),
      placed("B", 2, [meeting({ weekday: "Mon", timeFrom: "16:00", timeTo: "17:50" })]),
      placed("C", 3, [meeting({ weekday: "Tue", timeFrom: "10:00", timeTo: "10:50" })]),
    ];
    expect(longestDayMinutes(items)).toBe(17 * 60 + 50 - 9 * 60);
  });
});
