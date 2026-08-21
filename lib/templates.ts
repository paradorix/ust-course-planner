/**
 * Saved timetable templates.
 *
 * Several named hypothetical timetables ("safe", "dream", "light term") live
 * in localStorage. There is no account system and no server storage, so the
 * file export is the only way a plan leaves this browser — which is why it is
 * a first-class feature rather than an afterthought.
 *
 * The storage key carries a version. If the shape ever changes, an old blob
 * is ignored rather than half-read into a broken state.
 */

const STORAGE_KEY = "ust-course-planner:v1";

export interface Template {
  id: string;
  name: string;
  termNum: number;
  /** Class numbers — stable within a term and the source's own identifier. */
  selected: number[];
  createdAt: string;
  updatedAt: string;
}

export interface Store {
  version: 1;
  activeId: string | null;
  templates: Template[];
}

const EMPTY: Store = { version: 1, activeId: null, templates: [] };

function isTemplate(value: unknown): value is Template {
  if (!value || typeof value !== "object") return false;
  const t = value as Partial<Template>;
  return (
    typeof t.id === "string" &&
    typeof t.name === "string" &&
    typeof t.termNum === "number" &&
    Array.isArray(t.selected) &&
    t.selected.every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

export function newId(): string {
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function makeTemplate(name: string, termNum: number, selected: number[] = []): Template {
  const now = new Date().toISOString();
  return { id: newId(), name, termNum, selected, createdAt: now, updatedAt: now };
}

export function loadStore(): Store {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<Store>;
    if (parsed.version !== 1 || !Array.isArray(parsed.templates)) return EMPTY;
    const templates = parsed.templates.filter(isTemplate);
    const activeId =
      typeof parsed.activeId === "string" && templates.some((t) => t.id === parsed.activeId)
        ? parsed.activeId
        : (templates[0]?.id ?? null);
    return { version: 1, activeId, templates };
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
      version: 1,
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
    if (!isTemplate(candidate)) {
      skipped++;
      continue;
    }
    templates.push({ ...candidate, id: newId(), updatedAt: new Date().toISOString() });
  }

  if (templates.length === 0) throw new Error("No usable timetables in that file.");
  return { templates, skipped };
}
