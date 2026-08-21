/**
 * Live seat counts.
 *
 * Seat figures (enrol / capacity / waitlist) are the one part of the schedule
 * that moves fast, so unlike the rest of the data they are not baked into the
 * daily build. This route reads the current classes.parquet server-side and
 * returns just the seat columns.
 *
 * Server-side, not in the browser, because parsing Parquet client-side would
 * mean shipping a whole database engine (DuckDB-WASM) to every visitor.
 *
 * The response is explicitly stamped with when the data was retrieved. These
 * numbers are advisory — SIS remains authoritative, and a stale seat count
 * presented as live is worse than no seat count at all.
 */

import { DuckDBInstance } from "@duckdb/node-api";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const DATASET = "ust-archive/schedule";

/**
 * The upstream dataset publishes roughly every 45 minutes, so a 15-minute TTL
 * is fresh by construction while keeping one page view from triggering a
 * download per course.
 */
const TTL_MS = 15 * 60 * 1000;

interface SeatRow {
  number: number;
  capacity: number;
  enroll: number;
  wait: number;
  open: boolean;
}

interface Snapshot {
  fetchedAt: number;
  revision: string;
  seats: Map<number, SeatRow>;
}

/**
 * Cached across requests within a warm server instance. A cold start simply
 * refetches; this is a cache, never a source of truth.
 */
let snapshot: Snapshot | null = null;
let inFlight: Promise<Snapshot> | null = null;

async function loadSnapshot(): Promise<Snapshot> {
  const revisionResp = await fetch(
    `https://huggingface.co/api/datasets/${DATASET}/revision/main`,
    { cache: "no-store" },
  );
  if (!revisionResp.ok) throw new Error(`revision lookup failed: ${revisionResp.status}`);
  const { sha } = (await revisionResp.json()) as { sha: string };

  const fileResp = await fetch(
    `https://huggingface.co/datasets/${DATASET}/resolve/${sha}/classes.parquet`,
    { cache: "no-store" },
  );
  if (!fileResp.ok) throw new Error(`parquet fetch failed: ${fileResp.status}`);
  const bytes = Buffer.from(await fileResp.arrayBuffer());

  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "ust-seats-"));
  const path = join(dir, "classes.parquet");

  try {
    await writeFile(path, bytes);
    const instance = await DuckDBInstance.create(":memory:");
    const db = await instance.connect();

    // Same event-log reduction as the daily build: latest event per class
    // first, then keep the ones whose latest state is ACTIVE.
    const result = await db.run(`
      SELECT "number", capacity, enroll, wait, "open" FROM (
        SELECT *, row_number() OVER (
          PARTITION BY term_num, "number" ORDER BY "timestamp" DESC
        ) AS rn
        FROM read_parquet('${path}')
      ) WHERE rn = 1 AND status = 'ACTIVE'`);

    const rows = (await result.getRowObjectsJS()) as unknown as SeatRow[];
    const seats = new Map<number, SeatRow>();
    for (const row of rows) {
      seats.set(Number(row.number), {
        number: Number(row.number),
        capacity: Number(row.capacity),
        enroll: Number(row.enroll),
        wait: Number(row.wait),
        open: Boolean(row.open),
      });
    }

    return { fetchedAt: Date.now(), revision: sha, seats };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function getSnapshot(): Promise<Snapshot> {
  if (snapshot && Date.now() - snapshot.fetchedAt < TTL_MS) return snapshot;

  // Collapse concurrent misses into one download rather than one per request.
  inFlight ??= loadSnapshot()
    .then((fresh) => {
      snapshot = fresh;
      return fresh;
    })
    .finally(() => {
      inFlight = null;
    });

  try {
    return await inFlight;
  } catch (error) {
    // Serving a stale snapshot beats serving nothing, as long as the response
    // says how old it is.
    if (snapshot) return snapshot;
    throw error;
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requested = url.searchParams.get("numbers");

  try {
    const cached = snapshot && Date.now() - snapshot.fetchedAt < TTL_MS;
    const snap = await getSnapshot();

    const wanted = requested
      ? requested
          .split(",")
          .map((n) => Number(n.trim()))
          .filter(Number.isFinite)
          .slice(0, 500)
      : null;

    const seats: Record<string, Omit<SeatRow, "number">> = {};
    if (wanted) {
      for (const number of wanted) {
        const row = snap.seats.get(number);
        if (row) seats[number] = { capacity: row.capacity, enroll: row.enroll, wait: row.wait, open: row.open };
      }
    } else {
      for (const [number, row] of snap.seats) {
        seats[number] = { capacity: row.capacity, enroll: row.enroll, wait: row.wait, open: row.open };
      }
    }

    return NextResponse.json({
      ok: true,
      retrievedAt: new Date(snap.fetchedAt).toISOString(),
      ageSeconds: Math.round((Date.now() - snap.fetchedAt) / 1000),
      cached: Boolean(cached),
      revision: snap.revision,
      count: Object.keys(seats).length,
      seats,
    });
  } catch (error) {
    // Fail soft: the planner still works without live seats, and the UI falls
    // back to the daily snapshot with a clear label.
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "seat lookup failed",
      },
      { status: 503 },
    );
  }
}
