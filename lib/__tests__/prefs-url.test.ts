import { describe, expect, it } from "vitest";
import { decodePrefs, decodeTemplateId, encodePrefs } from "../prefs-url.ts";
import { DEFAULT_PREFERENCES, type Preferences } from "../preferences.ts";

describe("encodePrefs / decodePrefs — round trip", () => {
  it("round-trips a fully-specified set of preferences", () => {
    const prefs: Preferences = {
      earliestStart: "10:00",
      latestEnd: "18:00",
      maxDays: 3,
      blockedDays: ["Fri", "Sat"],
      preferOpenSeats: false,
      preferCompact: false,
    };
    const params = encodePrefs(prefs, "t_abc123");
    expect(decodePrefs(params)).toEqual(prefs);
    expect(decodeTemplateId(params)).toBe("t_abc123");
  });

  it("round-trips the untouched defaults, including a null template id", () => {
    const params = encodePrefs(DEFAULT_PREFERENCES, null);
    expect(decodePrefs(params)).toEqual(DEFAULT_PREFERENCES);
    expect(decodeTemplateId(params)).toBeNull();
  });

  it("omits open-seats/compact flags when they match the default, but still round-trips", () => {
    const prefs: Preferences = { ...DEFAULT_PREFERENCES, earliestStart: "09:00" };
    const params = encodePrefs(prefs, "t_x");
    expect(params.has("o")).toBe(false);
    expect(params.has("c")).toBe(false);
    expect(decodePrefs(params)).toEqual(prefs);
  });
});

describe("decodePrefs — total on malformed or missing input", () => {
  it("falls back to defaults for every field on an empty query", () => {
    expect(decodePrefs(new URLSearchParams())).toEqual(DEFAULT_PREFERENCES);
  });

  it("ignores an unparseable time and falls back rather than throwing", () => {
    const params = new URLSearchParams({ s: "not-a-time", e: "25:99" });
    const result = decodePrefs(params);
    expect(result.earliestStart).toBe(DEFAULT_PREFERENCES.earliestStart);
    expect(result.latestEnd).toBe(DEFAULT_PREFERENCES.latestEnd);
  });

  it("ignores an out-of-range or non-numeric maxDays", () => {
    expect(decodePrefs(new URLSearchParams({ d: "0" })).maxDays).toBe(DEFAULT_PREFERENCES.maxDays);
    expect(decodePrefs(new URLSearchParams({ d: "9" })).maxDays).toBe(DEFAULT_PREFERENCES.maxDays);
    expect(decodePrefs(new URLSearchParams({ d: "banana" })).maxDays).toBe(
      DEFAULT_PREFERENCES.maxDays,
    );
  });

  it("drops unrecognized day names and de-duplicates the rest", () => {
    const result = decodePrefs(new URLSearchParams({ x: "Mon,Mon,Bogusday,Fri" }));
    expect(result.blockedDays).toEqual(["Mon", "Fri"]);
  });

  it("treats a garbage boolean flag as unset rather than throwing", () => {
    const result = decodePrefs(new URLSearchParams({ o: "yes-please" }));
    expect(result.preferOpenSeats).toBe(DEFAULT_PREFERENCES.preferOpenSeats);
  });

  it("never throws on a hand-edited or truncated query string", () => {
    expect(() =>
      decodePrefs(new URLSearchParams("s=&e=&d=&x=&o=&c=&t=")),
    ).not.toThrow();
  });
});
