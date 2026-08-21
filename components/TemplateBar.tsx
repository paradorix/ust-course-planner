"use client";

/**
 * Saved-timetable switcher: create / rename / duplicate / delete, plus file
 * export/import. There's no backend, so export is the only way a plan leaves
 * this browser — treated as a first-class action, not an afterthought.
 */

import { useRef, useState } from "react";
import {
  exportTemplates,
  importTemplates,
  makeTemplate,
  newId,
  type Store,
  type Template,
} from "@/lib/templates";

export default function TemplateBar({
  store,
  setStore,
  termNum,
  credits,
  clashCount,
}: {
  store: Store;
  setStore: (updater: (prev: Store) => Store) => void;
  termNum: number | null;
  credits: number;
  clashCount: number;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const active = store.templates.find((t) => t.id === store.activeId) ?? null;

  function flash(message: string) {
    setNotice(message);
    setTimeout(() => setNotice((cur) => (cur === message ? null : cur)), 3000);
  }

  function create() {
    if (termNum === null) return;
    const template = makeTemplate(`Timetable ${store.templates.length + 1}`, termNum);
    setStore((prev) => ({
      ...prev,
      activeId: template.id,
      templates: [...prev.templates, template],
    }));
    // Drop straight into the name field with the default name selected, so
    // typing replaces it — naming a plan shouldn't require a second click.
    beginRename(template.id, template.name);
  }

  function duplicate(template: Template) {
    const copy: Template = {
      ...template,
      id: newId(),
      name: `${template.name} (copy)`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setStore((prev) => ({
      ...prev,
      activeId: copy.id,
      templates: [...prev.templates, copy],
    }));
  }

  function remove(id: string) {
    setStore((prev) => {
      const templates = prev.templates.filter((t) => t.id !== id);
      const activeId = prev.activeId === id ? (templates[0]?.id ?? null) : prev.activeId;
      return { ...prev, activeId, templates };
    });
  }

  function beginRename(id: string, currentName: string) {
    setRenaming(id);
    setDraftName(currentName);
  }

  function commitRename(id: string) {
    const name = draftName.trim();
    if (name) {
      setStore((prev) => ({
        ...prev,
        templates: prev.templates.map((t) => (t.id === id ? { ...t, name } : t)),
      }));
    }
    setRenaming(null);
  }

  function doExport() {
    const blob = new Blob([exportTemplates(store.templates)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ust-course-planner-timetables-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    flash("Exported.");
  }

  async function doImport(file: File) {
    try {
      const text = await file.text();
      const { templates, skipped } = importTemplates(text);
      setStore((prev) => ({
        ...prev,
        activeId: templates[0]?.id ?? prev.activeId,
        templates: [...prev.templates, ...templates],
      }));
      flash(
        `Imported ${templates.length} timetable${templates.length === 1 ? "" : "s"}` +
          (skipped ? `, skipped ${skipped} unreadable entr${skipped === 1 ? "y" : "ies"}` : "") +
          ".",
      );
    } catch (e) {
      flash(e instanceof Error ? e.message : "Import failed.");
    }
  }

  return (
    <div className="rounded-lg bg-surface ring-1 ring-border-subtle p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {store.templates.map((t) => {
          const isActive = t.id === store.activeId;
          const stale = t.termNum !== termNum;
          return (
            <div
              key={t.id}
              className={`group flex items-center gap-1 rounded-md px-2 py-1 text-xs ring-1 ${
                isActive
                  ? "bg-sky-500/20 text-sky-100 ring-sky-500/50"
                  : "bg-surface-raised text-muted ring-border-subtle hover:text-foreground"
              }`}
            >
              {renaming === t.id ? (
                <input
                  autoFocus
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onFocus={(e) => e.currentTarget.select()}
                  onBlur={() => commitRename(t.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(t.id);
                    if (e.key === "Escape") setRenaming(null);
                  }}
                  className="w-28 rounded bg-surface px-1 py-0.5 text-foreground outline-none"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setStore((prev) => ({ ...prev, activeId: t.id }))}
                  onDoubleClick={() => beginRename(t.id, t.name)}
                  title={
                    stale
                      ? `Saved for a different term (${t.selected.length} sections) — switch term to view it`
                      : `${t.selected.length} section${t.selected.length === 1 ? "" : "s"} · double-click to rename`
                  }
                >
                  {t.name}
                  {stale ? " ⋯" : ""}
                </button>
              )}
              <button
                type="button"
                onClick={() => beginRename(t.id, t.name)}
                title="Rename"
                className="opacity-0 group-hover:opacity-60 hover:!opacity-100"
              >
                ✎
              </button>
              <button
                type="button"
                onClick={() => duplicate(t)}
                title="Duplicate"
                className="opacity-0 group-hover:opacity-60 hover:!opacity-100"
              >
                ⧉
              </button>
              {store.templates.length > 1 ? (
                <button
                  type="button"
                  onClick={() => remove(t.id)}
                  title="Delete"
                  className="opacity-0 group-hover:opacity-60 hover:!opacity-100"
                >
                  ×
                </button>
              ) : null}
            </div>
          );
        })}

        <button
          type="button"
          onClick={create}
          className="rounded-md px-2 py-1 text-xs text-sky-300 ring-1 ring-dashed ring-sky-500/40 hover:bg-sky-500/10"
        >
          + New
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
        <span>
          {active ? `${credits} credits` : "No timetable selected"}
          {clashCount > 0 ? (
            <span className="text-rose-300"> · {clashCount} clash{clashCount === 1 ? "" : "es"}</span>
          ) : null}
        </span>

        <span className="flex items-center gap-2">
          {notice ? <span className="text-emerald-300">{notice}</span> : null}
          <button type="button" onClick={doExport} className="hover:text-foreground">
            Export
          </button>
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="hover:text-foreground"
          >
            Import
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void doImport(file);
              e.target.value = "";
            }}
          />
        </span>
      </div>
    </div>
  );
}
