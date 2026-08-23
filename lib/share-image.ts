/**
 * Renders the current timetable to a PNG for sharing — the only way a plan
 * leaves this browser besides the JSON export (lib/templates.ts), and the
 * one meant for a friend rather than another instance of this app. Nothing
 * touches a server: canvas -> blob -> object URL -> synthetic click -> revoke,
 * the same shape as TemplateBar's JSON export.
 *
 * Uses a fixed light palette rather than the app's dark theme or the
 * `@media print` tokens in app/globals.css — those retint CSS custom
 * properties for the browser's own print pipeline, which a <canvas> can't
 * read into automatically. Hardcoding ink-friendly colors here keeps the
 * exported image legible regardless of the viewer's system theme.
 */

import { toMinutes, type PlacedSection } from "./conflicts.ts";
import type { ScoreBreakdown } from "./preferences.ts";
import { WEEKDAYS, type Weekday } from "./types.ts";

const DAY_START = 8 * 60;
const DAY_END = 20 * 60;
const PX_PER_MIN = 1.1;
const COL_WIDTH = 150;
const GUTTER = 46;
const HEADER_HEIGHT = 84;
const DAY_LABEL_HEIGHT = 22;
const FOOTER_PADDING = 28;

interface Block {
  code: string;
  section: string;
  from: number;
  to: number;
  timeLabel: string;
  lane: number;
  lanes: number;
}

/**
 * Same greedy lane-assignment idea as WeekGrid.tsx, kept as a small
 * self-contained copy rather than a shared import: the export is
 * deliberately simpler (no clash highlighting, no partial-date labels), and
 * duplicating ~15 lines of a standard interval-scheduling routine is cheaper
 * than coupling this module to WeekGrid's screen-only Block shape.
 */
function layout(placed: PlacedSection[]): Map<Weekday, Block[]> {
  const byDay = new Map<Weekday, Block[]>();
  for (const p of placed) {
    for (const m of p.section.meetings) {
      const block: Block = {
        code: p.code,
        section: p.section.section,
        from: toMinutes(m.timeFrom),
        to: toMinutes(m.timeTo),
        timeLabel: `${m.timeFrom}–${m.timeTo}`,
        lane: 0,
        lanes: 1,
      };
      const list = byDay.get(m.weekday);
      if (list) list.push(block);
      else byDay.set(m.weekday, [block]);
    }
  }
  for (const blocks of byDay.values()) {
    blocks.sort((a, b) => a.from - b.from);
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
}

export interface ShareImageOptions {
  templateName: string;
  termName: string;
  credits: number;
  placed: PlacedSection[];
  breakdown: ScoreBreakdown | null;
}

export function renderTimetableImage(opts: ShareImageOptions): HTMLCanvasElement {
  const byDay = layout(opts.placed);
  const activeDays = WEEKDAYS.filter((d) => (byDay.get(d)?.length ?? 0) > 0);
  const days: Weekday[] = activeDays.length > 0 ? activeDays : ["Mon", "Tue", "Wed", "Thu", "Fri"];

  const gridHeight = (DAY_END - DAY_START) * PX_PER_MIN;
  const width = GUTTER + days.length * COL_WIDTH + 12;
  const footerHeight =
    opts.breakdown && opts.breakdown.violations.length > 0 ? FOOTER_PADDING + 14 : FOOTER_PADDING;
  const height = HEADER_HEIGHT + DAY_LABEL_HEIGHT + gridHeight + footerHeight;

  const canvas = document.createElement("canvas");
  // 2x so the export stays crisp on high-density screens.
  const scale = 2;
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable — can't render a share image.");
  ctx.scale(scale, scale);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "#111318";
  ctx.font = "600 16px system-ui, -apple-system, sans-serif";
  ctx.fillText(opts.templateName, 16, 26);

  ctx.fillStyle = "#55606f";
  ctx.font = "12px system-ui, -apple-system, sans-serif";
  ctx.fillText(
    `${opts.termName} · ${opts.credits} credits${
      opts.breakdown ? ` · preference match ${opts.breakdown.score}` : ""
    }`,
    16,
    44,
  );
  ctx.fillText("UST Course Planner — unofficial, not affiliated with HKUST.", 16, 62);

  const top = HEADER_HEIGHT;

  ctx.textAlign = "center";
  ctx.fillStyle = "#111318";
  ctx.font = "600 12px system-ui, -apple-system, sans-serif";
  days.forEach((day, i) => {
    const x = GUTTER + i * COL_WIDTH + (COL_WIDTH - 6) / 2;
    ctx.fillText(day, x, top + 15);
  });
  ctx.textAlign = "left";

  const gridTop = top + DAY_LABEL_HEIGHT;
  for (let h = DAY_START / 60; h <= DAY_END / 60; h++) {
    const y = gridTop + (h * 60 - DAY_START) * PX_PER_MIN;
    ctx.fillStyle = "#55606f";
    ctx.font = "10px system-ui, -apple-system, sans-serif";
    ctx.fillText(`${String(h).padStart(2, "0")}:00`, 2, y + 3);
    ctx.strokeStyle = "#e5e7eb";
    ctx.beginPath();
    ctx.moveTo(GUTTER, y);
    ctx.lineTo(width - 8, y);
    ctx.stroke();
  }

  days.forEach((day, i) => {
    const colX = GUTTER + i * COL_WIDTH;
    const colWidth = COL_WIDTH - 6;
    ctx.strokeStyle = "#d1d5db";
    ctx.strokeRect(colX, gridTop, colWidth, gridHeight);

    for (const block of byDay.get(day) ?? []) {
      const laneWidth = colWidth / block.lanes;
      const x = colX + block.lane * laneWidth;
      const y = gridTop + (block.from - DAY_START) * PX_PER_MIN;
      const h = Math.max((block.to - block.from) * PX_PER_MIN - 2, 16);
      const w = laneWidth - 2;

      ctx.fillStyle = "rgba(14, 116, 233, 0.14)";
      ctx.strokeStyle = "rgba(14, 116, 233, 0.55)";
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);

      ctx.fillStyle = "#111318";
      ctx.font = "600 10px system-ui, -apple-system, sans-serif";
      ctx.fillText(`${block.code} ${block.section}`, x + 3, y + 11, w - 6);
      ctx.fillStyle = "#55606f";
      ctx.font = "9px system-ui, -apple-system, sans-serif";
      ctx.fillText(block.timeLabel, x + 3, y + 22, w - 6);
    }
  });

  if (opts.breakdown && opts.breakdown.violations.length > 0) {
    ctx.fillStyle = "#92400e";
    ctx.font = "10px system-ui, -apple-system, sans-serif";
    const line = opts.breakdown.violations.map((v) => v.detail).join(" · ");
    ctx.fillText(`breaks: ${line}`, GUTTER, gridTop + gridHeight + 20, width - GUTTER - 16);
  }

  return canvas;
}

/** Render and trigger a PNG download. No-op on the server. */
export function downloadTimetableImage(opts: ShareImageOptions): void {
  if (typeof document === "undefined") return;
  const canvas = renderTimetableImage(opts);
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${opts.templateName.replace(/[^\w.-]+/g, "_") || "timetable"}.png`;
    a.click();
    URL.revokeObjectURL(url);
  }, "image/png");
}
