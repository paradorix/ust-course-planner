"use client";

/**
 * The weekly timetable.
 *
 * Meetings are absolutely positioned inside per-day columns by their start and
 * end minute, which is what lets overlapping blocks sit side by side instead of
 * hiding each other. Clashing blocks are outlined rather than removed — seeing
 * the collision is the point.
 */

import { useMemo } from "react";
import { toMinutes, type PlacedSection } from "@/lib/conflicts";
import { WEEKDAYS, type Weekday } from "@/lib/types";

const DAY_START = 8 * 60;
const DAY_END = 22 * 60;
const PIXELS_PER_MINUTE = 0.85;

interface Block {
  key: string;
  code: string;
  section: string;
  weekday: Weekday;
  from: number;
  to: number;
  timeLabel: string;
  venue: string;
  instructors: string[];
  dateFrom: string;
  dateTo: string;
  partial: boolean;
  clashing: boolean;
  /** Horizontal slot assignment, so overlapping blocks share the column. */
  lane: number;
  lanes: number;
}

function formatShortDate(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${day}/${month}`;
}

export default function WeekGrid({
  placed,
  clashKeys,
  termStart,
  termEnd,
  onRemove,
}: {
  placed: PlacedSection[];
  clashKeys: Set<string>;
  termStart: string;
  termEnd: string;
  onRemove: (classNumber: number) => void;
}) {
  const blocksByDay = useMemo(() => {
    const byDay = new Map<Weekday, Block[]>();

    for (const item of placed) {
      for (const [index, meeting] of item.section.meetings.entries()) {
        const from = toMinutes(meeting.timeFrom);
        const to = toMinutes(meeting.timeTo);
        // A meeting narrower than the full term is worth calling out — two
        // sections can share a slot without ever actually colliding.
        const partial = meeting.dateFrom > termStart || meeting.dateTo < termEnd;

        const block: Block = {
          key: `${item.section.number}:${index}`,
          code: item.code,
          section: item.section.section,
          weekday: meeting.weekday,
          from,
          to,
          timeLabel: `${meeting.timeFrom}–${meeting.timeTo}`,
          venue: meeting.venueName || meeting.venue,
          instructors: meeting.instructors,
          dateFrom: meeting.dateFrom,
          dateTo: meeting.dateTo,
          partial,
          clashing: clashKeys.has(`${item.code}:${item.section.section}`),
          lane: 0,
          lanes: 1,
        };

        const list = byDay.get(meeting.weekday);
        if (list) list.push(block);
        else byDay.set(meeting.weekday, [block]);
      }
    }

    // Assign lanes greedily so time-overlapping blocks sit beside each other.
    for (const blocks of byDay.values()) {
      blocks.sort((a, b) => a.from - b.from || a.to - b.to);
      const laneEnds: number[] = [];
      for (const block of blocks) {
        let lane = laneEnds.findIndex((end) => end <= block.from);
        if (lane === -1) {
          lane = laneEnds.length;
          laneEnds.push(block.to);
        } else {
          laneEnds[lane] = block.to;
        }
        block.lane = lane;
      }
      const group = laneEnds.length || 1;
      for (const block of blocks) block.lanes = group;
    }

    return byDay;
  }, [placed, clashKeys, termStart, termEnd]);

  const activeDays = WEEKDAYS.filter(
    (day) => day !== "Sun" || (blocksByDay.get("Sun")?.length ?? 0) > 0,
  ).filter((day) => day !== "Sat" || (blocksByDay.get("Sat")?.length ?? 0) > 0);

  const hours: number[] = [];
  for (let h = DAY_START / 60; h <= DAY_END / 60; h++) hours.push(h);

  const height = (DAY_END - DAY_START) * PIXELS_PER_MINUTE;

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[640px]">
        <div
          className="grid gap-px"
          style={{ gridTemplateColumns: `3.5rem repeat(${activeDays.length}, minmax(0, 1fr))` }}
        >
          <div />
          {activeDays.map((day) => (
            <div
              key={day}
              className="pb-2 text-center text-xs font-semibold tracking-wide text-muted uppercase"
            >
              {day}
            </div>
          ))}

          <div className="relative" style={{ height }}>
            {hours.map((hour) => (
              <div
                key={hour}
                className="absolute -translate-y-1/2 text-right text-[10px] tabular-nums text-muted pr-2 w-full"
                style={{ top: (hour * 60 - DAY_START) * PIXELS_PER_MINUTE }}
              >
                {String(hour).padStart(2, "0")}:00
              </div>
            ))}
          </div>

          {activeDays.map((day) => (
            <div
              key={day}
              className="relative rounded-md bg-surface ring-1 ring-border-subtle/60"
              style={{ height }}
            >
              {hours.map((hour) => (
                <div
                  key={hour}
                  className="absolute w-full border-t border-border-subtle/40"
                  style={{ top: (hour * 60 - DAY_START) * PIXELS_PER_MINUTE }}
                />
              ))}

              {(blocksByDay.get(day) ?? []).map((block) => {
                const width = 100 / block.lanes;
                return (
                  <button
                    key={block.key}
                    type="button"
                    onClick={() => onRemove(Number(block.key.split(":")[0]))}
                    title={`${block.code} ${block.section} · ${block.timeLabel}\n${block.venue}\n${
                      block.instructors.join(", ") || "No instructor listed"
                    }\n${formatShortDate(block.dateFrom)} – ${formatShortDate(block.dateTo)}\n\nClick to remove`}
                    className={`absolute overflow-hidden rounded px-1.5 py-1 text-left text-[11px] leading-tight transition hover:brightness-125 ${
                      block.clashing
                        ? "bg-rose-500/25 ring-2 ring-rose-400 text-rose-50"
                        : "bg-sky-500/25 ring-1 ring-sky-400/50 text-sky-50"
                    }`}
                    style={{
                      top: (block.from - DAY_START) * PIXELS_PER_MINUTE,
                      height: Math.max((block.to - block.from) * PIXELS_PER_MINUTE - 2, 18),
                      left: `${block.lane * width}%`,
                      width: `${width}%`,
                    }}
                  >
                    {block.clashing ? (
                      <span
                        aria-hidden="true"
                        className="clash-flash pointer-events-none absolute inset-0 rounded bg-rose-500"
                      />
                    ) : null}
                    <div className="font-semibold truncate">
                      {block.code} {block.section}
                    </div>
                    <div className="truncate opacity-80">{block.timeLabel}</div>
                    {block.venue ? (
                      <div className="truncate opacity-70">{block.venue}</div>
                    ) : null}
                    {block.partial ? (
                      <div className="truncate opacity-90 text-amber-200">
                        {formatShortDate(block.dateFrom)}–{formatShortDate(block.dateTo)}
                      </div>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
