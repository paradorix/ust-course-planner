/**
 * Saved timetable templates.
 *
 * Several named hypothetical timetables ("safe", "dream", "light term") live
 * in localStorage. There is no account system and no server storage, so the
 * file export is the only way a plan leaves this browser — which is why it is
 * a first-class feature rather than an afterthought.
 *
 * The storage key carries a version. If the shape ever changes, an old blob
 * is ignored rather than half-read into a broken state — except for the
 * v1 -> v2 migration below, which is a deliberate, one-time exception: v1
 * predates this file existing at all, so its templates are real user data
 * worth preserving rather than a "foreign blob".
 *
 * v2 moved selection from section-level to course-level (see the smart
 * planner update): a template now separates what the student *wants*
 * (course codes) from what they've *pinned* (specific sections forced as
 * hard constraints) from what's actually *placed* on the grid (solver
 * output, or pins before any solve has run). This file stays free of any
 * dependency on lib/types.ts on purpose — mapping a v1 class number to a
 * course code needs the term's schedule, which only the caller has, so
 * migration leaves `wanted` empty and `backfillWanted` (below) fills it in
 * once the schedule is loaded.
 */

const STORAGE_KEY = "ust-course-planner:v1";

export interface Template {
  id: string;
  name: string;
  termNum: number;
  /** Course codes the student wants, regardless of which section fills them. */
  wanted: string[];
  /** Class numbers forced by the student — hard constraints for the solver. */
  pinned: number[];
  /** The resolved section list the grid/list view renders. */
  selected: number[];
  createdAt: string;
  updatedAt: string;
}

export interface Store {
  version: 2;
  activeId: string | null;
  templates: Template[];
}

const EMPTY: Store = { version: 2, activeId: null, templates: [] };

function isTemplate(value: unknown): value is Template {
  if (!value || typeof value !== "object") return false;
  const t = value as Partial<Template>;
  const numbers = (arr: unknown): arr is number[] =>
    Array.isArray(arr) && arr.every((n) => typeof n === "number" && Number.isFinite(n));
  const strings = (arr: unknown): arr is string[] =>
    Array.isArray(arr) && arr.every((s) => typeof s === "string");
  return (
    typeof t.id === "string" &&
    typeof t.name === "string" &&
    typeof t.termNum === "number" &&
    strings(t.wanted) &&
    numbers(t.pinned) &&
    numbers(t.selected)
  );
}

// ---- v1 (pre-course-level) shapes, kept only to migrate old data ----------

interface TemplateV1 {
  id: string;
  name: string;
  termNum: number;
  selected: number[];
  createdAt: string;
  updatedAt: string;
}

interface StoreV1 {
  version: 1;
  activeId: string | null;
  templates: TemplateV1[];
}

function isTemplateV1(value: unknown): value is TemplateV1 {
  if (!value || typeof value !== "object") return false;
  const t = value as Partial<TemplateV1>;
  return (
    typeof t.id === "string" &&
    typeof t.name === "string" &&
    typeof t.termNum === "number" &&
    Array.isArray(t.selected) &&
    t.selected.every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

/**
 * Every section a v1 student had manually checked was an explicit choice, so
 * it becomes a pin — a hard constraint the solver will schedule around,
 * never something silently dropped. `wanted` is intentionally left empty
 * here; call `backfillWanted` once the schedule for each template's term is
 * available to derive course codes from those pins.
 */
function migrateV1(old: StoreV1): Store {
  return {
    version: 2,
    activeId: old.activeId,
    templates: old.templates.filter(isTemplateV1).map((t) => ({
      id: t.id,
      name: t.name,
      termNum: t.termNum,
      wanted: [],
      pinned: [...t.selected],
      selected: [...t.selected],
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    })),
  };
}

/**
 * Fill in `wanted` for any migrated template that doesn't have it yet, from
 * its pinned sections' course codes. Safe to call every render — a no-op
 * once every template already has `wanted` populated.
 */
export function backfillWanted(
  store: Store,
  codeForClassNumber: (classNumber: number) => string | null,
): Store {
  let changed = false;
  const templates = store.templates.map((t) => {
    if (t.wanted.length > 0 || t.pinned.length === 0) return t;
    const codes = new Set<string>();
    for (const n of t.pinned) {
      const code = codeForClassNumber(n);
      if (code) codes.add(code);
    }
    if (codes.size === 0) return t;
    changed = true;
    return { ...t, wanted: [...codes] };
  });
  return changed ? { ...store, templates } : store;
}

export function newId(): string {
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function makeTemplate(
  name: string,
  termNum: number,
  overrides: Partial<Pick<Template, "wanted" | "pinned" | "selected">> = {},
): Template {
  const now = new Date().toISOString();
  return {
    id: newId(),
    name,
    termNum,
    wanted: overrides.wanted ?? [],
    pinned: overrides.pinned ?? [],
    selected: overrides.selected ?? [],
    createdAt: now,
    updatedAt: now,
  };
}

export function loadStore(): Store {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as { version?: unknown; activeId?: unknown; templates?: unknown };

    if (parsed.version === 1 && Array.isArray(parsed.templates)) {
      return migrateV1({
        version: 1,
        activeId: typeof parsed.activeId === "string" ? parsed.activeId : null,
        templates: parsed.templates,
      });
    }

    if (parsed.version !== 2 || !Array.isArray(parsed.templates)) return EMPTY;
    const templates = parsed.templates.filter(isTemplate);
    const activeId =
      typeof parsed.activeId === "string" && templates.some((t) => t.id === parsed.activeId)
        ? parsed.activeId
        : (templates[0]?.id ?? null);
    return { version: 2, activeId, templates };
  } catch {
    // A corrupt or foreign blob should not brick the planner.
    return EMPTY;
  }
}

export function saveStore(store: Store): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Quota or private-mode failures are non-fatal; the session still works.
  }
}

/** Serialize for download. */
export function exportTemplates(templates: Template[]): string {
  return JSON.stringify(
    {
      format: "ust-course-planner/templates",
      version: 2,
      exportedAt: new Date().toISOString(),
      templates,
    },
    null,
    2,
  );
}

export interface ImportResult {
  templates: Template[];
  skipped: number;
}

/**
 * Read an exported file back.
 *
 * Accepts both v2 exports and v1 exports (from before this update) — an old
 * export is a friend's real timetable, not garbage input, so its sections
 * become pins exactly as the local v1 -> v2 migration treats them. `wanted`
 * for those is backfilled the same way, on next load.
 *
 * Imported templates always receive fresh ids so importing your own file
 * twice, or a friend's file that shares an id, never silently overwrites an
 * existing plan.
 */
export function importTemplates(raw: string): ImportResult {
  const parsed = JSON.parse(raw) as { templates?: unknown };
  if (!parsed || !Array.isArray(parsed.templates)) {
    throw new Error("That file doesn't look like a planner export.");
  }

  const templates: Template[] = [];
  let skipped = 0;
  for (const candidate of parsed.templates) {
    const now = new Date().toISOString();
    if (isTemplate(candidate)) {
      templates.push({ ...candidate, id: newId(), updatedAt: now });
    } else if (isTemplateV1(candidate)) {
      templates.push({
        id: newId(),
        name: candidate.name,
        termNum: candidate.termNum,
        wanted: [],
        pinned: [...candidate.selected],
        selected: [...candidate.selected],
        createdAt: candidate.createdAt,
        updatedAt: now,
      });
    } else {
      skipped++;
    }
  }

  if (templates.length === 0) throw new Error("No usable timetables in that file.");
  return { templates, skipped };
}
