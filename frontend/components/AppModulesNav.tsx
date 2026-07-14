"use client";

import type { AppModule, AppModuleId } from "@/lib/modules";

export function AppModulesNav({
  modules,
  active,
  onSelect,
}: {
  modules: AppModule[];
  active: AppModuleId;
  onSelect: (id: AppModuleId) => void;
}) {
  return (
    <nav className="module-rail" aria-label="Разделы портала">
      <div className="module-rail-track">
        {modules.map((m, i) => {
          const isActive = m.id === active;
          return (
            <button
              key={m.id}
              type="button"
              className={`module-tab ${isActive ? "active" : ""} ${
                m.available ? "" : "soon"
              }`}
              aria-current={isActive ? "page" : undefined}
              title={m.available ? m.title : `${m.title} — скоро`}
              onClick={() => onSelect(m.id)}
            >
              <span className="module-tab-num">{i + 1}</span>
              <span className="module-tab-label">{m.nav}</span>
              {!m.available && <span className="module-tab-soon">скоро</span>}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
