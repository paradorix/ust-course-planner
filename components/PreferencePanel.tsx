"use client";

/**
 * Smart planner controls: the wishlist of wanted courses, the preferences a
 * student can set, and the button that runs the solver.
 *
 * Entirely optional — pinning a section (SectionRow) already places it on
 * the grid directly, with no solve required, so a student who just wants to
 * build a timetable by hand can ignore this whole panel. The on/off switch
 * exists to make that opt-out explicit rather than leaving the panel looking
 * mandatory; turning it off only hides these controls; it does not clear
 * anything already picked.
 *
 * Preferences are all soft (lib/preferences.ts) — nothing here can make the
 * solver refuse to produce a timetable. A structural error, when shown, is a
 * different kind of failure: a pin that conflicts with another pin or with
 * its own course's section grouping. That's the only case with no timetable
 * to show at all.
 */

import { DEFAULT_PREFERENCES, type Preferences } from "@/lib/preferences";
import { WEEKDAYS, type Course, type Weekday } from "@/lib/types";

export default function PreferencePanel({
  enabled,
  onChangeEnabled,
  wantedCodes,
  courses,
  prefs,
  onChangePrefs,
  onRemoveWanted,
  onGenerate,
  error,
}: {
  enabled: boolean;
  onChangeEnabled: (next: boolean) => void;
  wantedCodes: string[];
  courses: Course[];
  prefs: Preferences;
  onChangePrefs: (next: Preferences) => void;
  onRemoveWanted: (code: string) => void;
  onGenerate: () => void;
  error: string | null;
}) {
  const titleFor = (code: string) => courses.find((c) => c.code === code)?.title ?? "";

  function toggleBlockedDay(day: Weekday) {
    const has = prefs.blockedDays.includes(day);
    onChangePrefs({
      ...prefs,
      blockedDays: has ? prefs.blockedDays.filter((d) => d !== day) : [...prefs.blockedDays, day],
    });
  }

  return (
    <div className="rounded-lg bg-surface ring-1 ring-border-subtle p-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Smart planner</h2>
        <div className="flex items-center gap-3">
          {enabled &&
          !(prefs.earliestStart === null &&
            prefs.latestEnd === null &&
            prefs.maxDays === null &&
            prefs.blockedDays.length === 0 &&
            prefs.preferOpenSeats === DEFAULT_PREFERENCES.preferOpenSeats &&
            prefs.preferCompact === DEFAULT_PREFERENCES.preferCompact) ? (
            <button
              type="button"
              onClick={() => onChangePrefs(DEFAULT_PREFERENCES)}
              className="text-[11px] text-muted hover:text-foreground"
            >
              Reset preferences
            </button>
          ) : null}
          <label
            className="flex items-center gap-1.5 text-[11px] text-muted"
            title="Off: pin sections directly instead — nothing you've already picked is affected"
          >
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => onChangeEnabled(e.target.checked)}
              className="accent-sky-500"
            />
            {enabled ? "On" : "Off"}
          </label>
        </div>
      </div>

      {!enabled ? (
        <p className="text-[11px] text-muted">
          Smart planner is off. Expand a course on the left and pin the sections you want —
          they&apos;ll go straight onto the grid.
        </p>
      ) : (
        <>
          <div className="mb-3">
            <p className="mb-1.5 text-[11px] text-muted">
              Courses you want{wantedCodes.length > 0 ? ` (${wantedCodes.length})` : ""} — the
              solver fills in sections for these.
            </p>
            {wantedCodes.length === 0 ? (
              <p className="text-[11px] text-muted italic">
                Add courses on the left to build a wishlist.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {wantedCodes.map((code) => (
                  <span
                    key={code}
                    title={titleFor(code)}
                    className="inline-flex items-center gap-1.5 rounded-md bg-surface-raised px-2 py-1 text-[11px] ring-1 ring-border-subtle"
                  >
                    <span className="font-mono">{code}</span>
                    <button
                      type="button"
                      onClick={() => onRemoveWanted(code)}
                      className="text-muted hover:text-rose-300"
                      title={`Remove ${code}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-center justify-between gap-2 text-xs">
              <span className="text-muted">Day starts after</span>
              <input
                type="time"
                value={prefs.earliestStart ?? ""}
                onChange={(e) =>
                  onChangePrefs({ ...prefs, earliestStart: e.target.value || null })
                }
                className="rounded-md bg-surface-raised px-2 py-1 ring-1 ring-border-subtle outline-none focus:ring-sky-500"
              />
            </label>

            <label className="flex items-center justify-between gap-2 text-xs">
              <span className="text-muted">Day ends before</span>
              <input
                type="time"
                value={prefs.latestEnd ?? ""}
                onChange={(e) => onChangePrefs({ ...prefs, latestEnd: e.target.value || null })}
                className="rounded-md bg-surface-raised px-2 py-1 ring-1 ring-border-subtle outline-none focus:ring-sky-500"
              />
            </label>

            <label className="flex items-center justify-between gap-2 text-xs">
              <span className="text-muted">Max days on campus</span>
              <input
                type="number"
                min={1}
                max={7}
                value={prefs.maxDays ?? ""}
                onChange={(e) =>
                  onChangePrefs({
                    ...prefs,
                    maxDays: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
                placeholder="any"
                className="w-16 rounded-md bg-surface-raised px-2 py-1 ring-1 ring-border-subtle outline-none placeholder:text-muted focus:ring-sky-500"
              />
            </label>

            <div className="flex flex-col gap-1 text-xs">
              <label className="flex items-center gap-1.5 text-muted">
                <input
                  type="checkbox"
                  checked={prefs.preferOpenSeats}
                  onChange={(e) => onChangePrefs({ ...prefs, preferOpenSeats: e.target.checked })}
                  className="accent-sky-500"
                />
                prefer open seats
              </label>
              <label className="flex items-center gap-1.5 text-muted">
                <input
                  type="checkbox"
                  checked={prefs.preferCompact}
                  onChange={(e) => onChangePrefs({ ...prefs, preferCompact: e.target.checked })}
                  className="accent-sky-500"
                />
                prefer fewer gaps
              </label>
            </div>
          </div>

          <div className="mt-3">
            <p className="mb-1.5 text-[11px] text-muted">Can&apos;t go to school on</p>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map((day) => {
                const on = prefs.blockedDays.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleBlockedDay(day)}
                    className={`rounded-md px-2 py-1 text-[11px] font-medium ring-1 transition ${
                      on
                        ? "bg-rose-500/20 text-rose-200 ring-rose-500/50"
                        : "bg-surface-raised text-muted ring-border-subtle hover:text-foreground"
                    }`}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
          </div>

          {error ? (
            <div className="mt-3 rounded-md border border-rose-500/40 bg-rose-500/10 p-2 text-[11px] text-rose-100/90">
              {error}
            </div>
          ) : null}

          <button
            type="button"
            onClick={onGenerate}
            disabled={wantedCodes.length === 0}
            className="mt-3 w-full rounded-md bg-sky-500/20 px-3 py-2 text-xs font-semibold text-sky-200 ring-1 ring-sky-500/50 transition hover:bg-sky-500/30 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Generate timetable
          </button>
        </>
      )}
    </div>
  );
}
