import { describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES, type Preferences } from "../preferences.ts";
import { solve } from "../solver.ts";
import type { Course, Meeting, Section } from "../types.ts";

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

function section(overrides: Partial<Section>): Section {
  return {
    section: "L1",
    number: 1,
    type: "LEC",
    role: "E",
    association: null,
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

function course(code: string, sections: Section[]): Course {
  return {
    id: code,
    prefix: code.slice(0, 4),
    number: code.slice(4),
    code,
    title: code,
    credits: 3,
    career: "UGRD",
    description: "",
    prerequisite: "",
    corequisite: "",
    exclusion: "",
    attributes: [],
    sections,
  };
}

describe("solve — association pairing (MATH1013-style: TUT tied to its own LEC)", () => {
  const math = course("MATH1013", [
    section({
      number: 101,
      section: "L01",
      type: "LEC",
      role: "E",
      association: 1,
      meetings: [meeting({ weekday: "Mon", timeFrom: "10:00", timeTo: "10:50" })],
    }),
    section({
      number: 102,
      section: "L02",
      type: "LEC",
      role: "E",
      association: 2,
      meetings: [meeting({ weekday: "Tue", timeFrom: "10:00", timeTo: "10:50" })],
    }),
    section({
      number: 111,
      section: "T01A",
      type: "TUT",
      role: "N",
      association: 1,
      meetings: [meeting({ weekday: "Wed", timeFrom: "14:00", timeTo: "14:50" })],
    }),
    section({
      number: 121,
      section: "T02A",
      type: "TUT",
      role: "N",
      association: 2,
      meetings: [meeting({ weekday: "Thu", timeFrom: "14:00", timeTo: "14:50" })],
    }),
  ]);

  it("never pairs a lecture with a tutorial from a different association group", () => {
    const outcome = solve([math], ["MATH1013"], [], DEFAULT_PREFERENCES, { limit: 100 });
    expect(outcome.error).toBeNull();
    expect(outcome.results.length).toBeGreaterThan(0);
    for (const result of outcome.results) {
      const numbers = result.placed.map((p) => p.section.number).sort();
      // Only (L01,T01A) or (L02,T02A) are legal — never a cross pairing.
      expect(numbers).toSatisfy(
        (ns: number[]) =>
          (ns[0] === 101 && ns[1] === 111) || (ns[0] === 102 && ns[1] === 121),
      );
    }
  });
});

describe("solve — association pairing (COMP1021-style: null means pairs freely)", () => {
  const comp = course("COMP1021", [
    section({
      number: 201,
      section: "L1",
      type: "LEC",
      role: "E",
      association: 1,
      meetings: [meeting({ weekday: "Mon", timeFrom: "09:00", timeTo: "09:50" })],
    }),
    section({
      number: 202,
      section: "L2",
      type: "LEC",
      role: "E",
      association: 2,
      meetings: [meeting({ weekday: "Tue", timeFrom: "09:00", timeTo: "09:50" })],
    }),
    section({
      number: 211,
      section: "LA1",
      type: "LAB",
      role: "N",
      association: null,
      meetings: [meeting({ weekday: "Wed", timeFrom: "15:00", timeTo: "16:50" })],
    }),
    section({
      number: 212,
      section: "LA2",
      type: "LAB",
      role: "N",
      association: null,
      meetings: [meeting({ weekday: "Thu", timeFrom: "15:00", timeTo: "16:50" })],
    }),
  ]);

  it("allows any lab with any lecture when the lab's association is null", () => {
    const outcome = solve([comp], ["COMP1021"], [], DEFAULT_PREFERENCES, { limit: 100 });
    expect(outcome.error).toBeNull();
    // 2 lectures x 2 labs = 4 legal, non-conflicting combinations.
    expect(outcome.results.length).toBe(4);
  });
});

describe("solve — pins", () => {
  const comp = course("COMP2011", [
    section({ number: 301, section: "L1", type: "LEC", role: "E", association: null }),
    section({ number: 302, section: "L2", type: "LEC", role: "E", association: null }),
  ]);

  it("always includes a pinned section in every result", () => {
    const outcome = solve([comp], ["COMP2011"], [302], DEFAULT_PREFERENCES, { limit: 100 });
    expect(outcome.error).toBeNull();
    for (const result of outcome.results) {
      expect(result.placed.map((p) => p.section.number)).toEqual([302]);
    }
  });

  it("reports a specific structural error when two pins overlap in time", () => {
    const a = course("AAAA1000", [
      section({
        number: 401,
        meetings: [meeting({ weekday: "Mon", timeFrom: "10:00", timeTo: "10:50" })],
      }),
    ]);
    const b = course("BBBB1000", [
      section({
        number: 402,
        meetings: [meeting({ weekday: "Mon", timeFrom: "10:30", timeTo: "11:20" })],
      }),
    ]);
    const outcome = solve([a, b], ["AAAA1000", "BBBB1000"], [401, 402], DEFAULT_PREFERENCES);
    expect(outcome.results).toEqual([]);
    expect(outcome.error).toContain("AAAA1000");
    expect(outcome.error).toContain("BBBB1000");
  });

  it("reports a structural error when a pin can't satisfy its own course's grouping", () => {
    // T01A only pairs with L01 (association 1); pinning T01A alongside forcing
    // L02 (association 2) via a second pin makes the course itself unsolvable.
    const math = course("MATH1013", [
      section({ number: 501, section: "L01", type: "LEC", role: "E", association: 1 }),
      section({ number: 502, section: "L02", type: "LEC", role: "E", association: 2 }),
      section({ number: 511, section: "T01A", type: "TUT", role: "N", association: 1 }),
    ]);
    // Pin both L02 (assoc 2) and T01A (assoc 1) — no legal combo contains both.
    const outcome = solve([math], ["MATH1013"], [502, 511], DEFAULT_PREFERENCES);
    expect(outcome.results).toEqual([]);
    expect(outcome.error).toContain("MATH1013");
  });
});

describe("solve — hard time-conflict avoidance across courses", () => {
  it("picks the non-conflicting option when one exists", () => {
    const a = course("AAAA1000", [
      section({
        number: 601,
        meetings: [meeting({ weekday: "Mon", timeFrom: "10:00", timeTo: "10:50" })],
      }),
    ]);
    const b = course("BBBB1000", [
      section({
        number: 602,
        section: "L1",
        meetings: [meeting({ weekday: "Mon", timeFrom: "10:00", timeTo: "10:50" })],
      }),
      section({
        number: 603,
        section: "L2",
        meetings: [meeting({ weekday: "Tue", timeFrom: "10:00", timeTo: "10:50" })],
      }),
    ]);
    const outcome = solve([a, b], ["AAAA1000", "BBBB1000"], [], DEFAULT_PREFERENCES);
    expect(outcome.error).toBeNull();
    const numbers = outcome.results[0].placed.map((p) => p.section.number).sort();
    // 601+602 clash on Monday 10:00; only 601+603 is legal.
    expect(numbers).toEqual([601, 603]);
  });
});

describe("solve — over-constrained soft preferences never return an empty, unexplained result", () => {
  it("still returns ranked, violation-tagged results when no preference can fully be met", () => {
    const comp = course("COMP2011", [
      section({
        number: 701,
        meetings: [meeting({ weekday: "Fri", timeFrom: "08:00", timeTo: "08:50" })],
      }),
    ]);
    const prefs: Preferences = {
      ...DEFAULT_PREFERENCES,
      earliestStart: "12:00",
      latestEnd: "13:00",
      maxDays: 0,
      blockedDays: ["Fri"],
    };
    const outcome = solve([comp], ["COMP2011"], [], prefs);
    expect(outcome.error).toBeNull();
    expect(outcome.results.length).toBe(1);
    expect(outcome.results[0].breakdown.violations.length).toBeGreaterThan(0);
  });
});
