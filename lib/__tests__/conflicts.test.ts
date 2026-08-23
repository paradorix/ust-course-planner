/**
 * Regression coverage for existing conflict detection — the project shipped
 * with none, and this logic is now load-bearing for the solver too.
 */

import { describe, expect, it } from "vitest";
import { findClashes, meetingsClash, toMinutes, type PlacedSection } from "../conflicts.ts";
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
    instructors: ["CHENG, Kam Hang"],
    ...overrides,
  };
}

function section(overrides: Partial<Section> = {}): Section {
  return {
    section: "L1",
    number: 1000,
    type: "LEC",
    role: "E",
    association: 1,
    remarks: "",
    consent: false,
    meetings: [meeting()],
    snapshotCapacity: 50,
    snapshotEnroll: 10,
    snapshotWait: 0,
    snapshotOpen: true,
    ...overrides,
  };
}

describe("toMinutes", () => {
  it("converts HH:MM to minutes since midnight", () => {
    expect(toMinutes("00:00")).toBe(0);
    expect(toMinutes("10:30")).toBe(630);
    expect(toMinutes("23:59")).toBe(1439);
  });
});

describe("meetingsClash", () => {
  it("does not clash on different weekdays", () => {
    const a = meeting({ weekday: "Mon" });
    const b = meeting({ weekday: "Tue" });
    expect(meetingsClash(a, b)).toBe(false);
  });

  it("clashes on overlapping time on the same weekday", () => {
    const a = meeting({ timeFrom: "10:00", timeTo: "10:50" });
    const b = meeting({ timeFrom: "10:30", timeTo: "11:20" });
    expect(meetingsClash(a, b)).toBe(true);
  });

  it("does not clash when one ends exactly as the other starts (half-open)", () => {
    const a = meeting({ timeFrom: "10:00", timeTo: "10:50" });
    const b = meeting({ timeFrom: "10:50", timeTo: "11:40" });
    expect(meetingsClash(a, b)).toBe(false);
  });

  it("does not clash when date windows don't overlap, even at the same time", () => {
    const a = meeting({ dateFrom: "2026-09-01", dateTo: "2026-10-15" });
    const b = meeting({ dateFrom: "2026-10-16", dateTo: "2026-12-01" });
    expect(meetingsClash(a, b)).toBe(false);
  });

  it("clashes when date windows overlap even partially", () => {
    const a = meeting({ dateFrom: "2026-09-01", dateTo: "2026-10-15" });
    const b = meeting({ dateFrom: "2026-10-15", dateTo: "2026-12-01" });
    expect(meetingsClash(a, b)).toBe(true);
  });
});

describe("findClashes", () => {
  it("finds no clashes among non-overlapping sections", () => {
    const placed: PlacedSection[] = [
      { code: "COMP2011", section: section({ number: 1, meetings: [meeting({ weekday: "Mon" })] }) },
      { code: "MATH1013", section: section({ number: 2, meetings: [meeting({ weekday: "Tue" })] }) },
    ];
    expect(findClashes(placed)).toHaveLength(0);
  });

  it("finds exactly one clash for one overlapping pair, deduped", () => {
    const placed: PlacedSection[] = [
      {
        code: "ACCT2010",
        section: section({ number: 1, section: "L01", meetings: [meeting({ timeFrom: "11:00", timeTo: "12:20" })] }),
      },
      {
        code: "COMP2011",
        section: section({ number: 2, section: "L1", meetings: [meeting({ timeFrom: "11:50", timeTo: "13:20" })] }),
      },
    ];
    const clashes = findClashes(placed);
    expect(clashes).toHaveLength(1);
    expect(clashes[0].a.code).toBe("ACCT2010");
    expect(clashes[0].b.code).toBe("COMP2011");
  });
});
