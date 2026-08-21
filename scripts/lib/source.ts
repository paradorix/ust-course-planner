/**
 * Fetching, hashing, and fail-closed writing for the build scripts.
 *
 * Upstream (ust-rankings) fetches remote JSON with no integrity or staleness
 * check and writes it straight into the build; a compromised or stale source
 * flows through silently. Everything here exists so this project does not
 * repeat that: we pin an immutable revision, hash what we downloaded, and
 * never overwrite good data with bad.
 */

import { createHash } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const CACHE_DIR = ".cache";

/** Thrown when input fails validation. Callers exit non-zero on this. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/** Assert a condition, or fail the build with a specific reason. */
export function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ValidationError(message);
}

export function log(step: string, detail: string) {
  console.log(`  ${step.padEnd(22)} ${detail}`);
}

/**
 * Resolve a Hugging Face dataset ref to an immutable commit SHA, so every
 * file in one build comes from the same snapshot even if the dataset updates
 * mid-run (it publishes roughly every 45 minutes).
 */
export async function resolveHuggingFaceRevision(
  dataset: string,
  ref = "main",
): Promise<string> {
  const url = `https://huggingface.co/api/datasets/${dataset}/revision/${ref}`;
  const resp = await fetch(url);
  check(resp.ok, `Could not resolve ${dataset}@${ref}: HTTP ${resp.status}`);
  const body = (await resp.json()) as { sha?: string };
  check(
    typeof body.sha === "string" && body.sha.length >= 7,
    `${dataset}@${ref} returned no commit sha`,
  );
  return body.sha as string;
}

/** Download to the local cache and return its bytes plus SHA-256. */
export async function fetchToCache(
  url: string,
  filename: string,
): Promise<{ path: string; digest: string; bytes: number }> {
  const resp = await fetch(url);
  check(resp.ok, `Failed to fetch ${url}: HTTP ${resp.status}`);
  const buffer = Buffer.from(await resp.arrayBuffer());
  check(buffer.byteLength > 0, `${url} returned an empty body`);

  await mkdir(CACHE_DIR, { recursive: true });
  const path = join(CACHE_DIR, filename);
  await writeFile(path, buffer);

  const digest = createHash("sha256").update(buffer).digest("hex");
  log(filename, `${(buffer.byteLength / 1_048_576).toFixed(2)} MB  sha256:${digest.slice(0, 12)}…`);
  return { path, digest, bytes: buffer.byteLength };
}

/**
 * Write JSON atomically: serialize to a temp file, then rename over the
 * target. A crash mid-write leaves the previous good file untouched rather
 * than a truncated one.
 */
export async function writeJsonAtomic(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  const body = JSON.stringify(value);
  await writeFile(temp, body);
  await rename(temp, path);
  return body.length;
}

/**
 * Run a build step, reporting failures without leaving partial output behind.
 * On any error the previously generated files stay exactly as they were and
 * the process exits non-zero, so CI fails loudly instead of publishing a
 * broken or empty dataset.
 */
export async function runBuild(name: string, body: () => Promise<void>) {
  const started = Date.now();
  console.log(`\n▶ ${name}`);
  try {
    await body();
    console.log(`✔ ${name} finished in ${((Date.now() - started) / 1000).toFixed(1)}s\n`);
  } catch (error) {
    const reason =
      error instanceof ValidationError
        ? error.message
        : error instanceof Error
          ? `${error.name}: ${error.message}`
          : String(error);
    console.error(`\n✖ ${name} FAILED — keeping previous data.`);
    console.error(`  ${reason}\n`);
    process.exitCode = 1;
  }
}

/** DuckDB returns BIGINT as JS BigInt, which JSON.stringify refuses. */
export function normalizeBigInts<T>(value: T): T {
  if (typeof value === "bigint") return Number(value) as unknown as T;
  if (Array.isArray(value)) return value.map(normalizeBigInts) as unknown as T;
  if (value instanceof Date) return value.toISOString().slice(0, 10) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = normalizeBigInts(v);
    return out as T;
  }
  return value;
}
