"use client";

import type { AppModule, AppModuleId } from "@/lib/modules";
import { MODULE_PATH } from "@/lib/routes";
import Link from "next/link";

export function AppModulesNav({
  modules,
  active,
}: {
  modules: AppModule[];
  active: AppModuleId;
}) {
  return (
    <nav className="module-rail" aria-label="Разделы портала">
      <div className="module-rail-track">
        {modules.map((m, i) => {
          const isActive = m.id === active;
          return (
            <Link
              key={m.id}
              href={MODULE_PATH[m.id]}
              className={`module-tab ${isActive ? "active" : ""} ${
                m.available ? "" : "soon"
              }`}
              aria-current={isActive ? "page" : undefined}
              aria-disabled={!m.available ? true : undefined}
              title={m.available ? m.title : `${m.title} — скоро`}
            >
              <span className="module-tab-num" aria-hidden>
                {i + 1}
              </span>
              <span className="module-tab-label">{m.nav}</span>
              {!m.available && (
                <span className="module-tab-soon" aria-label="раздел скоро">
                  скоро
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
