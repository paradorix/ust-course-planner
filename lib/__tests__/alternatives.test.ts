import { describe, expect, it } from "vitest";
import { contrastiveAlternatives } from "../alternatives.ts";
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

// One course, two mutually exclusive section options:
//   Z1: Monday 08:00 — violates earliestStart(10:00) more than it violates
//       the Friday block (it isn't on Friday at all).
//   Z2: Friday 10:00 — satisfies earliestStart, but sits on a blocked day.
// Under the original preferences Z2 should win (cheaper violation). Shifting
// earliestStart back by an hour flips the winner to Z1; dropping the Friday
// block does not, because Z2 was already ahead on every other axis.
const comp = course("COMP2011", [
  section({
    number: 1,
    section: "Z1",
    meetings: [meeting({ weekday: "Mon", timeFrom: "08:00", timeTo: "08:50" })],
  }),
  section({
    number: 2,
    section: "Z2",
    meetings: [meeting({ weekday: "Fri", timeFrom: "10:00", timeTo: "10:50" })],
  }),
]);

const prefs: Preferences = {
  ...DEFAULT_PREFERENCES,
  earliestStart: "10:00",
  blockedDays: ["Fri"],
  preferOpenSeats: false,
  preferCompact: false,
};

describe("contrastiveAlternatives", () => {
  it("surfaces an axis whose relaxation actually changes the winning timetable", () => {
    const current = solve([comp], ["COMP2011"], [], prefs).results[0];
    expect(current.placed.map((p) => p.section.number)).toEqual([2]); // Z2 wins originally

    const alternatives = contrastiveAlternatives([comp], ["COMP2011"], [], prefs, current);
    const earliestStartAlt = alternatives.find((a) => a.key === "earliestStart");
    expect(earliestStartAlt).toBeDefined();
    expect(earliestStartAlt!.result.placed.map((p) => p.section.number)).toEqual([1]); // flips to Z1
    expect(earliestStartAlt!.label).toContain("09:00");
  });

  it("omits an axis whose relaxation doesn't change the winner", () => {
    const current = solve([comp], ["COMP2011"], [], prefs).results[0];
    const alternatives = contrastiveAlternatives([comp], ["COMP2011"], [], prefs, current);
    // Dropping the Friday block leaves Z2 in front regardless — no alternative shown.
    expect(alternatives.some((a) => a.key === "blockedDays")).toBe(false);
  });
});
