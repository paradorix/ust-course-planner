/**
 * Print-only text summary of the timetable.
 *
 * The week grid alone doesn't always print legibly at arbitrary page scale
 * (small labels, absolute positioning), so this renders the same selections
 * as a plain table underneath it — visible only in print/PDF output, never
 * on screen.
 */

import type { PlacedSection } from "@/lib/conflicts";

export default function PrintSummary({
  templateName,
  termName,
  placed,
  credits,
  generatedAt,
}: {
  templateName: string;
  termName: string;
  placed: PlacedSection[];
  credits: number;
  generatedAt: Date;
}) {
  const rows = [...placed].sort((a, b) => a.code.localeCompare(b.code));

  return (
    <div className="hidden print:block">
      <h1 className="text-lg font-semibold">{templateName}</h1>
      <p className="text-xs text-muted">
        {termName} · {credits} credits · generated {generatedAt.toLocaleString()}
      </p>
      <p className="mt-1 text-[10px] text-muted">
        UST Course Planner — unofficial, not affiliated with HKUST. Seat counts and
        prerequisites are not verified by this planner; check SIS before enrolling.
      </p>

      <table className="mt-3 w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-border-subtle text-left">
            <th className="py-1 pr-2">Course</th>
            <th className="py-1 pr-2">Section</th>
            <th className="py-1 pr-2">Meetings</th>
            <th className="py-1 pr-2">Venue</th>
            <th className="py-1">Instructor</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ code, section }) => (
            <tr key={section.number} className="border-b border-border-subtle/60 align-top">
              <td className="py-1 pr-2 font-mono">{code}</td>
              <td className="py-1 pr-2 font-mono">{section.section}</td>
              <td className="py-1 pr-2">
                {section.meetings.map((m, i) => (
                  <div key={i}>
                    {m.weekday} {m.timeFrom}–{m.timeTo}
                  </div>
                ))}
              </td>
              <td className="py-1 pr-2">
                {[...new Set(section.meetings.map((m) => m.venueName || m.venue))]
                  .filter(Boolean)
                  .join(", ") || "—"}
              </td>
              <td className="py-1">
                {[...new Set(section.meetings.flatMap((m) => m.instructors))].join(", ") ||
                  "TBA"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
