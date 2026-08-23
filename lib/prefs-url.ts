/**
 * Preferences <-> URL query string, for the /rate route.
 *
 * Preferences live only as React state in Planner.tsx and never touch
 * localStorage (only a saved Template's wanted/pinned/selected do) — a real
 * route navigation would otherwise lose them outright. Encoding them in the
 * URL keeps a /rate link reproducible without adding a second persistence
 * layer preferences never needed before.
 *
 * decodePrefs is total: it never throws on missing or malformed input, since
 * it parses a URL a person could have hand-edited, bookmarked from an older
 * version, or pasted from anywhere. Any unreadable field silently falls back
 * to its DEFAULT_PREFERENCES value rather than failing the whole page.
 *
 * `t` (the active template id at the moment the link was made) travels
 * alongside the preferences for one reason only: /rate compares it against
 * the *current* active template and warns if they differ, rather than
 * silently scoring a stranger's timetable against these preferences.
 */

import { DEFAULT_PREFERENCES, type Preferences } from "./preferences.ts";
import { WEEKDAYS, type Weekday } from "./types.ts";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function isWeekday(value: string): value is Weekday {
  return (WEEKDAYS as readonly string[]).includes(value);
}

export function encodePrefs(prefs: Preferences, templateId: string | null): URLSearchParams {
  const params = new URLSearchParams();
  if (prefs.earliestStart) params.set("s", prefs.earliestStart);
  if (prefs.latestEnd) params.set("e", prefs.latestEnd);
  if (prefs.maxDays !== null) params.set("d", String(prefs.maxDays));
  if (prefs.blockedDays.length > 0) params.set("x", prefs.blockedDays.join(","));
  // Only encoded when they differ from the default, so an unmodified link —
  // the common case, since both start true — stays short.
  if (prefs.preferOpenSeats !== DEFAULT_PREFERENCES.preferOpenSeats) {
    params.set("o", prefs.preferOpenSeats ? "1" : "0");
  }
  if (prefs.preferCompact !== DEFAULT_PREFERENCES.preferCompact) {
    params.set("c", prefs.preferCompact ? "1" : "0");
  }
  if (templateId) params.set("t", templateId);
  return params;
}

export function decodePrefs(params: URLSearchParams): Preferences {
  const s = params.get("s");
  const e = params.get("e");
  const dRaw = params.get("d");
  const xRaw = params.get("x");
  const oRaw = params.get("o");
  const cRaw = params.get("c");

  const d = dRaw !== null ? Number(dRaw) : NaN;
  const blockedDays =
    xRaw !== null
      ? [...new Set(xRaw.split(",").map((v) => v.trim()).filter(isWeekday))]
      : DEFAULT_PREFERENCES.blockedDays;

  return {
    earliestStart: s && TIME_RE.test(s) ? s : DEFAULT_PREFERENCES.earliestStart,
    latestEnd: e && TIME_RE.test(e) ? e : DEFAULT_PREFERENCES.latestEnd,
    maxDays: Number.isFinite(d) && d >= 1 && d <= 7 ? d : DEFAULT_PREFERENCES.maxDays,
    blockedDays,
    preferOpenSeats:
      oRaw === "0" ? false : oRaw === "1" ? true : DEFAULT_PREFERENCES.preferOpenSeats,
    preferCompact:
      cRaw === "0" ? false : cRaw === "1" ? true : DEFAULT_PREFERENCES.preferCompact,
  };
}

/** The `t` param alone, for the mismatch check — cheaper than decoding everything else to get it. */
export function decodeTemplateId(params: URLSearchParams): string | null {
  return params.get("t");
}
