"use client";

/**
 * A course-first view of the active timetable.
 *
 * The week grid answers "when am I busy"; this answers "what did I actually
 * sign up for" — course, sections, and every instructor's rating criteria,
 * shown separately rather than folded into one number (see lib/rating.ts).
 * Both views read the same `placed` sections, so switching never changes
 * what's selected.
 */

import RatingBadge from "@/components/RatingBadge";
import type { Chip } from "@/components/Planner";
import type { PlacedSection } from "@/lib/conflicts";
import type { Course } from "@/lib/types";

export default function CourseListView({
  courses,
  placed,
  courseChips,
  instructorChips,
}: {
  courses: Course[];
  placed: PlacedSection[];
  courseChips: (course: Course) => Chip[];
  instructorChips: (name: string) => Chip[];
}) {
  const byCode = new Map<string, PlacedSection[]>();
  for (const p of placed) {
    const list = byCode.get(p.code);
    if (list) list.push(p);
    else byCode.set(p.code, [p]);
  }

  const groups = courses
    .filter((c) => byCode.has(c.code))
    .map((course) => ({ course, sections: byCode.get(course.code)! }))
    .sort((a, b) => a.course.code.localeCompare(b.course.code));

  if (groups.length === 0) {
    return (
      <p className="py-16 text-center text-sm text-muted">
        Pick courses and they&apos;ll appear here.
      </p>
    );
  }

  return (
    <div className="divide-y divide-border-subtle/60">
      {groups.map(({ course, sections }) => {
        const instructorNames = [
          ...new Set(sections.flatMap((p) => p.section.meetings.flatMap((m) => m.instructors))),
        ];

        return (
          <div key={course.code} className="py-3 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-mono text-sm font-semibold">{course.code}</span>
                <span className="text-sm text-foreground/90">{course.title}</span>
              </div>
              <span className="text-[11px] text-muted shrink-0">{course.credits} cr</span>
            </div>

            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {courseChips(course).map((chip) => (
                <RatingBadge
                  key={chip.key}
                  score={chip.score}
                  label={chip.label}
                  scale="courses"
                />
              ))}
            </div>

            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5">
              {sections
                .slice()
                .sort((a, b) => a.section.section.localeCompare(b.section.section))
                .map((p) => (
                  <span key={p.section.number} className="text-[11px] text-muted">
                    <span className="font-mono text-foreground/80">{p.section.section}</span>{" "}
                    <span className="rounded bg-surface px-1 py-0.5 text-[10px]">
                      {p.section.type}
                    </span>
                  </span>
                ))}
            </div>

            <div className="mt-2 space-y-1">
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
        );
      })}
    </div>
  );
}
