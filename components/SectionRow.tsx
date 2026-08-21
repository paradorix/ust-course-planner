"use client";

/**
 * One section within an expanded course: meeting times, instructor(s) with
 * their own rating, seats, and the add/remove control.
 */

import RatingBadge from "@/components/RatingBadge";
import type { Chip, SeatInfo } from "@/components/Planner";
import type { Section } from "@/lib/types";

export default function SectionRow({
  section,
  selected,
  clashing,
  seat,
  seatsFailed,
  instructorChips,
  onToggle,
}: {
  section: Section;
  selected: boolean;
  clashing: boolean;
  seat: SeatInfo | null;
  seatsFailed: boolean;
  /** One chip per criterion being shown, so this row never branches on mode. */
  instructorChips: (name: string) => Chip[];
  onToggle: () => void;
}) {
  const instructorNames = [
    ...new Set(section.meetings.flatMap((m) => m.instructors)),
  ];

  const seatInfo: SeatInfo | null =
    seat ?? {
      capacity: section.snapshotCapacity,
      enroll: section.snapshotEnroll,
      wait: section.snapshotWait,
      open: section.snapshotOpen,
    };
  const seatIsLive = seat !== null;
  const full = seatInfo.capacity > 0 && seatInfo.enroll >= seatInfo.capacity;

  return (
    <div
      className={`rounded-md p-2.5 ring-1 transition ${
        selected
          ? clashing
            ? "bg-rose-500/10 ring-rose-500/50"
            : "bg-sky-500/10 ring-sky-500/40"
          : "bg-surface-raised ring-border-subtle hover:ring-border-subtle/80"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="font-mono font-semibold">{section.section}</span>
            <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] text-muted">
              {section.type}
            </span>
            {section.role === "N" ? (
              <span
                className="text-[10px] text-muted"
                title="Secondary meeting, associated with a primary lecture"
              >
                secondary
              </span>
            ) : null}
            {section.consent ? (
              <span className="text-[10px] text-amber-300">instructor consent required</span>
            ) : null}
          </div>

          <div className="mt-1 space-y-0.5">
            {section.meetings.map((m, i) => (
              <div key={i} className="text-[11px] text-muted">
                {m.weekday} {m.timeFrom}–{m.timeTo} · {m.venueName || m.venue || "venue TBA"}
              </div>
            ))}
            {section.meetings.length === 0 ? (
              <div className="text-[11px] text-muted">No scheduled meeting time</div>
            ) : null}
          </div>

          <div className="mt-1.5 space-y-1">
            {instructorNames.length > 0 ? (
              instructorNames.map((name) => (
                <div key={name} className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className="text-foreground/90">{name}</span>
                  {instructorChips(name).map((chip) => (
                    <RatingBadge
                      key={chip.key}
                      score={chip.score}
                      label={chip.label}
                      scale="instructors"
                    />
                  ))}
                </div>
              ))
            ) : (
              <span className="text-[11px] text-muted">Instructor TBA</span>
            )}
          </div>
        </div>

        <div className="flex flex-col items-end gap-1.5">
          <button
            type="button"
            onClick={onToggle}
            className={`rounded-md px-2.5 py-1 text-xs font-medium ring-1 transition ${
              selected
                ? "bg-rose-500/15 text-rose-200 ring-rose-500/40 hover:bg-rose-500/25"
                : "bg-sky-500/15 text-sky-200 ring-sky-500/40 hover:bg-sky-500/25"
            }`}
          >
            {selected ? "Remove" : "Add"}
          </button>

          <div
            className={`text-[10px] tabular-nums ${
              full ? "text-rose-300" : "text-muted"
            }`}
            title={
              seatIsLive
                ? "Live seat count"
                : seatsFailed
                  ? "Live seats unavailable — showing the daily schedule snapshot"
                  : "Loading live seats — showing the daily snapshot for now"
            }
          >
            {seatInfo.enroll}/{seatInfo.capacity} seats
            {seatInfo.wait > 0 ? ` · ${seatInfo.wait} waitlisted` : ""}
            {!seatInfo.open ? " · closed" : ""}
            {!seatIsLive ? " (snapshot)" : ""}
          </div>
        </div>
      </div>

    </div>
  );
}
